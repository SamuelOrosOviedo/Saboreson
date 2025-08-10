// server/db.js
import Database from 'better-sqlite3';

const db = new Database('./db.sqlite');

// Crea la tabla si no existe
db.prepare(`
  CREATE TABLE IF NOT EXISTS productos (
    id TEXT PRIMARY KEY,
    title TEXT,
    stock INTEGER
  )
`).run();

export default db;