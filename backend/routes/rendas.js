const express = require('express');
const db = require('../db/connection');
const { exigirAutenticacao } = require('../middleware/auth');

const router = express.Router();
router.use(exigirAutenticacao);

function pertenceAoUsuario(id, usuarioId) {
  return db.prepare('SELECT id FROM rendas WHERE id = ? AND usuario_id = ?').get(id, usuarioId);
}

router.get('/', (req, res) => {
  const { ano, mes } = req.query;
  let sql = 'SELECT * FROM rendas WHERE usuario_id = ?';
  const params = [req.usuarioId];
  if (ano) { sql += ' AND ano = ?'; params.push(Number(ano)); }
  if (mes) { sql += ' AND mes = ?'; params.push(Number(mes)); }
  sql += ' ORDER BY criado_em DESC';
  res.json({ rendas: db.prepare(sql).all(...params) });
});

router.post('/', (req, res) => {
  const { tipo, descricao, valor, mes, ano } = req.body;
  if (!valor || Number(valor) <= 0) return res.status(400).json({ erro: 'Valor deve ser maior que zero.' });

  const info = db.prepare(`
    INSERT INTO rendas (usuario_id, tipo, descricao, valor, mes, ano)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    req.usuarioId,
    tipo || 'Salário',
    descricao || null,
    Number(valor),
    mes || new Date().getMonth() + 1,
    ano || new Date().getFullYear()
  );

  res.status(201).json({ renda: db.prepare('SELECT * FROM rendas WHERE id = ?').get(info.lastInsertRowid) });
});

router.put('/:id', (req, res) => {
  if (!pertenceAoUsuario(req.params.id, req.usuarioId)) {
    return res.status(404).json({ erro: 'Renda não encontrada.' });
  }
  const atual = db.prepare('SELECT * FROM rendas WHERE id = ?').get(req.params.id);
  const { tipo, descricao, valor } = req.body;

  if (valor !== undefined && Number(valor) <= 0) {
    return res.status(400).json({ erro: 'Valor deve ser maior que zero.' });
  }

  db.prepare(`
    UPDATE rendas SET tipo = @tipo, descricao = @descricao, valor = @valor, atualizado_em = datetime('now')
    WHERE id = @id
  `).run({
    tipo: tipo !== undefined ? tipo : atual.tipo,
    descricao: descricao !== undefined ? descricao : atual.descricao,
    valor: valor !== undefined ? Number(valor) : atual.valor,
    id: req.params.id,
  });

  res.json({ renda: db.prepare('SELECT * FROM rendas WHERE id = ?').get(req.params.id) });
});

router.delete('/:id', (req, res) => {
  if (!pertenceAoUsuario(req.params.id, req.usuarioId)) {
    return res.status(404).json({ erro: 'Renda não encontrada.' });
  }
  db.prepare('DELETE FROM rendas WHERE id = ?').run(req.params.id);
  res.json({ ok: true, id: Number(req.params.id) });
});

// ── POST /api/rendas/transferir-saldo ─────────────────────────────────────────
// Calcula o saldo geral (renda - despesas) do mês informado e soma esse valor
// como uma entrada de renda no mês seguinte. Se já houver uma transferência
// feita para aquele mês de origem, ela é atualizada (não duplica).
// Body: { mes, ano } — mês/ano de ORIGEM do saldo a transferir.
router.post('/transferir-saldo', (req, res) => {
  const { mes, ano } = req.body;
  if (!mes || !ano) return res.status(400).json({ erro: 'Informe mês e ano de origem.' });

  const totalRenda = db
    .prepare('SELECT COALESCE(SUM(valor),0) AS total FROM rendas WHERE usuario_id = ? AND mes = ? AND ano = ?')
    .get(req.usuarioId, mes, ano).total;
  const totalDespesa = db
    .prepare('SELECT COALESCE(SUM(valor),0) AS total FROM despesas WHERE usuario_id = ? AND mes = ? AND ano = ?')
    .get(req.usuarioId, mes, ano).total;
  const saldo = totalRenda - totalDespesa;

  const dataSeguinte = new Date(ano, mes, 1); // mes (1-based) já aponta pro mês seguinte no construtor 0-based
  const mesSeguinte = dataSeguinte.getMonth() + 1;
  const anoSeguinte = dataSeguinte.getFullYear();

  const executar = db.transaction(() => {
    const existente = db
      .prepare('SELECT * FROM saldo_transferido WHERE usuario_id = ? AND ano_origem = ? AND mes_origem = ?')
      .get(req.usuarioId, ano, mes);

    if (existente) {
      // já existia uma transferência deste mês: atualiza o valor da renda vinculada
      db.prepare('UPDATE rendas SET valor = ?, atualizado_em = datetime(\'now\') WHERE id = ?')
        .run(saldo, existente.renda_id);
      db.prepare('UPDATE saldo_transferido SET valor = ? WHERE id = ?').run(saldo, existente.id);
      return db.prepare('SELECT * FROM rendas WHERE id = ?').get(existente.renda_id);
    }

    const info = db.prepare(`
      INSERT INTO rendas (usuario_id, tipo, descricao, valor, mes, ano)
      VALUES (?, 'Extra', ?, ?, ?, ?)
    `).run(req.usuarioId, `Saldo transferido de ${String(mes).padStart(2, '0')}/${ano}`, saldo, mesSeguinte, anoSeguinte);

    db.prepare(`
      INSERT INTO saldo_transferido (usuario_id, ano_origem, mes_origem, valor, renda_id)
      VALUES (?, ?, ?, ?, ?)
    `).run(req.usuarioId, ano, mes, saldo, info.lastInsertRowid);

    return db.prepare('SELECT * FROM rendas WHERE id = ?').get(info.lastInsertRowid);
  });

  const rendaCriada = executar();
  res.status(201).json({ renda: rendaCriada, saldoTransferido: saldo, mesDestino: mesSeguinte, anoDestino: anoSeguinte });
});

// ── GET /api/rendas/saldo-transferido?ano=2026&mes=7 ──────────────────────────
// Informa se o saldo do mês informado (como ORIGEM) já foi transferido.
router.get('/saldo-transferido', (req, res) => {
  const { ano, mes } = req.query;
  if (!ano || !mes) return res.status(400).json({ erro: 'Informe ano e mês.' });
  const registro = db
    .prepare('SELECT * FROM saldo_transferido WHERE usuario_id = ? AND ano_origem = ? AND mes_origem = ?')
    .get(req.usuarioId, Number(ano), Number(mes));
  res.json({ transferido: !!registro, registro: registro || null });
});

module.exports = router;
