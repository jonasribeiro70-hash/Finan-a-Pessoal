const express = require('express');
const db = require('../db/connection');
const { exigirAutenticacao } = require('../middleware/auth');

const router = express.Router();
router.use(exigirAutenticacao);

function pertenceAoUsuario(id, usuarioId) {
  return db.prepare('SELECT id FROM despesas_futuras WHERE id = ? AND usuario_id = ?').get(id, usuarioId);
}

router.get('/', (req, res) => {
  const futuras = db
    .prepare('SELECT * FROM despesas_futuras WHERE usuario_id = ? ORDER BY data_estimada')
    .all(req.usuarioId);
  res.json({ futuras });
});

router.post('/', (req, res) => {
  const { titulo, valor, dataEstimada, categoria, observacao } = req.body;
  if (!titulo || !titulo.trim()) return res.status(400).json({ erro: 'Título é obrigatório.' });
  if (!valor || Number(valor) <= 0) return res.status(400).json({ erro: 'Valor deve ser maior que zero.' });

  const info = db.prepare(`
    INSERT INTO despesas_futuras (usuario_id, titulo, valor, data_estimada, categoria, observacao, status)
    VALUES (?, ?, ?, ?, ?, ?, 'aguardando')
  `).run(req.usuarioId, titulo.trim(), Number(valor), dataEstimada || null, categoria || 'Outros', observacao || null);

  const criada = db.prepare('SELECT * FROM despesas_futuras WHERE id = ?').get(info.lastInsertRowid);
  res.status(201).json({ futura: criada });
});

router.put('/:id', (req, res) => {
  if (!pertenceAoUsuario(req.params.id, req.usuarioId)) {
    return res.status(404).json({ erro: 'Despesa futura não encontrada.' });
  }
  const atual = db.prepare('SELECT * FROM despesas_futuras WHERE id = ?').get(req.params.id);
  const { titulo, valor, dataEstimada, categoria, observacao, status } = req.body;

  if (valor !== undefined && Number(valor) <= 0) {
    return res.status(400).json({ erro: 'Valor deve ser maior que zero.' });
  }
  if (status !== undefined && !['aguardando', 'pago'].includes(status)) {
    return res.status(400).json({ erro: "Status inválido." });
  }

  db.prepare(`
    UPDATE despesas_futuras
    SET titulo = @titulo, valor = @valor, data_estimada = @data_estimada,
        categoria = @categoria, observacao = @observacao, status = @status,
        atualizado_em = datetime('now')
    WHERE id = @id
  `).run({
    titulo: titulo !== undefined ? titulo.trim() : atual.titulo,
    valor: valor !== undefined ? Number(valor) : atual.valor,
    data_estimada: dataEstimada !== undefined ? dataEstimada : atual.data_estimada,
    categoria: categoria !== undefined ? categoria : atual.categoria,
    observacao: observacao !== undefined ? observacao : atual.observacao,
    status: status !== undefined ? status : atual.status,
    id: req.params.id,
  });

  res.json({ futura: db.prepare('SELECT * FROM despesas_futuras WHERE id = ?').get(req.params.id) });
});

router.patch('/:id/status', (req, res) => {
  if (!pertenceAoUsuario(req.params.id, req.usuarioId)) {
    return res.status(404).json({ erro: 'Despesa futura não encontrada.' });
  }
  const atual = db.prepare('SELECT status FROM despesas_futuras WHERE id = ?').get(req.params.id);
  const novoStatus = atual.status === 'pago' ? 'aguardando' : 'pago';
  db.prepare("UPDATE despesas_futuras SET status = ?, atualizado_em = datetime('now') WHERE id = ?")
    .run(novoStatus, req.params.id);
  res.json({ id: Number(req.params.id), status: novoStatus });
});

router.delete('/:id', (req, res) => {
  if (!pertenceAoUsuario(req.params.id, req.usuarioId)) {
    return res.status(404).json({ erro: 'Despesa futura não encontrada.' });
  }
  db.prepare('DELETE FROM despesas_futuras WHERE id = ?').run(req.params.id);
  res.json({ ok: true, id: Number(req.params.id) });
});

module.exports = router;
