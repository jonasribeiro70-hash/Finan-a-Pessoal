// Script standalone para (re)criar o banco de dados a partir do schema.sql
// Uso: npm run initdb
const db = require('./connection');

console.log('Banco de dados inicializado com sucesso em:', db.name);

const tabelas = db
  .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
  .all();

console.log('Tabelas existentes:');
tabelas.forEach((t) => console.log(' -', t.name));

db.close();
