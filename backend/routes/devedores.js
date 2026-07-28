const express = require('express');
const db = require('../db/connection');
const { exigirAutenticacao } = require('../middleware/auth');

const router = express.Router();
router.use(exigirAutenticacao);

function pertenceAoUsuario(id, usuarioId) {
  return db.prepare('SELECT id FROM devedores WHERE id = ? AND usuario_id = ?').get(id, usuarioId);
}

router.get('/', (req, res) => {
  const devedores = db
    .prepare('SELECT * FROM devedores WHERE usuario_id = ? ORDER BY criado_em DESC')
    .all(req.usuarioId);
  res.json({ devedores });
});

router.post('/', (req, res) => {
  const { nome, descricao, valor } = req.body;
  if (!nome || !nome.trim()) return res.status(400).json({ erro: 'Nome é obrigatório.' });
  if (!valor || Number(valor) <= 0) return res.status(400).json({ erro: 'Valor deve ser maior que zero.' });

  const info = db.prepare(`
    INSERT INTO devedores (usuario_id, nome, descricao, valor, status)
    VALUES (?, ?, ?, ?, 'aguardando')
  `).run(req.usuarioId, nome.trim(), descricao || '—', Number(valor));

  res.status(201).json({ devedor: db.prepare('SELECT * FROM devedores WHERE id = ?').get(info.lastInsertRowid) });
});

router.put('/:id', (req, res) => {
  if (!pertenceAoUsuario(req.params.id, req.usuarioId)) {
    return res.status(404).json({ erro: 'Devedor não encontrado.' });
  }
  const atual = db.prepare('SELECT * FROM devedores WHERE id = ?').get(req.params.id);
  const { nome, descricao, valor, status } = req.body;

  if (valor !== undefined && Number(valor) <= 0) {
    return res.status(400).json({ erro: 'Valor deve ser maior que zero.' });
  }
  if (status !== undefined && !['aguardando', 'pago'].includes(status)) {
    return res.status(400).json({ erro: 'Status inválido.' });
  }

  db.prepare(`
    UPDATE devedores
    SET nome = @nome, descricao = @descricao, valor = @valor, status = @status,
        atualizado_em = datetime('now')
    WHERE id = @id
  `).run({
    nome: nome !== undefined ? nome.trim() : atual.nome,
    descricao: descricao !== undefined ? descricao : atual.descricao,
    valor: valor !== undefined ? Number(valor) : atual.valor,
    status: status !== undefined ? status : atual.status,
    id: req.params.id,
  });

  res.json({ devedor: db.prepare('SELECT * FROM devedores WHERE id = ?').get(req.params.id) });
});

// ── PATCH /api/devedores/:id/status ───────────────────────────────────────────
// Ao marcar como "pago" (recebido): registra o mês/ano do recebimento e cria
// automaticamente uma entrada de renda do tipo "Ganho" no mês correspondente,
// somando o valor recebido à renda daquele mês.
// Ao reverter para "aguardando": remove a renda que havia sido criada, para não
// deixar valor fantasma na renda do mês.
router.patch('/:id/status', (req, res) => {
  if (!pertenceAoUsuario(req.params.id, req.usuarioId)) {
    return res.status(404).json({ erro: 'Devedor não encontrado.' });
  }
  const atual = db.prepare('SELECT * FROM devedores WHERE id = ?').get(req.params.id);
  const novoStatus = atual.status === 'pago' ? 'aguardando' : 'pago';

  const executar = db.transaction(() => {
    if (novoStatus === 'pago') {
      const agora = new Date();
      const mesRec = agora.getMonth() + 1;
      const anoRec = agora.getFullYear();

      db.prepare(`
        UPDATE devedores
        SET status = 'pago', mes_recebimento = ?, ano_recebimento = ?, atualizado_em = datetime('now')
        WHERE id = ?
      `).run(mesRec, anoRec, req.params.id);

      db.prepare(`
        INSERT INTO rendas (usuario_id, tipo, descricao, valor, mes, ano)
        VALUES (?, 'Ganho', ?, ?, ?, ?)
      `).run(req.usuarioId, `Recebimento de ${atual.nome}`, atual.valor, mesRec, anoRec);
    } else {
      // reabrindo: remove a renda que foi criada automaticamente para este devedor
      if (atual.mes_recebimento && atual.ano_recebimento) {
        db.prepare(`
          DELETE FROM rendas
          WHERE usuario_id = ? AND tipo = 'Ganho' AND descricao = ? AND valor = ? AND mes = ? AND ano = ?
        `).run(req.usuarioId, `Recebimento de ${atual.nome}`, atual.valor, atual.mes_recebimento, atual.ano_recebimento);
      }
      db.prepare(`
        UPDATE devedores
        SET status = 'aguardando', mes_recebimento = NULL, ano_recebimento = NULL, atualizado_em = datetime('now')
        WHERE id = ?
      `).run(req.params.id);
    }
  });
  executar();

  res.json({ id: Number(req.params.id), status: novoStatus });
});

router.delete('/:id', (req, res) => {
  if (!pertenceAoUsuario(req.params.id, req.usuarioId)) {
    return res.status(404).json({ erro: 'Devedor não encontrado.' });
  }
  db.prepare('DELETE FROM devedores WHERE id = ?').run(req.params.id);
  res.json({ ok: true, id: Number(req.params.id) });
});

module.exports = router;
