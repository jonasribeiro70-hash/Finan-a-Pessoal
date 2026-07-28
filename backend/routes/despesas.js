const express = require('express');
const db = require('../db/connection');
const { exigirAutenticacao } = require('../middleware/auth');

const router = express.Router();
router.use(exigirAutenticacao); // todas as rotas abaixo exigem login

function despesaPertenceAoUsuario(id, usuarioId) {
  return db.prepare('SELECT id FROM despesas WHERE id = ? AND usuario_id = ?').get(id, usuarioId);
}

// Gera, se ainda não existir, a ocorrência do mês/ano pedido para cada despesa
// fixa do usuário (despesa fixa = repete todo mês até o usuário excluí-la).
// É chamado sob demanda sempre que a lista de despesas de um período é buscada.
function gerarOcorrenciasFixasDoPeriodo(usuarioId, ano, mes) {
  // Para cada fid do usuário, pega a ocorrência mais recente (menor ano/mes já criado
  // não importa; usamos a "mais nova" como modelo dos dados a replicar).
  const fixas = db
    .prepare(`
      SELECT * FROM despesas
      WHERE usuario_id = ? AND fixa = 1 AND fid IS NOT NULL
        AND fid NOT IN (SELECT fid FROM despesas_fixas_encerradas WHERE usuario_id = ?)
      GROUP BY fid
      HAVING (ano * 12 + mes) = MAX(ano * 12 + mes)
    `)
    .all(usuarioId, usuarioId);

  const inserirOcorrencia = db.prepare(`
    INSERT INTO despesas (usuario_id, titulo, valor, dia, mes, ano, categoria, status, parcelado, n_parcelas, parcela_atual, gid, fixa, fid)
    VALUES (@usuario_id, @titulo, @valor, @dia, @mes, @ano, @categoria, 'aguardando', 0, 1, 1, NULL, 1, @fid)
  `);

  fixas.forEach((modelo) => {
    const chaveAlvo = ano * 12 + mes;
    const chaveModelo = modelo.ano * 12 + modelo.mes;
    if (chaveAlvo <= chaveModelo) return; // já existe ou é período anterior ao cadastro

    const jaExiste = db
      .prepare('SELECT id FROM despesas WHERE fid = ? AND ano = ? AND mes = ?')
      .get(modelo.fid, ano, mes);
    if (jaExiste) return;

    inserirOcorrencia.run({
      usuario_id: usuarioId,
      titulo: modelo.titulo,
      valor: modelo.valor,
      dia: modelo.dia,
      mes,
      ano,
      categoria: modelo.categoria,
      fid: modelo.fid,
    });
  });
}

// ── GET /api/despesas?ano=2026&mes=7 ────────────────────────────────────────
// Lista despesas do usuário logado, filtrando por período se informado.
// Antes de listar, garante que as despesas fixas já têm ocorrência gerada no período.
router.get('/', (req, res) => {
  const { ano, mes } = req.query;

  if (ano && mes) {
    gerarOcorrenciasFixasDoPeriodo(req.usuarioId, Number(ano), Number(mes));
  }

  let sql = 'SELECT * FROM despesas WHERE usuario_id = ?';
  const params = [req.usuarioId];

  if (ano) {
    sql += ' AND ano = ?';
    params.push(Number(ano));
  }
  if (mes) {
    sql += ' AND mes = ?';
    params.push(Number(mes));
  }
  sql += ' ORDER BY ano, mes, dia';

  const despesas = db.prepare(sql).all(...params);
  res.json({ despesas });
});

// ── GET /api/despesas/:id ────────────────────────────────────────────────────
router.get('/:id', (req, res) => {
  const despesa = despesaPertenceAoUsuario(req.params.id, req.usuarioId);
  if (!despesa) return res.status(404).json({ erro: 'Despesa não encontrada.' });
  const completa = db.prepare('SELECT * FROM despesas WHERE id = ?').get(req.params.id);
  res.json({ despesa: completa });
});

// ── POST /api/despesas ────────────────────────────────────────────────────────
// Cria uma despesa, várias parcelas (parcelado=true), ou uma despesa fixa (fixa=true).
// Parcelado e fixa são mutuamente exclusivos.
router.post('/', (req, res) => {
  const { titulo, valor, dia, categoria, parcelado, nParcelas, fixa, mes, ano } = req.body;

  if (!titulo || !titulo.trim()) return res.status(400).json({ erro: 'Título é obrigatório.' });
  if (!valor || Number(valor) <= 0) return res.status(400).json({ erro: 'Valor deve ser maior que zero.' });
  if (!dia || dia < 1 || dia > 31) return res.status(400).json({ erro: 'Dia de vencimento inválido.' });

  const anoBase = ano || new Date().getFullYear();
  const mesBase = mes || new Date().getMonth() + 1;
  const isParcelado = !!parcelado && !fixa;
  const isFixa = !!fixa && !parcelado;
  const totalParcelas = isParcelado ? Math.max(2, Number(nParcelas) || 2) : 1;
  const gid = isParcelado ? `gid_${Date.now()}_${Math.random().toString(36).slice(2, 8)}` : null;
  const fid = isFixa ? `fid_${Date.now()}_${Math.random().toString(36).slice(2, 8)}` : null;

  const insert = db.prepare(`
    INSERT INTO despesas (usuario_id, titulo, valor, dia, mes, ano, categoria, status, parcelado, n_parcelas, parcela_atual, gid, fixa, fid)
    VALUES (@usuario_id, @titulo, @valor, @dia, @mes, @ano, @categoria, 'aguardando', @parcelado, @n_parcelas, @parcela_atual, @gid, @fixa, @fid)
  `);

  const criarTodasParcelas = db.transaction(() => {
    const criadas = [];
    for (let i = 0; i < totalParcelas; i++) {
      const dataParcela = new Date(anoBase, mesBase - 1 + i, 1);
      const info = insert.run({
        usuario_id: req.usuarioId,
        titulo: titulo.trim(),
        valor: Number(valor),
        dia: Number(dia),
        mes: dataParcela.getMonth() + 1,
        ano: dataParcela.getFullYear(),
        categoria: categoria || 'Outros',
        parcelado: isParcelado ? 1 : 0,
        n_parcelas: totalParcelas,
        parcela_atual: i + 1,
        gid,
        fixa: isFixa ? 1 : 0,
        fid,
      });
      criadas.push(info.lastInsertRowid);
    }
    return criadas;
  });

  const idsCriados = criarTodasParcelas();
  const despesasCriadas = db
    .prepare(`SELECT * FROM despesas WHERE id IN (${idsCriados.map(() => '?').join(',')})`)
    .all(...idsCriados);

  res.status(201).json({ despesas: despesasCriadas });
});

// ── PUT /api/despesas/:id ─────────────────────────────────────────────────────
// Edição individual de UMA despesa/parcela específica (título, valor, dia, categoria, status).
// Não altera as demais parcelas do grupo — edita só o registro apontado.
router.put('/:id', (req, res) => {
  const despesa = despesaPertenceAoUsuario(req.params.id, req.usuarioId);
  if (!despesa) return res.status(404).json({ erro: 'Despesa não encontrada.' });

  const atual = db.prepare('SELECT * FROM despesas WHERE id = ?').get(req.params.id);
  const { titulo, valor, dia, categoria, status } = req.body;

  if (valor !== undefined && Number(valor) <= 0) {
    return res.status(400).json({ erro: 'Valor deve ser maior que zero.' });
  }
  if (dia !== undefined && (dia < 1 || dia > 31)) {
    return res.status(400).json({ erro: 'Dia de vencimento inválido.' });
  }
  if (status !== undefined && !['aguardando', 'pago'].includes(status)) {
    return res.status(400).json({ erro: "Status deve ser 'aguardando' ou 'pago'." });
  }

  const atualizado = {
    titulo: titulo !== undefined ? titulo.trim() : atual.titulo,
    valor: valor !== undefined ? Number(valor) : atual.valor,
    dia: dia !== undefined ? Number(dia) : atual.dia,
    categoria: categoria !== undefined ? categoria : atual.categoria,
    status: status !== undefined ? status : atual.status,
  };

  db.prepare(`
    UPDATE despesas
    SET titulo = @titulo, valor = @valor, dia = @dia, categoria = @categoria, status = @status,
        atualizado_em = datetime('now')
    WHERE id = @id
  `).run({ ...atualizado, id: req.params.id });

  const resultado = db.prepare('SELECT * FROM despesas WHERE id = ?').get(req.params.id);
  res.json({ despesa: resultado });
});

// ── PATCH /api/despesas/:id/status ───────────────────────────────────────────
// Atalho para alternar apenas o status (pago/aguardando), usado pelo botão de toggle.
router.patch('/:id/status', (req, res) => {
  const despesa = despesaPertenceAoUsuario(req.params.id, req.usuarioId);
  if (!despesa) return res.status(404).json({ erro: 'Despesa não encontrada.' });

  const atual = db.prepare('SELECT status FROM despesas WHERE id = ?').get(req.params.id);
  const novoStatus = atual.status === 'pago' ? 'aguardando' : 'pago';

  db.prepare("UPDATE despesas SET status = ?, atualizado_em = datetime('now') WHERE id = ?")
    .run(novoStatus, req.params.id);

  res.json({ id: Number(req.params.id), status: novoStatus });
});

// ── DELETE /api/despesas/:id ──────────────────────────────────────────────────
// Exclusão individual: remove SOMENTE esta despesa/parcela específica.
router.delete('/:id', (req, res) => {
  const despesa = despesaPertenceAoUsuario(req.params.id, req.usuarioId);
  if (!despesa) return res.status(404).json({ erro: 'Despesa não encontrada.' });

  db.prepare('DELETE FROM despesas WHERE id = ?').run(req.params.id);
  res.json({ ok: true, id: Number(req.params.id) });
});

// ── DELETE /api/despesas/grupo/:gid ───────────────────────────────────────────
// Exclusão em lote: remove as parcelas restantes (atual e futuras) de uma compra parcelada.
router.delete('/grupo/:gid', (req, res) => {
  const parcelas = db
    .prepare('SELECT * FROM despesas WHERE gid = ? AND usuario_id = ?')
    .all(req.params.gid, req.usuarioId);

  if (!parcelas.length) return res.status(404).json({ erro: 'Grupo de parcelas não encontrado.' });

  const referencia = despesaPertenceAoUsuario(req.query.aPartirDe, req.usuarioId) ||
    db.prepare('SELECT * FROM despesas WHERE id = ?').get(req.query.aPartirDe);

  if (referencia) {
    // remove só a parcela de referência em diante (ano/mes >= referência)
    db.prepare(`
      DELETE FROM despesas
      WHERE gid = ? AND usuario_id = ?
        AND (ano > @ano OR (ano = @ano AND mes >= @mes))
    `).run(req.params.gid, req.usuarioId, { ano: referencia.ano, mes: referencia.mes });
  } else {
    db.prepare('DELETE FROM despesas WHERE gid = ? AND usuario_id = ?').run(req.params.gid, req.usuarioId);
  }

  res.json({ ok: true, gid: req.params.gid });
});

// ── DELETE /api/despesas/grupo-fixo/:fid ──────────────────────────────────────
// Exclui uma despesa fixa: remove a ocorrência atual em diante (a partir do id
// de referência) e, por não existir mais ocorrência "mais recente" futura,
// nenhuma nova ocorrência será gerada nos próximos meses. Meses já passados
// permanecem no histórico.
router.delete('/grupo-fixo/:fid', (req, res) => {
  const ocorrencias = db
    .prepare('SELECT * FROM despesas WHERE fid = ? AND usuario_id = ?')
    .all(req.params.fid, req.usuarioId);

  if (!ocorrencias.length) return res.status(404).json({ erro: 'Despesa fixa não encontrada.' });

  const referencia = db.prepare('SELECT * FROM despesas WHERE id = ? AND usuario_id = ?')
    .get(req.query.aPartirDe, req.usuarioId);

  const executar = db.transaction(() => {
    if (referencia) {
      db.prepare(`
        DELETE FROM despesas
        WHERE fid = ? AND usuario_id = ?
          AND (ano > @ano OR (ano = @ano AND mes >= @mes))
      `).run(req.params.fid, req.usuarioId, { ano: referencia.ano, mes: referencia.mes });
    } else {
      db.prepare('DELETE FROM despesas WHERE fid = ? AND usuario_id = ?').run(req.params.fid, req.usuarioId);
    }

    // marca como encerrada para não gerar novas ocorrências em meses futuros
    db.prepare(`
      INSERT INTO despesas_fixas_encerradas (fid, usuario_id)
      VALUES (?, ?)
      ON CONFLICT(fid) DO NOTHING
    `).run(req.params.fid, req.usuarioId);
  });
  executar();

  res.json({ ok: true, fid: req.params.fid });
});

module.exports = router;
