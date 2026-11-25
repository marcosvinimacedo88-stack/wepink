'use strict';
/*
 * Ponte MySQL · Portal Wepink · AGF Morada dos Lagos
 * Roda na rede local, ao lado do MySQL. Expõe só as consultas de consultas.js, somente leitura, com token.
 * Iniciar:  node --env-file=.env ponte.js   (Node 20.6+)
 */
const http = require('http');
const crypto = require('crypto');
const mysql = require('mysql2/promise');

const env = process.env;
const PORTA = Number(env.PONTE_PORTA || 8787);
const TOKEN = String(env.PONTE_TOKEN || '');
const LIMITE = Number(env.LIMITE_LINHAS || 5000);
const TEMPO = Number(env.TEMPO_LIMITE_MS || 20000);
if (TOKEN.length < 32) { console.error('Defina PONTE_TOKEN com pelo menos 32 caracteres no .env.'); process.exit(1); }

let consultas = require('./consultas');

const pool = mysql.createPool({
  host: env.MYSQL_HOST || '127.0.0.1',
  port: Number(env.MYSQL_PORTA || 3306),
  user: env.MYSQL_USUARIO,
  password: env.MYSQL_SENHA,
  database: env.MYSQL_BANCO,
  connectionLimit: 5,
  dateStrings: true,          // datas voltam como texto, sem fuso
  namedPlaceholders: true,    // :nome nos SQL
  supportBigNumbers: true,
  bigNumberStrings: false,
  connectTimeout: 10000
});

// nunca derrubar a ponte por um erro inesperado: registra e continua no ar
process.on('uncaughtException', e => console.error(new Date().toISOString(), 'ERRO INESPERADO', e && (e.code || ''), e && e.message));
process.on('unhandledRejection', e => console.error(new Date().toISOString(), 'ERRO INESPERADO', e && (e.code || ''), e && e.message));
pool.pool.on('connection', c => c.on('error', e => console.error(new Date().toISOString(), 'conexão MySQL', e.code || '', e.message)));

/* ---------- cubadoras: descobre a coluna de hora de cada tabela ---------- */
const momentos = {}; // tabela -> expressão SQL do momento da bipagem
async function momentoDe(tabela, preferida) {
  if (momentos[tabela]) return momentos[tabela];
  const [cols] = await pool.query(
    `SELECT COLUMN_NAME AS c, DATA_TYPE AS t FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`, [tabela]);
  if (!cols.length) throw new Error(`Tabela ${tabela} não encontrada no banco ${env.MYSQL_BANCO}.`);
  const nomes = cols.map(x => x.c.toLowerCase());
  if (!nomes.includes('data1')) throw new Error(`A tabela ${tabela} não tem a coluna data1. Colunas: ${cols.map(x => x.c).join(', ')}`);
  if (!nomes.includes('operador')) throw new Error(`A tabela ${tabela} não tem a coluna operador. Colunas: ${cols.map(x => x.c).join(', ')}`);
  if (preferida && !nomes.includes(preferida.toLowerCase())) throw new Error(`A tabela ${tabela} não tem a coluna ${preferida}. Colunas: ${cols.map(x => x.c).join(', ')}`);
  const hora = (preferida && cols.find(x => x.c.toLowerCase() === preferida.toLowerCase()))
    || cols.find(x => x.c.toLowerCase() === 'hora')
    || cols.find(x => String(x.t).toLowerCase() === 'time')
    || cols.find(x => /^hor/i.test(x.c));
  const expr = hora ? `TIMESTAMP(DATE(data1), \`${hora.c}\`)` : 'CAST(data1 AS DATETIME)';
  console.log(new Date().toISOString(), `cubadora: tabela ${tabela} usa ${expr}`);
  return (momentos[tabela] = expr);
}
async function sqlDe(def) {
  if (!def.sqlPorTabela) return def.sql;
  const partes = [];
  for (const t of def.tabelasCubadora) partes.push(def.sqlPorTabela(t).split('{M}').join(await momentoDe(t, (def.horaCubadora || {})[t])));
  return partes.join('\n          UNION ALL\n');
}

/* ---------- segurança ---------- */
const hashToken = crypto.createHash('sha256').update(TOKEN).digest();
function autorizado(req) {
  const m = /^Bearer\s+(.+)$/.exec(req.headers.authorization || '');
  if (!m) return false;
  return crypto.timingSafeEqual(crypto.createHash('sha256').update(m[1]).digest(), hashToken);
}
const tentativas = new Map(); // ip -> {n, ate}
function bloqueado(ip) { const t = tentativas.get(ip); return t && t.n >= 10 && t.ate > Date.now(); }
function falhou(ip) { const t = tentativas.get(ip) || { n: 0, ate: 0 }; t.n = t.ate < Date.now() ? 1 : t.n + 1; t.ate = Date.now() + 15 * 60e3; tentativas.set(ip, t); }

/* ---------- parâmetros ---------- */
function validar(def, entrada) {
  const saida = {};
  for (const p of def.parametros || []) {
    let v = entrada ? entrada[p.nome] : undefined;
    if (v === '' || v == null) v = p.padrao;
    if (v === '' || v == null) {
      if (p.obrigatorio) throw new Error(`Informe ${p.rotulo || p.nome}.`);
      saida[p.nome] = null; continue;
    }
    if (p.tipo === 'data') { if (!/^\d{4}-\d{2}-\d{2}$/.test(String(v))) throw new Error(`${p.rotulo || p.nome}: data inválida.`); saida[p.nome] = String(v); }
    else if (p.tipo === 'hora') { const h = String(v); if (!/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/.test(h)) throw new Error(`${p.rotulo || p.nome}: hora inválida.`); saida[p.nome] = h.length === 5 ? h + ':00' : h; }
    else if (p.tipo === 'inteiro') { const n = Number(v); if (!Number.isInteger(n)) throw new Error(`${p.rotulo || p.nome}: número inválido.`); saida[p.nome] = n; }
    else if (p.tipo === 'lista') { if (!(p.opcoes || []).includes(v)) throw new Error(`${p.rotulo || p.nome}: opção inválida.`); saida[p.nome] = v; }
    else { const s = String(v).slice(0, 100); saida[p.nome] = s; }
  }
  return saida;
}
const somenteLeitura = sql => /^\s*(SELECT|WITH|SHOW)\b/i.test(sql) && !/;\s*\S/.test(sql.replace(/'[^']*'/g, ''));

/* ---------- http ---------- */
function json(res, status, dados) {
  const corpo = JSON.stringify(dados, (k, v) => typeof v === 'bigint' ? v.toString() : Buffer.isBuffer(v) ? `(${v.length} bytes)` : v);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(corpo);
}
function lerCorpo(req) {
  return new Promise(ok => { let s = ''; req.on('data', c => { s += c; if (s.length > 20000) req.destroy(); }); req.on('end', () => { try { ok(JSON.parse(s || '{}')); } catch { ok({}); } }); });
}
const publico = (nome, d) => ({ nome, titulo: d.titulo || nome, descricao: d.descricao || '', perfis: d.perfis || ['admin'], tela: d.tela || null,
  parametros: (d.parametros || []).map(p => ({ nome: p.nome, rotulo: p.rotulo || p.nome, tipo: p.tipo || 'texto', obrigatorio: !!p.obrigatorio, padrao: p.padrao ?? null, opcoes: p.opcoes || null })) });

http.createServer(async (req, res) => {
  const ip = req.headers['cf-connecting-ip'] || req.socket.remoteAddress;
  const url = new URL(req.url, 'http://ponte');
  try {
    if (bloqueado(ip)) return json(res, 429, { erro: 'Muitas tentativas. Aguarde.' });
    if (!autorizado(req)) { falhou(ip); return json(res, 401, { erro: 'Não autorizado.' }); }

    if (req.method === 'GET' && url.pathname === '/saude') {
      const t0 = Date.now();
      const [[r]] = await pool.query({ sql: 'SELECT VERSION() AS versao, NOW() AS agora', timeout: TEMPO });
      return json(res, 200, { ok: true, mysql: r.versao, horaServidor: r.agora, ms: Date.now() - t0, consultas: Object.keys(consultas).length });
    }
    if (req.method === 'GET' && url.pathname === '/consultas') {
      return json(res, 200, { consultas: Object.entries(consultas).map(([n, d]) => publico(n, d)) });
    }
    const m = /^\/consulta\/([\w-]{1,60})$/.exec(url.pathname);
    if (req.method === 'POST' && m) {
      const def = consultas[m[1]];
      if (!def) return json(res, 404, { erro: 'Consulta não cadastrada na ponte.' });
      const params = validar(def, await lerCorpo(req));
      const sql = await sqlDe(def);
      if (!somenteLeitura(sql)) return json(res, 500, { erro: 'A consulta cadastrada não é somente leitura.' });
      const t0 = Date.now();
      const [linhas, campos] = await pool.query({ sql, timeout: TEMPO }, params);
      const lista = Array.isArray(linhas) ? linhas : [];
      console.log(new Date().toISOString(), ip, m[1], lista.length + ' linhas', (Date.now() - t0) + 'ms');
      const lim = Number(def.limite || LIMITE);
      return json(res, 200, {
        consulta: m[1], ms: Date.now() - t0, total: lista.length, truncado: lista.length > lim,
        colunas: (campos || []).map(c => c.name), linhas: lista.slice(0, lim)
      });
    }
    return json(res, 404, { erro: 'Rota não encontrada.' });
  } catch (e) {
    console.error(new Date().toISOString(), ip, url.pathname, e.code || '', e.sqlMessage || e.message);
    const msg = /Informe|inválid|não encontrada|não tem a coluna/.test(e.message) ? e.message
      : e.code === 'ECONNREFUSED' ? 'A ponte não conseguiu conectar no MySQL.'
      : e.code === 'PROTOCOL_SEQUENCE_TIMEOUT' ? 'A consulta demorou demais.' : 'Erro ao consultar o MySQL: ' + (e.sqlMessage || e.message);
    json(res, /Informe|inválid/.test(e.message) ? 400 : 500, { erro: msg });
  }
}).listen(PORTA, env.PONTE_ENDERECO || '127.0.0.1', () => {
  console.log(`Ponte MySQL ouvindo em http://${env.PONTE_ENDERECO || '127.0.0.1'}:${PORTA} · ${Object.keys(consultas).length} consultas liberadas`);
});
