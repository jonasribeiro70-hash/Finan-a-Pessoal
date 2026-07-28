const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
require('dotenv').config();

const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'financeiro.sqlite');

// Garante que a pasta do banco existe
const dbDir = path.dirname(DB_PATH);
if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// Aplica o schema sempre que o servidor sobe (CREATE TABLE IF NOT EXISTS é idempotente)
const schemaPath = path.join(__dirname, 'schema.sql');
const schema = fs.readFileSync(schemaPath, 'utf8');
db.exec(schema);

// Aplica migrações incrementais em bancos criados antes desta atualização
// (adiciona colunas/tabelas novas sem apagar dados existentes)
const { migrar } = require('./migrate');
migrar(db);

module.exports = db;
