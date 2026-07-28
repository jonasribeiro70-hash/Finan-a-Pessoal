const jwt = require('jsonwebtoken');
require('dotenv').config();

const JWT_SECRET = process.env.JWT_SECRET;

if (!JWT_SECRET || JWT_SECRET === 'troque_esta_chave_por_uma_string_aleatoria_bem_longa') {
  console.warn(
    '[AVISO] JWT_SECRET não foi configurado com um valor seguro no .env. ' +
    'Gere uma chave forte antes de usar em produção.'
  );
}

/**
 * Middleware que exige um token JWT válido no header Authorization: Bearer <token>.
 * Em caso de sucesso, anexa req.usuarioId com o id do usuário autenticado.
 */
function exigirAutenticacao(req, res, next) {
  const authHeader = req.headers.authorization || '';
  const [scheme, token] = authHeader.split(' ');

  if (scheme !== 'Bearer' || !token) {
    return res.status(401).json({ erro: 'Token de autenticação ausente ou mal formatado.' });
  }

  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.usuarioId = payload.sub;
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ erro: 'Sessão expirada. Faça login novamente.' });
    }
    return res.status(401).json({ erro: 'Token inválido.' });
  }
}

module.exports = { exigirAutenticacao, JWT_SECRET };
