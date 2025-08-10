// server/stockService.js
import db from './db.js';

export function getAllStock() {
  const stmt = db.prepare('SELECT * FROM productos');
  return stmt.all();
}

export function isStockAvailable(carrito) {
  return carrito.every(({ id, quantity }) => {
    const item = db.prepare('SELECT stock FROM productos WHERE id = ?').get(id);
    return item && item.stock >= quantity;
  });
}

export function updateStock(carrito) {
  const updateStmt = db.prepare('UPDATE productos SET stock = stock - ? WHERE id = ? AND stock >= ?');

  const transaction = db.transaction(() => {
    for (const { id, quantity } of carrito) {
      const result = updateStmt.run(quantity, id, quantity);
      if (result.changes === 0) {
        throw new Error(`Sin stock suficiente para el producto ${id}`);
      }
    }
  });

  transaction();
}