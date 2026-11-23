// Função da Vercel: todas as rotas /api/* chegam aqui (ver vercel.json).
const { tratar } = require('../server.js');
module.exports = (req, res) => tratar(req, res);
