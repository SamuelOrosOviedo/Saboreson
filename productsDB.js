export const productos = [
    //Cliente A:
    { id: 1, title: "01 Pizza", stock: 1 },
    { id: 7, title: "02 Pizza Variedad", stock: 2 },
    { id: 2, title: "03 Canelones", stock: 10 },
    { id: 3, title: "04 Combo Hamburguesa + Fritas", stock: 10 },
    { id: 4, title: "05 Hamburguesa", stock: 1 },
    { id: 5, title: "06 Empanadas", stock: 10 },
    { id: 6, title: "07 Plato del día", stock: 10 },
    { id: 8, title: "08 Plato del día", stock: 10 },
    { id: 9, title: "09 Pizza rellena", stock: 10 },

    //Cliente B:
    { id: 10, title: "10 Hamburguesa", stock: 10 },
    { id: 11, title: "11 Pizza Especial", stock: 1 },
  ];
  
 const fraccionesPendientes = {};
 function nombreLimpio(title) {
  return title.replace(/^\d+\s*/, '');
}

function checkStock(carrito) {
  const errores = [];
  for (const item of carrito) {
    const producto = productos.find(p => p.title === item.title);
    if (!producto) {
      errores.push(`❌ El producto "${nombreLimpio(item.title)}" no existe.`);
      continue;
    }
     const cantidadSolicitada = item.quantity || 0;
    const acumulado = (fraccionesPendientes[producto.title] || 0) + cantidadSolicitada;

    // ⚠️ Validar si hay stock suficiente para esta acumulación total
    const enterosNecesarios = Math.floor(acumulado);
    if (enterosNecesarios > producto.stock) {
      errores.push(
       `<div style="display: none; text-align: center">
          Lo sentimos 
        </div>`
      );
    }

    if (producto.stock < item.quantity) {
      errores.push(
        `<div style="text-align: center">
          ❌ Sin stock para <strong>"${nombreLimpio(item.title)}"</strong><br>
          Actualmente contamos con: <strong>${producto.stock}</strong> productos disponibles.<br>
          Mientras que el pedido requiere de: <strong>${item.quantity}</strong> productos.
        </div>`
      );
    }
  }
  return errores;
}
  
  function updateStock(carrito) {
  for (const item of carrito) {
    const producto = productos.find(p => p.title === item.title);
    if (!producto) throw new Error(`Producto con título "${item.title}" no encontrado en stock`);

    const cantidad = item.quantity || 0;
    fraccionesPendientes[producto.title] = (fraccionesPendientes[producto.title] || 0) + cantidad;

    // Descontar solo si ya se completa 1 unidad o más
    while (fraccionesPendientes[producto.title] >= 1) {
      if (producto.stock < 1) throw new Error(`Stock insuficiente para "${producto.title}"`);
      producto.stock -= 1;
      fraccionesPendientes[producto.title] -= 1;
    }
  }
}
  
 function setStockById(id, nuevoStock) {
  const producto = productos.find(p => p.id === id);
  if (!producto) {
    throw new Error(`Producto con ID ${id} no encontrado`);
  }
  producto.stock = nuevoStock;
}

export { checkStock, updateStock, setStockById };