import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import cors from 'cors';
import fetch from 'node-fetch'; 
import fs from 'fs';
import TelegramBot from 'node-telegram-bot-api';
const referenciasCarrito = new Map();
let pagosConfirmados = new Set();
import { productos, updateStock, checkStock, setStockById} from './productsDB.js';
import { MercadoPagoConfig, Preference } from 'mercadopago';


// Mercado Pago clients
const clienteA = new MercadoPagoConfig({
  accessToken: 'APP_USR-7241896838859109-052521-24ca0b389cf64100b9cf32959d8e0b45-1972393764',
});
clienteA.userId = '1972393764';

const clienteB = new MercadoPagoConfig({
  accessToken: 'APP_USR-2812119479621582-071600-fef09544f9df1377af9b71e656d3ea46-1340230278',
});

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const app = express();
const rootDir = path.join(__dirname, '..');

// Middleware
app.use(cors());
app.use(express.json());

app.get('/stock', (req, res) => {
  res.json(productos);
});

// Crear preferencia para Cliente A
app.post('/create_preference', async (req, res) => {
  await crearPreferencia(req, res, clienteA, 'https://saboreson.onrender.com/webhook/clienteA');
  console.log('preferencia creada cliente A')
});

// Crear preferencia para Cliente B
app.post('/create_preference/comercio2', async (req, res) => {
  await crearPreferencia(req, res, clienteB, 'https://saboreson.onrender.com/webhook/clienteB');
  console.log('preferencia creada cliente B')
});

// Webhook de Cliente A
const pedidosClienteA = new Set();
app.post('/webhook/clienteA', async (req, res) => {
  await procesarWebhook(req, res, clienteA, pedidosClienteA);
  
});

// Webhook de Cliente B
const pedidosClienteB = new Set();
app.post('/webhook/clienteB', async (req, res) => {
  await procesarWebhook(req, res, clienteB, pedidosClienteB);
});

const TELEGRAM_TOKEN = '8111614927:AAEarrN4yFs8IVHXp3hmxefWaBaAiiq00gA';
const bot = new TelegramBot(TELEGRAM_TOKEN, { polling: false });
const destinosTelegram = {
  'rotiseriasamuel': 8172569804,
  'rotiseriapatri': 7113246656,   
};

async function crearPreferencia(req, res, client, webhookUrl) {
  try {
    const { title, quantity, price, direccion, carrito, nombre, rotiseria, horaEntrega } = req.body;

    const items = (carrito || [{
      title,
      quantity: Number(quantity),
      unit_price: Number(price)
    }]).map(item => ({
      ...item,
      currency_id: 'ARS'  // 👈 Esto se asegura que cada item tenga moneda definida
    }));
    console.log("✅ Items con currency_id:", items);
    const totalFinal = items.reduce((sum, i) => sum + i.unit_price * i.quantity, 0);
    console.log("💰 Total esperado (con comisión si aplica):", totalFinal);

    // 💥 Validación de stock
    const itemsParaStock = items.filter(i => i.title !== "Comisión por uso de Mercado Pago");
    const erroresStock = checkStock(itemsParaStock);
    if (erroresStock.length > 0) {
      return res.status(400).json({
        error: '❌ Por el momento no contamos con algunos productos',
        detalles: erroresStock
      });
    }

    // 🧹 Sanitización
    const sanitize = (text) => String(text || '')
      .replace(/[^a-zA-Z0-9\s]/g, '')
      .replace(/\s+/g, '_')
      .replace(/\n/g, '')
      .trim();

    const cleanNombre = sanitize(nombre);
    const cleanDireccion = sanitize(direccion);
    const cleanRotiseria = sanitize(rotiseria || 'desconocida').toLowerCase(); 
    const cleanHoraEntrega = String(horaEntrega || 'inmediato').replace(/\s+/g, '_');
    
    const referencia = `pedido_${Date.now()}_ROT_${cleanRotiseria}_DIR_${cleanDireccion}_NOM_${cleanNombre}_HORA_${cleanHoraEntrega}`;

    const body = {
      items,
      back_urls: {
        success: 'https://www.saboreson.com/success.html',
        failure: 'https://24917ee64df8.ngrok-free.app/failure',
        pending: 'https://24917ee64df8.ngrok-free.app/pending',
      },
      auto_return: 'approved',
      notification_url: webhookUrl,
      metadata: {
        direccion_entrega: direccion || "No especificada"
      },
      external_reference: referencia // 👈 esto es lo que te faltaba
    };

    const preference = new Preference(client);
    const result = await preference.create({ body });
    referenciasCarrito.set(referencia, itemsParaStock);
    
    console.log('✅ Preferencia creada:', result.id);
    res.json({ id: result.id, init_point: result.init_point });

  } catch (error) {
    console.error('❌ Error al crear preferencia:', error);
    res.status(500).json({ error: 'Error al crear la preferencia' });
  }
}
function nombreLimpio(title) {
  return title.replace(/^\d+\s*/, '');
}



async function procesarWebhook(req, res, client, pedidosProcesados) {
  const { topic, resource } = req.body;

  function makeAbsoluteUrl(path) {
    return path?.startsWith('http')
      ? path
      : `https://api.mercadopago.com${path?.startsWith('/') ? '' : '/'}${path}`;
  }

  let resourceUrl = makeAbsoluteUrl(resource);

  // Manejo del topic "payment" para obtener merchant_order
  if (topic === "payment") {
    try {
      const pagoRes = await fetch(resourceUrl, {
        headers: {
          Authorization: `Bearer ${client.accessToken}`,
          'Content-Type': 'application/json'
        }
      });

      const pago = await pagoRes.json();

      if (!pago.order?.id) {
        if (pago.id) {
          const merchantOrderRes = await fetch(
            `https://api.mercadopago.com/merchant_orders/search/payment_id/${pago.id}`,
            {
              headers: {
                Authorization: `Bearer ${client.accessToken}`,
                'Content-Type': 'application/json'
              }
            }
          );

          const merchantOrderData = await merchantOrderRes.json();

          if (merchantOrderData.results && merchantOrderData.results.length > 0) {
            resourceUrl = `https://api.mercadopago.com/merchant_orders/${merchantOrderData.results[0].id}`;
          } else {
            console.log("⚠️ No se encontró merchant_order para payment_id", pago.id);
            return res.sendStatus(200);
          }
        } else {
          console.log("⚠️ Payment sin merchant_order_id y sin id de pago válido");
          return res.sendStatus(200);
        }
      } else {
        resourceUrl = `https://api.mercadopago.com/merchant_orders/${pago.order.id}`;
      }

    } catch (err) {
      console.error("❌ Error consultando payment:", err.message);
      return res.sendStatus(500);
    }
  }

  try {
    resourceUrl = makeAbsoluteUrl(resourceUrl);

    const orderRes = await fetch(resourceUrl, {
      headers: {
        Authorization: `Bearer ${client.accessToken}`,
        'Content-Type': 'application/json'
      }
    });

    const order = await orderRes.json();

    if (!order.id || !order.external_reference) {
      console.warn("⚠️ Orden sin ID o referencia externa, ignorada");
      return res.sendStatus(200);
    }

    // --- PRIMERO verificamos si ya fue procesada esta orden para evitar duplicados ---
    if (pedidosProcesados.has(order.id)) {
      console.log(`🔁 Orden ${order.id} ya procesada`);
      return res.sendStatus(200);
    }

    if (pagosConfirmados.has(order.external_reference)) {
      console.log(`🔁 Referencia ${order.external_reference} ya confirmada`);
      return res.sendStatus(200);
    }

    const pagos = order.payments || [];

    if (!Array.isArray(pagos) || pagos.length === 0) {
      console.log(`⚠️ Orden ${order.id} no tiene pagos asociados`);
      return res.sendStatus(200);
    }

    const pagoAcreditado = pagos.find(p => p.status === 'approved' || p.status === 'accredited');

    if (!pagoAcreditado) {
      console.log(`⚠️ Ningún pago aprobado/acreditado para orden ${order.id}`);
      return res.sendStatus(200);
    }

    // --- AQUÍ MARCAMOS el pedido y pago COMO PROCESADOS ANTES de actualizar stock o enviar Telegram ---
    pedidosProcesados.add(order.id);
    pagosConfirmados.add(order.external_reference);

    const multiplicadorQR = 10;

    let carritoParaActualizar;
    if (referenciasCarrito.has(order.external_reference)) {
      carritoParaActualizar = referenciasCarrito.get(order.external_reference);
      console.log('📦 Carrito reconstruido desde referenciasCarrito');
    } else {
      carritoParaActualizar = order.items
        .filter(item => !/comisión/i.test(item.title))
        .map(item => ({
          title: item.title,
          quantity: Number(item.quantity || 1) / multiplicadorQR,
          unit_price: item.unit_price 
          
        }));
      console.log('📦 Carrito reconstruido desde items (preferencia)');
    }

    const erroresStock = checkStock(carritoParaActualizar);
    if (erroresStock.length > 0) {
      console.error('❌ No hay stock suficiente:', erroresStock.join(' | '));
      return res.status(400).json({ error: 'Stock insuficiente', detalles: erroresStock });
    }

    const ref = order.external_reference;

    const matchRotiseria = ref.match(/_ROT_(.*?)_DIR_/) || [];
    const rotiseriaRaw = matchRotiseria[1] || "desconocida";
    const nombreRotiseria = rotiseriaRaw.replace(/_/g, ' ');

    const matchDireccion = ref.match(/_DIR_(.*?)_NOM_/) || [];
    const direccionEntrega = matchDireccion[1]?.replace(/_/g, ' ') || "Dirección no especificada";

    const matchNombre = ref.match(/_NOM_(.*?)_HORA_/) || [];
const nombreCliente = matchNombre[1]?.replace(/_/g, ' ') || "Cliente desconocido";

const matchHora = ref.match(/_HORA_(.+)$/) || [];
const horaEntrega = matchHora[1]?.replace(/_/g, ' ') || "No especificada";
let horaEntregaFormateada = horaEntrega;

// Si la hora es tipo "1300" o "0930", agregamos el ":"
if (/^\d{3,4}$/.test(horaEntrega)) {
    horaEntregaFormateada = horaEntrega.padStart(4, '0'); // asegura 4 dígitos
    horaEntregaFormateada = `${horaEntregaFormateada.slice(0, 2)}:${horaEntregaFormateada.slice(2)}`;
}

    const productos = carritoParaActualizar.map(i => {
  const nombre = nombreLimpio(i.title);

  // ✅ Detecta cantidades cercanas a 0.6 como "1/2"
  const cantidadTexto = (Math.abs(i.quantity - 0.6) < 0.01) ? '1/2' : i.quantity;

  const totalItem = (carritoParaActualizar.length === 1)
    ? order.total_amount.toFixed(2)
    : (i.unit_price * i.quantity).toFixed(2);

  return `🛒 ${cantidadTexto} x ${nombre} ($${totalItem})`;
}).join('\n') || "Sin productos";

    const total = order.total_amount;

    let telefono = "📞 Teléfono no disponible";
    if (pagoAcreditado?.id) {
      const pagoRes = await fetch(`https://api.mercadopago.com/v1/payments/${pagoAcreditado.id}`, {
        headers: { Authorization: `Bearer ${client.accessToken}` }
      });
      const pago = await pagoRes.json();
      const phone = pago?.payer?.phone;
      telefono = phone?.number
        ? `📞 Tel: ${phone.area_code || ''} ${phone.number}`.trim()
        : "📞 Teléfono no disponible";
    }

    const mensaje = `🚨 NUEVO PEDIDO CONFIRMADO
🍽️ ${nombreRotiseria}
👤 Cliente: ${nombreCliente}
${telefono}
📦 Entrega: ${direccionEntrega}
🕒 Hora de entrega: ${horaEntregaFormateada}
${productos}
💵 Total: $${total}`;

    const rotiseriaKey = rotiseriaRaw.replace(/\s+/g, '_').toLowerCase();
    const chatId = destinosTelegram[rotiseriaKey];
    if (!chatId) {
      console.warn(`⚠️ No se encontró chat_id para ${nombreRotiseria}`);
      return res.sendStatus(200);
    }

    try {
      updateStock(carritoParaActualizar);
      console.log('✅ Stock actualizado en memoria');
    } catch (err) {
      console.error('❌ Error al actualizar el stock:', err.message);
      return res.status(500).send('Error actualizando stock');
    }

    await bot.sendMessage(chatId, mensaje);
    console.log(`✅ Enviado a Telegram (${nombreRotiseria})`);

    referenciasCarrito.delete(order.external_reference);
    return res.sendStatus(200);

  } catch (error) {
    console.error("❌ Error procesando webhook:", error.message || error);
    return res.sendStatus(500);
  }
}


app.post('/crear_qr', async (req, res) => {
  const { total, direccion, carrito, nombre, rotiseria, horaEntrega} = req.body;
  const cleanRotiseria = (rotiseria || 'desconocida').replace(/\s+/g, '_');
  const erroresStock = checkStock(carrito);
  if (erroresStock.length > 0) {
    return res.status(400).json({
      error: '❌ Por el momento no contamos con algunos productos',
      detalles: erroresStock
    });
  }
    const sanitize = (text) => String(text || '')
    .replace(/[^a-zA-Z0-9\s]/g, '') // elimina caracteres raros
    .replace(/\s+/g, '_')           // reemplaza espacios por _
    .replace(/\n/g, '')             // 🔧 elimina saltos de línea (¡clave!)
    .trim();

    const cleanNombre = sanitize(nombre);
    const cleanDireccion = sanitize(direccion);
    const cleanHoraEntrega = sanitize(horaEntrega || 'inmediato');
    

    const userId = '1972393764';
    const externalPosId = 'CajaDinamica001';
    const qrUrl = `https://api.mercadopago.com/instore/orders/qr/seller/collectors/${userId}/pos/${externalPosId}/qrs`;

    const idUnico = `pedido_${Date.now()}`;
    referenciasCarrito.set(idUnico, carrito);

    const referencia = `${idUnico}_ROT_${cleanRotiseria}_DIR_${cleanDireccion}_NOM_${cleanNombre}_HORA_${cleanHoraEntrega}`;
    const multiplicador = 10;
const orderData = {
  external_reference: referencia,
  title: `Pedido QR`,
  description: "Compra en tienda online",
  notification_url: 'https://saboreson.onrender.com/webhook/clienteA',
  total_amount: total,
  items: carrito.map(item => {
    const quantityReal = item.quantity;
    const unitPriceReal = item.unit_price;

    return {
      id: item.id,
      title: item.title,
      quantity: Math.round(quantityReal * multiplicador), // ✅ simulamos fracción como entero
      unit_price: Math.round((unitPriceReal / multiplicador) * 100) / 100, // precio reducido
      unit_measure: 'unit',
      total_amount: Math.round(quantityReal * unitPriceReal * 100) / 100
    };
  }),
};
    const qrResponse = await fetch(qrUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer APP_USR-7241896838859109-052521-24ca0b389cf64100b9cf32959d8e0b45-1972393764`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(orderData)
    });

    const qrData = await qrResponse.json();

    if (!qrResponse.ok || !qrData.qr_data) {
      console.error('❌ Error al generar el QR:', qrData);
      return res.status(400).json({ error: 'No se pudo generar el QR', details: qrData });
    }

    console.log('✅ QR generado correctamente Cliente A');
    res.json({
      qr_data: qrData.qr_data,
      in_store_order_id: qrData.in_store_order_id,
      external_reference: referencia
    });

});

app.post('/crear_qr/clienteB', async (req, res) => {
  const { total, direccion, carrito, nombre, rotiseria} = req.body;
  const cleanRotiseria = (rotiseria || 'desconocida').replace(/\s+/g, '_');
  const erroresStock = checkStock(carrito);
  if (erroresStock.length > 0) {
    return res.status(400).json({
      error: '❌ Por el momento no contamos con algunos productos',
      detalles: erroresStock
    });
  }
    const sanitize = (text) => String(text || '')
    .replace(/[^a-zA-Z0-9\s]/g, '') // elimina caracteres raros
    .replace(/\s+/g, '_')           // reemplaza espacios por _
    .replace(/\n/g, '')             // 🔧 elimina saltos de línea (¡clave!)
    .trim();

    const cleanNombre = sanitize(nombre);
    const cleanDireccion = sanitize(direccion);

    const userId = '1340230278';
    const externalPosId = 'CajaDinamica001';
    const qrUrl = `https://api.mercadopago.com/instore/orders/qr/seller/collectors/${userId}/pos/${externalPosId}/qrs`;

    const idUnico = `pedido_${Date.now()}`;
    referenciasCarrito.set(idUnico, carrito);

    const referencia = `${idUnico}_ROT_${cleanRotiseria}_DIR_${cleanDireccion}_NOM_${cleanNombre}`;

    const orderData = {
      external_reference: referencia,
      title: `Pedido QR`,
      description: "Compra en tienda online",
      notification_url: 'https://saboreson.onrender.com/webhook/clienteB',
      total_amount: total,
      items: carrito.map(item => ({
        id: item.id,
        title: item.title,
        quantity: item.quantity,
        unit_price: item.unit_price,
        unit_measure: 'unit',
        total_amount: item.quantity * item.unit_price
      })),
    };

    const qrResponse = await fetch(qrUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer APP_USR-2812119479621582-071600-fef09544f9df1377af9b71e656d3ea46-1340230278`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(orderData)
    });

    const qrData = await qrResponse.json();

    if (!qrResponse.ok || !qrData.qr_data) {
      console.error('❌ Error al generar el QR:', qrData);
      return res.status(400).json({ error: 'No se pudo generar el QR', details: qrData });
    }

    console.log('✅ QR generado correctamente Cliente B');
    res.json({
      qr_data: qrData.qr_data,
      in_store_order_id: qrData.in_store_order_id,
      external_reference: referencia
    });

});

app.get('/status_pago', (req, res) => {
  const ref = req.query.ref;

  // Si el pago fue confirmado, estará en el Set
  const pagado = pagosConfirmados.has(ref);
  res.json({ pagado });
});
// Ruta para actualizar el stock manualmente
app.post('/admin/actualizar-stock', (req, res) => {
  const { id, stock } = req.body;

  if (typeof id !== 'number' || typeof stock !== 'number') {
    return res.status(400).json({ error: 'ID y stock deben ser números' });
  }

  try {
    setStockById(id, stock);
    res.json({ mensaje: `✅ Stock del producto con ID ${id} actualizado a ${stock}` });
  } catch (error) {
    res.status(404).json({ error: error.message });
  }
});

const LOG_FILE_PATH = path.join(__dirname, 'pedidos_log.json');

// Crear el archivo si no existe
if (!fs.existsSync(LOG_FILE_PATH)) {
  fs.writeFileSync(LOG_FILE_PATH, JSON.stringify([]));
}

app.post('/api/log-pedido', (req, res) => {
  const nuevoPedido = req.body;

  fs.readFile(LOG_FILE_PATH, 'utf8', (err, data) => {
    if (err) return res.status(500).send('Error al leer el archivo.');

    let pedidos = [];
    try {
      pedidos = JSON.parse(data);
    } catch (e) {
      return res.status(500).send('Error al parsear JSON.');
    }

    pedidos.push(nuevoPedido);

    fs.writeFile(LOG_FILE_PATH, JSON.stringify(pedidos, null, 2), (err) => {
      if (err) return res.status(500).send('Error al guardar pedido.');
      res.status(200).send('Pedido registrado.');
    });
  });
});
app.get('/', (req, res) => {
  res.send('Servidor funcionando correctamente');
});
// Iniciar servidor
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`🚀 Servidor funcionando en puerto ${PORT}`);
});










