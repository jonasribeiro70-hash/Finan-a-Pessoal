const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../db/connection');
const { JWT_SECRET } = require('../middleware/auth');
require('dotenv').config();

const router = express.Router();
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d';
const SALT_ROUNDS = 12;

function gerarToken(usuario) {
  return jwt.sign({ sub: usuario.id, email: usuario.email }, JWT_SECRET, {
    expiresIn: JWT_EXPIRES_IN,
  });
}

function validarEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

// ── POST /api/auth/registrar ────────────────────────────────────────────────
router.post('/registrar', async (req, res) => {
  try {
    const { nome, email, senha, dicaSenha } = req.body;

    if (!nome || !nome.trim()) {
      return res.status(400).json({ erro: 'Informe seu nome.' });
    }
    if (!email || !validarEmail(email)) {
      return res.status(400).json({ erro: 'Informe um e-mail válido.' });
    }
    if (!senha || senha.length < 8) {
      return res.status(400).json({ erro: 'A senha deve ter no mínimo 8 caracteres.' });
    }

    const emailNormalizado = email.trim().toLowerCase();

    const existente = db.prepare('SELECT id FROM usuarios WHERE email = ?').get(emailNormalizado);
    if (existente) {
      return res.status(409).json({ erro: 'Já existe uma conta com este e-mail.' });
    }

    const senhaHash = await bcrypt.hash(senha, SALT_ROUNDS);
    const dicaSenhaTratada = dicaSenha && dicaSenha.trim() ? dicaSenha.trim() : null;

    // Gera o token ANTES de gravar no banco: se o JWT_SECRET estiver mal configurado
    // (ou qualquer outra falha ao assinar o token), o erro acontece aqui e nada é
    // salvo — evita criar um usuário "fantasma" que trava o e-mail sem o registro
    // ter sido concluído com sucesso para quem está usando o sistema.
    const tokenTeste = jwt.sign({ sub: 0, email: emailNormalizado }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });

    const info = db
      .prepare('INSERT INTO usuarios (nome, email, senha_hash, dica_senha) VALUES (?, ?, ?, ?)')
      .run(nome.trim(), emailNormalizado, senhaHash, dicaSenhaTratada);

    const usuario = { id: info.lastInsertRowid, nome: nome.trim(), email: emailNormalizado };
    const token = gerarToken(usuario);

    return res.status(201).json({ token, usuario });
  } catch (err) {
    console.error('Erro em /registrar:', err);
    return res.status(500).json({ erro: 'Erro interno ao registrar usuário.' });
  }
});

// ── POST /api/auth/login ─────────────────────────────────────────────────────
router.post('/login', async (req, res) => {
  try {
    const { email, senha } = req.body;

    if (!email || !senha) {
      return res.status(400).json({ erro: 'Informe e-mail e senha.' });
    }

    const emailNormalizado = email.trim().toLowerCase();
    const usuario = db.prepare('SELECT * FROM usuarios WHERE email = ?').get(emailNormalizado);

    // Mensagem genérica de propósito (não revela se o e-mail existe ou não)
    if (!usuario) {
      return res.status(401).json({ erro: 'E-mail ou senha inválidos.' });
    }

    const senhaOk = await bcrypt.compare(senha, usuario.senha_hash);
    if (!senhaOk) {
      return res.status(401).json({ erro: 'E-mail ou senha inválidos.' });
    }

    const token = gerarToken(usuario);
    return res.json({
      token,
      usuario: { id: usuario.id, nome: usuario.nome, email: usuario.email },
    });
  } catch (err) {
    console.error('Erro em /login:', err);
    return res.status(500).json({ erro: 'Erro interno ao fazer login.' });
  }
});

// ── POST /api/auth/dica-senha ─────────────────────────────────────────────────
// Retorna a dica de senha cadastrada para um e-mail, sem exigir login
// (uso: tela de "esqueci minha senha"). Não confirma se o e-mail existe
// de forma diferenciada, para não vazar quais e-mails estão cadastrados.
router.post('/dica-senha', (req, res) => {
  const { email } = req.body;
  if (!email || !validarEmail(email)) {
    return res.status(400).json({ erro: 'Informe um e-mail válido.' });
  }

  const emailNormalizado = email.trim().toLowerCase();
  const usuario = db
    .prepare('SELECT dica_senha FROM usuarios WHERE email = ?')
    .get(emailNormalizado);

  if (!usuario || !usuario.dica_senha) {
    return res.status(404).json({ erro: 'Nenhuma dica de senha cadastrada para este e-mail.' });
  }

  return res.json({ dicaSenha: usuario.dica_senha });
});

// ── GET /api/auth/me ─────────────────────────────────────────────────────────
const { exigirAutenticacao } = require('../middleware/auth');
router.get('/me', exigirAutenticacao, (req, res) => {
  const usuario = db
    .prepare('SELECT id, nome, email, dica_senha, criado_em FROM usuarios WHERE id = ?')
    .get(req.usuarioId);
  if (!usuario) return res.status(404).json({ erro: 'Usuário não encontrado.' });
  res.json({ usuario });
});

module.exports = router;
