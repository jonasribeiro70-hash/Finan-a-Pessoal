const express = require('express');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

// Impede o servidor de subir com uma configuração que vai quebrar o cadastro/login
// mais tarde (é melhor falhar aqui, de forma clara, do que no meio de um cadastro).
if (!process.env.JWT_SECRET || process.env.JWT_SECRET.trim() === '') {
  console.error(
    '\n[ERRO FATAL] A variável JWT_SECRET não está definida no arquivo .env.\n' +
    'Copie .env.example para .env e defina um valor para JWT_SECRET antes de iniciar o servidor.\n' +
    'Gere uma chave com: node -e "console.log(require(\'crypto\').randomBytes(64).toString(\'hex\'))"\n'
  );
  process.exit(1);
}

// Garante que o banco e as tabelas existem antes de subir as rotas
require('./db/connection');

const authRoutes = require('./routes/auth');
const despesasRoutes = require('./routes/despesas');
const futurasRoutes = require('./routes/futuras');
const devedoresRoutes = require('./routes/devedores');
const rendasRoutes = require('./routes/rendas');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// ── Rotas da API ──────────────────────────────────────────────────────────────
app.use('/api/auth', authRoutes);
app.use('/api/despesas', despesasRoutes);
app.use('/api/futuras', futurasRoutes);
app.use('/api/devedores', devedoresRoutes);
app.use('/api/rendas', rendasRoutes);

app.get('/api/health', (req, res) => res.json({ status: 'ok' }));

// ── Frontend estático ──────────────────────────────────────────────────────────
app.use(express.static(path.join(__dirname, '..', 'public')));
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/')) return next();
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

// ── Tratamento de erros genérico ────────────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ erro: 'Erro interno do servidor.' });
});

app.listen(PORT, () => {
  console.log(`Servidor rodando em http://localhost:${PORT}`);
});
