// server/initStock.js
import { productos } from './productsDB.js';
import db from './db.js';

for (const { id, title, stock } of productos) {
  db.prepare(`
    INSERT OR REPLACE INTO productos (id, title, stock)
    VALUES (?, ?, ?)
  `).run(id, title, stock);
}

console.log('✅ Productos inicializados en la base de datos');