// Migração idempotente: adiciona colunas/tabelas novas em bancos que já
// existiam antes desta atualização, sem quebrar bancos criados do zero
// (onde o schema.sql já vem com tudo) nem bancos que já foram migrados antes.
//
// É chamado automaticamente por db/connection.js sempre que o servidor sobe.

function colunaExiste(db, tabela, coluna) {
  const cols = db.prepare(`PRAGMA table_info(${tabela})`).all();
  return cols.some((c) => c.name === coluna);
}

function tabelaExiste(db, tabela) {
  const r = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name = ?")
    .get(tabela);
  return !!r;
}

function migrar(db) {
  // usuarios.dica_senha
  if (!colunaExiste(db, 'usuarios', 'dica_senha')) {
    db.exec('ALTER TABLE usuarios ADD COLUMN dica_senha TEXT');
    console.log('[migração] usuarios.dica_senha adicionada.');
  }

  // despesas.fixa / despesas.fid
  if (!colunaExiste(db, 'despesas', 'fixa')) {
    db.exec('ALTER TABLE despesas ADD COLUMN fixa INTEGER NOT NULL DEFAULT 0');
    console.log('[migração] despesas.fixa adicionada.');
  }
  if (!colunaExiste(db, 'despesas', 'fid')) {
    db.exec('ALTER TABLE despesas ADD COLUMN fid TEXT');
    db.exec('CREATE INDEX IF NOT EXISTS idx_despesas_fid ON despesas(fid)');
    console.log('[migração] despesas.fid adicionada.');
  }

  // devedores.mes_recebimento / devedores.ano_recebimento
  if (!colunaExiste(db, 'devedores', 'mes_recebimento')) {
    db.exec('ALTER TABLE devedores ADD COLUMN mes_recebimento INTEGER');
    console.log('[migração] devedores.mes_recebimento adicionada.');
  }
  if (!colunaExiste(db, 'devedores', 'ano_recebimento')) {
    db.exec('ALTER TABLE devedores ADD COLUMN ano_recebimento INTEGER');
    db.exec('CREATE INDEX IF NOT EXISTS idx_devedores_recebimento ON devedores(usuario_id, ano_recebimento, mes_recebimento)');
    console.log('[migração] devedores.ano_recebimento adicionada.');
  }

  // tabela saldo_transferido
  if (!tabelaExiste(db, 'saldo_transferido')) {
    db.exec(`
      CREATE TABLE saldo_transferido (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        usuario_id      INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
        ano_origem      INTEGER NOT NULL,
        mes_origem      INTEGER NOT NULL CHECK (mes_origem BETWEEN 1 AND 12),
        valor           REAL NOT NULL,
        renda_id        INTEGER REFERENCES rendas(id) ON DELETE CASCADE,
        criado_em       TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(usuario_id, ano_origem, mes_origem)
      )
    `);
    console.log('[migração] tabela saldo_transferido criada.');
  }

  // tabela despesas_fixas_encerradas
  if (!tabelaExiste(db, 'despesas_fixas_encerradas')) {
    db.exec(`
      CREATE TABLE despesas_fixas_encerradas (
        fid          TEXT PRIMARY KEY,
        usuario_id   INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
        encerrado_em TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `);
    console.log('[migração] tabela despesas_fixas_encerradas criada.');
  }
}

module.exports = { migrar };
