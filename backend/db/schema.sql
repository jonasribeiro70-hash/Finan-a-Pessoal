-- ============================================================================
-- SCHEMA: Finança Pessoal
-- Banco: SQLite (compatível com PostgreSQL com pequenos ajustes de tipos)
-- ============================================================================

PRAGMA foreign_keys = ON;

-- ── USUÁRIOS ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS usuarios (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  nome          TEXT NOT NULL,
  email         TEXT NOT NULL UNIQUE,
  senha_hash    TEXT NOT NULL,
  dica_senha    TEXT,
  criado_em     TEXT NOT NULL DEFAULT (datetime('now')),
  atualizado_em TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ── DESPESAS MENSAIS ────────────────────────────────────────────────────────
-- gid agrupa parcelas de uma mesma compra parcelada (mesmo id usado em todas as parcelas)
-- fid agrupa ocorrências de uma mesma despesa fixa (recorrente mês a mês)
CREATE TABLE IF NOT EXISTS despesas (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  usuario_id    INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  titulo        TEXT NOT NULL,
  valor         REAL NOT NULL CHECK (valor > 0),
  dia           INTEGER NOT NULL CHECK (dia BETWEEN 1 AND 31),
  mes           INTEGER NOT NULL CHECK (mes BETWEEN 1 AND 12),
  ano           INTEGER NOT NULL,
  categoria     TEXT NOT NULL DEFAULT 'Outros',
  status        TEXT NOT NULL DEFAULT 'aguardando' CHECK (status IN ('aguardando','pago')),
  parcelado     INTEGER NOT NULL DEFAULT 0,       -- 0 = false, 1 = true
  n_parcelas    INTEGER NOT NULL DEFAULT 1,
  parcela_atual INTEGER NOT NULL DEFAULT 1,
  gid           TEXT,                              -- agrupador de parcelas da mesma compra
  fixa          INTEGER NOT NULL DEFAULT 0,        -- 0 = false, 1 = true (despesa fixa mensal)
  fid           TEXT,                              -- agrupador das ocorrências de uma despesa fixa
  criado_em     TEXT NOT NULL DEFAULT (datetime('now')),
  atualizado_em TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_despesas_usuario_periodo ON despesas(usuario_id, ano, mes);
CREATE INDEX IF NOT EXISTS idx_despesas_gid ON despesas(gid);
CREATE INDEX IF NOT EXISTS idx_despesas_fid ON despesas(fid);

-- Marca despesas fixas que o usuário decidiu encerrar (excluir "a partir de agora").
-- Enquanto o fid estiver aqui, novas ocorrências mensais deixam de ser geradas,
-- mesmo que ainda existam ocorrências antigas no histórico.
CREATE TABLE IF NOT EXISTS despesas_fixas_encerradas (
  fid          TEXT PRIMARY KEY,
  usuario_id   INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  encerrado_em TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ── DESPESAS FUTURAS ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS despesas_futuras (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  usuario_id    INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  titulo        TEXT NOT NULL,
  valor         REAL NOT NULL CHECK (valor > 0),
  data_estimada TEXT,                               -- formato 'YYYY-MM'
  categoria     TEXT NOT NULL DEFAULT 'Outros',
  observacao    TEXT,
  status        TEXT NOT NULL DEFAULT 'aguardando' CHECK (status IN ('aguardando','pago')),
  criado_em     TEXT NOT NULL DEFAULT (datetime('now')),
  atualizado_em TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_futuras_usuario ON despesas_futuras(usuario_id);

-- ── DEVEDORES ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS devedores (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  usuario_id       INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  nome             TEXT NOT NULL,
  descricao        TEXT,
  valor            REAL NOT NULL CHECK (valor > 0),
  status           TEXT NOT NULL DEFAULT 'aguardando' CHECK (status IN ('aguardando','pago')),
  mes_recebimento  INTEGER CHECK (mes_recebimento BETWEEN 1 AND 12), -- mês em que o pagamento foi marcado como recebido
  ano_recebimento  INTEGER,                                          -- ano em que o pagamento foi marcado como recebido
  criado_em        TEXT NOT NULL DEFAULT (datetime('now')),
  atualizado_em    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_devedores_usuario ON devedores(usuario_id);
CREATE INDEX IF NOT EXISTS idx_devedores_recebimento ON devedores(usuario_id, ano_recebimento, mes_recebimento);

-- ── RENDAS ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS rendas (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  usuario_id    INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  tipo          TEXT NOT NULL DEFAULT 'Salário',
  descricao     TEXT,
  valor         REAL NOT NULL CHECK (valor > 0),
  mes           INTEGER NOT NULL CHECK (mes BETWEEN 1 AND 12),
  ano           INTEGER NOT NULL,
  criado_em     TEXT NOT NULL DEFAULT (datetime('now')),
  atualizado_em TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_rendas_usuario_periodo ON rendas(usuario_id, ano, mes);

-- ── SALDO TRANSFERIDO ────────────────────────────────────────────────────────
-- Registra, por usuário e mês de origem, o valor de saldo que foi somado
-- como renda no mês seguinte. Evita duplicar a transferência ao reabrir o mês.
CREATE TABLE IF NOT EXISTS saldo_transferido (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  usuario_id      INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  ano_origem      INTEGER NOT NULL,
  mes_origem      INTEGER NOT NULL CHECK (mes_origem BETWEEN 1 AND 12),
  valor           REAL NOT NULL,
  renda_id        INTEGER REFERENCES rendas(id) ON DELETE CASCADE, -- renda criada no mês seguinte
  criado_em       TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(usuario_id, ano_origem, mes_origem)
);
