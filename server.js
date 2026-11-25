'use strict';
/*
 * Portal de Envios — Wepink (SAVI COSMETICOS LTDA)
 * AGF Morada dos Lagos
 *
 * Servidor HTTP sem framework. Única dependência: mssql.
 * Iniciar:  node --env-file=.env server.js   (Node 20.6 ou superior)
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const env = process.env;
const PORTA = Number(env.PORTA || 3000);
const TABELA = 'REGISTROSMICROPOST';
const FILTRO_REMETENTE = env.FILTRO_REMETENTE || 'SAVI COSMETICOS LTDA';
const SEGREDO = env.SESSAO_SEGREDO || crypto.randomBytes(32).toString('hex');
const SESSAO_HORAS = Number(env.SESSAO_HORAS || 12);
const LIMITE_EXPORT = Number(env.LIMITE_EXPORTACAO || 200000);
const COOKIE_SEGURO = env.HTTPS === '1' || env.VERCEL ? '; Secure' : '';

// Usuários do portal: "usuario:senha;outro:senha2"
const USUARIOS = new Map(
  String(env.PORTAL_USUARIOS || '')
    .split(';').map(s => s.trim()).filter(Boolean)
    .map(s => { const i = s.indexOf(':'); return [s.slice(0, i).trim().toLowerCase(), s.slice(i + 1)]; })
);
if (!USUARIOS.size) console.warn('ATENÇÃO: nenhum usuário em PORTAL_USUARIOS — ninguém conseguirá entrar.');

/* ---------- Faixas de CEP por UF (5 primeiros dígitos) ---------- */
const FAIXAS = [
  ['SP', 1000, 19999], ['RJ', 20000, 28999], ['ES', 29000, 29999], ['MG', 30000, 39999],
  ['BA', 40000, 48999], ['SE', 49000, 49999], ['PE', 50000, 56999], ['AL', 57000, 57999],
  ['PB', 58000, 58999], ['RN', 59000, 59999], ['CE', 60000, 63999], ['PI', 64000, 64999],
  ['MA', 65000, 65999], ['PA', 66000, 68899], ['AP', 68900, 68999], ['AM', 69000, 69299],
  ['RR', 69300, 69399], ['AM', 69400, 69899], ['AC', 69900, 69999], ['DF', 70000, 72799],
  ['GO', 72800, 72999], ['DF', 73000, 73699], ['GO', 73700, 76799], ['RO', 76800, 76999],
  ['TO', 77000, 77999], ['MT', 78000, 78899], ['MS', 79000, 79999], ['PR', 80000, 87999],
  ['SC', 88000, 89999], ['RS', 90000, 99999]
];
const UFS = new Set(FAIXAS.map(f => f[0]));
const CEP5 = `TRY_CAST(LEFT(RIGHT('00000000' + REPLACE(REPLACE(LTRIM(RTRIM(CAST(cep AS varchar(20)))), '-', ''), '.', ''), 8), 5) AS int)`;
const UF_SQL = `CASE ${FAIXAS.map(([u, a, b]) => `WHEN ${CEP5} BETWEEN ${a} AND ${b} THEN '${u}'`).join(' ')} ELSE 'ND' END`;
function cepUF(c) {
  const n = Number(String(c || '').replace(/\D/g, '').padStart(8, '0').slice(0, 5));
  for (const [u, a, b] of FAIXAS) if (n >= a && n <= b) return u;
  return 'ND';
}

/* ---------- Banco de dados ---------- */
let sql, poolPromise;
function pool() {
  if (!sql) sql = require('mssql');
  if (!poolPromise) {
    poolPromise = new sql.ConnectionPool({
      server: env.DB_SERVIDOR,
      port: Number(env.DB_PORTA || 1433),
      user: env.DB_USUARIO,
      password: env.DB_SENHA,
      database: env.DB_BANCO,
      requestTimeout: 60000,
      connectionTimeout: 15000,
      pool: { max: 10, min: 0, idleTimeoutMillis: 30000 },
      options: { encrypt: env.DB_CRIPTOGRAFAR === '1', trustServerCertificate: true }
    }).connect().catch(e => { poolPromise = null; throw e; });
  }
  return poolPromise;
}
async function consulta(texto, params) {
  const p = await pool();
  const req = p.request();
  for (const [nome, valor, tipo] of params) {
    req.input(nome, tipo === 'bin' ? sql.VarBinary(sql.MAX) : tipo === 'max' ? sql.NVarChar(sql.MAX) : tipo === 'n' ? sql.NVarChar(500) : sql.VarChar(300), valor);
  }
  return (await req.query(texto)).recordset;
}

/* ---------- Filtros ---------- */
const reData = /^\d{4}-\d{2}-\d{2}$/;
const ymd = d => d.toISOString().slice(0, 10);
function addDias(s, n) { const d = new Date(s + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return ymd(d); }
function periodo(q) {
  const hoje = ymd(new Date(Date.now() - 3 * 3600e3)); // America/Sao_Paulo
  let fim = reData.test(q.fim || '') ? q.fim : hoje;
  let ini = reData.test(q.ini || '') ? q.ini : addDias(fim, -29);
  if (ini > fim) [ini, fim] = [fim, ini];
  return { ini, fim };
}
const escLike = s => s.replace(/[[\]%_]/g, m => '[' + m + ']');
function filtros(q, ini, fim) {
  const w = ['Remetente LIKE @rem', 'data >= CAST(@ini AS date)', 'data < DATEADD(day, 1, CAST(@fim AS date))'];
  const params = [['rem', '%' + FILTRO_REMETENTE + '%'], ['ini', ini], ['fim', fim]];
  if (q.uf && UFS.has(q.uf)) { w.push(`(${UF_SQL}) = @uf`); params.push(['uf', q.uf]); }
  if (q.depto) { w.push('Remetente = @depto'); params.push(['depto', String(q.depto).slice(0, 300)]); }
  const busca = String(q.q || '').trim().slice(0, 60);
  if (busca) {
    w.push('(registro LIKE @q OR REPLACE(CAST(cep AS varchar(20)), \'-\', \'\') LIKE @qcep)');
    params.push(['q', '%' + escLike(busca) + '%'], ['qcep', '%' + escLike(busca.replace(/\D/g, '') || busca) + '%']);
  }
  return { where: 'WHERE ' + w.join(' AND '), params };
}
const ORDENS = {
  data_desc: 'data DESC', data_asc: 'data ASC', registro: 'registro ASC', cep: 'cep ASC', remetente: 'Remetente ASC, data DESC'
};

/* ---------- Rotas da API ---------- */
async function resumo(q) {
  const { ini, fim } = periodo(q);
  const dias = Math.round((new Date(fim) - new Date(ini)) / 864e5) + 1;
  const f = filtros(q, ini, fim);
  const fa = filtros(q, addDias(ini, -dias), addDias(ini, -1));
  const T = `FROM ${TABELA} ${f.where}`;
  const [tot, ant, porDia, porUF, porDepto] = await Promise.all([
    consulta(`SELECT COUNT(*) n, COUNT(DISTINCT cep) ceps,
                CONVERT(varchar(19), MIN(data), 120) primeiro, CONVERT(varchar(19), MAX(data), 120) ultimo ${T}`, f.params),
    consulta(`SELECT COUNT(*) n FROM ${TABELA} ${fa.where}`, fa.params),
    consulta(`SELECT CONVERT(varchar(10), CAST(data AS date), 23) d, COUNT(*) n ${T}
              GROUP BY CAST(data AS date) ORDER BY CAST(data AS date)`, f.params),
    consulta(`SELECT uf, COUNT(*) n FROM (SELECT ${UF_SQL} uf ${T}) x GROUP BY uf ORDER BY n DESC`, f.params),
    consulta(`SELECT TOP 30 Remetente r, COUNT(*) n ${T} GROUP BY Remetente ORDER BY n DESC`, f.params)
  ]);
  return {
    ini, fim, total: tot[0].n, anterior: ant[0].n, ceps: tot[0].ceps,
    primeiro: tot[0].primeiro, ultimo: tot[0].ultimo,
    dias: porDia, ufs: porUF, deptos: porDepto, geradoEm: new Date().toISOString()
  };
}

async function envios(q) {
  const { ini, fim } = periodo(q);
  const f = filtros(q, ini, fim);
  const tam = Math.min(200, Math.max(10, Number(q.tam) || 25));
  const pag = Math.max(1, Number(q.pag) || 1);
  const ordem = ORDENS[q.ord] || ORDENS.data_desc;
  const comStatus = await tabelaRastreio().catch(() => false);
  const join = comStatus
    ? `LEFT JOIN ${TAB_RAST} rs ON rs.COD_OBJETO = CASE WHEN LEN(LTRIM(RTRIM(registro))) = 11 THEN LTRIM(RTRIM(registro)) + 'BR' ELSE LTRIM(RTRIM(registro)) END`
    : '';
  const extra = comStatus
    ? `, rs.STATUS status, rs.ETAPA etapa, rs.ENTREGUE entregue, rs.ALERTA alerta, CONVERT(varchar(19), rs.CONSULTADO_EM, 120) consultado`
    : '';
  const [tot, linhas] = await Promise.all([
    consulta(`SELECT COUNT(*) n FROM ${TABELA} ${f.where}`, f.params),
    consulta(`SELECT registro, CAST(cep AS varchar(20)) cep, CONVERT(varchar(19), data, 120) data, Remetente remetente${extra}
              FROM ${TABELA} ${join} ${f.where} ORDER BY ${ordem}
              OFFSET ${(pag - 1) * tam} ROWS FETCH NEXT ${tam} ROWS ONLY`, f.params)
  ]);
  return { total: tot[0].n, pag, tam, linhas, rastreioSalvo: comStatus };
}

let cacheOpcoes = { t: 0, v: null };
async function opcoes() {
  if (cacheOpcoes.v && Date.now() - cacheOpcoes.t < 10 * 60e3) return cacheOpcoes.v;
  const deptos = await consulta(
    `SELECT TOP 300 Remetente r, COUNT(*) n FROM ${TABELA}
     WHERE Remetente LIKE @rem AND data >= DATEADD(year, -2, GETDATE())
     GROUP BY Remetente ORDER BY n DESC`, [['rem', '%' + FILTRO_REMETENTE + '%']]);
  cacheOpcoes = { t: Date.now(), v: { deptos: deptos.map(d => d.r) } };
  return cacheOpcoes.v;
}

async function exportarCSV(q, res) {
  const { ini, fim } = periodo(q);
  const f = filtros(q, ini, fim);
  const ordem = ORDENS[q.ord] || ORDENS.data_desc;
  const comStatus = await tabelaRastreio().catch(() => false);
  const linhas = await consulta(
    `SELECT TOP ${LIMITE_EXPORT} registro, CAST(cep AS varchar(20)) cep, CONVERT(varchar(19), data, 120) data, Remetente remetente
       ${comStatus ? `, rs.STATUS status, CONVERT(varchar(19), rs.DATA_ULTIMO_EVENTO, 120) ultimo, CONVERT(varchar(10), rs.PRAZO, 23) prazo, CONVERT(varchar(19), rs.CONSULTADO_EM, 120) consultado` : ''}
     FROM ${TABELA}
       ${comStatus ? `LEFT JOIN ${TAB_RAST} rs ON rs.COD_OBJETO = CASE WHEN LEN(LTRIM(RTRIM(registro))) = 11 THEN LTRIM(RTRIM(registro)) + 'BR' ELSE LTRIM(RTRIM(registro)) END` : ''}
     ${f.where} ORDER BY ${ordem}`, f.params);
  const c = v => { const s = String(v ?? ''); return /[;"\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  const br = s => s ? s.slice(8, 10) + '/' + s.slice(5, 7) + '/' + s.slice(0, 4) + s.slice(10) : '';
  const out = ['Registro;Data de expedição;CEP;UF;Remetente e departamento' + (comStatus ? ';Último status;Data do status;Previsão de entrega;Consultado em' : '')];
  for (const l of linhas) {
    const d = String(l.cep || '').replace(/\D/g, '').padStart(8, '0');
    const base = [l.registro, br(l.data), d.slice(0, 5) + '-' + d.slice(5), cepUF(l.cep), l.remetente];
    if (comStatus) base.push(l.status || 'Não consultado', br(l.ultimo), br(l.prazo), br(l.consultado));
    out.push(base.map(c).join(';'));
  }
  res.writeHead(200, {
    'Content-Type': 'text/csv; charset=utf-8',
    'Content-Disposition': `attachment; filename="envios-wepink_${ini}_a_${fim}.csv"`,
    'Cache-Control': 'no-store'
  });
  res.end('﻿' + out.join('\r\n'));
}

/* ---------- Rastreamento (API dos Correios) ---------- */
const TAB_RAST = /^[A-Za-z_][A-Za-z0-9_.]*$/.test(env.TABELA_RASTREIO || '') ? env.TABELA_RASTREIO : 'PORTAL_RASTREAMENTO';
const CORREIOS_URL = (env.CORREIOS_URL || 'https://api.correios.com.br').replace(/\/+$/, '');
const CACHE_MIN = Number(env.RASTREIO_CACHE_MIN || 30);

let tabelaOk = { v: null, t: 0 };
async function tabelaRastreio() {
  if (tabelaOk.v === true || (tabelaOk.v === false && Date.now() - tabelaOk.t < 60e3)) return tabelaOk.v;
  const r = await consulta(`SELECT CASE WHEN OBJECT_ID(@t, 'U') IS NULL THEN 0 ELSE 1 END ok`, [['t', TAB_RAST]]);
  tabelaOk = { v: !!r[0].ok, t: Date.now() };
  if (!tabelaOk.v) console.warn(`Tabela ${TAB_RAST} não existe: rode criar_tabela_rastreamento.sql para salvar os status.`);
  return tabelaOk.v;
}

function normCod(c) {
  let s = String(c || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (/^[A-Z]{2}\d{9}$/.test(s)) s += 'BR';
  return /^[A-Z]{2}\d{9}[A-Z]{2}$/.test(s) ? s : null;
}

let tokenCache = { v: null, exp: 0 };
async function tokenCorreios() {
  if (tokenCache.v && tokenCache.exp - Date.now() > 5 * 60e3) return tokenCache.v;
  if (!env.CORREIOS_USUARIO || !env.CORREIOS_CHAVE) throw new Error('Rastreamento não configurado (CORREIOS_USUARIO / CORREIOS_CHAVE no .env).');
  const r = await fetch(CORREIOS_URL + '/token/v1/autentica', {
    method: 'POST',
    headers: { Authorization: 'Basic ' + Buffer.from(env.CORREIOS_USUARIO + ':' + env.CORREIOS_CHAVE).toString('base64'), 'Content-Type': 'application/json', Accept: 'application/json', 'Accept-Language': 'pt-BR' },
    signal: AbortSignal.timeout(15000)
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.token) throw new Error('Os Correios recusaram a autenticação' + (j.msgs ? ': ' + [].concat(j.msgs).join(' ') : ` (HTTP ${r.status}).`));
  let exp = Date.parse(j.expiraEm || '');
  if (!(exp > Date.now())) exp = Date.now() + 50 * 60e3;
  tokenCache = { v: j.token, exp };
  return j.token;
}

const local = u => {
  if (!u) return '';
  const e = u.endereco || {};
  const lugar = [e.cidade, e.uf].filter(Boolean).join(' / ');
  return [u.tipo, lugar || u.nome].filter(Boolean).join(' · ');
};
function interpretar(eventos) {
  const ult = eventos[0] || {};
  const d = String(ult.descricao || '').toLowerCase();
  const entregue = /entregue ao destinat/.test(d) || (ult.codigo === 'BDE' && ult.tipo === '01');
  const etapa = entregue ? 4 : /saiu para entrega/.test(d) ? 3 : (eventos.length > 1 || /tr[aâ]nsito|transfer|encaminhad|unidade|chegada|recebido/.test(d)) ? 2 : eventos.length ? 1 : 0;
  const alerta = !entregue && /n[aã]o entregue|devol|extravi|roubad|aguardando retirada|ausente|incorret|recusad|fiscaliza|pendente|n[aã]o atendido|inexistente|insuficiente/.test(d);
  return { etapa, entregue, alerta };
}

// Modo de resultado: T = histórico completo, U = só o último evento (o mesmo do script do SQL Server).
// Se o contrato recusar o T, o portal passa a usar U automaticamente.
let modoResultado = (env.CORREIOS_RESULTADO || 'T').toUpperCase() === 'U' ? 'U' : 'T';
const msgCorreios = j => [].concat(j.msgs || [], j.mensagem || [], j.message || [], j.causa || [])
  .map(m => typeof m === 'string' ? m : (m && (m.texto || m.mensagem || m.message)) || '').filter(Boolean).join(' ');

async function consultarCorreios(cod, tentativa = 0) {
  const tok = await tokenCorreios();
  const r = await fetch(`${CORREIOS_URL}/srorastro/v1/objetos?codigosObjetos=${cod}&resultado=${modoResultado}`, {
    headers: { Authorization: 'Bearer ' + tok, Accept: 'application/json', 'Accept-Language': 'pt-BR' },
    signal: AbortSignal.timeout(20000)
  });
  if (r.status === 401 && tentativa < 1) { tokenCache = { v: null, exp: 0 }; return consultarCorreios(cod, tentativa + 1); }
  const texto = await r.text();
  let j = {}; try { j = JSON.parse(texto); } catch {}
  if (!r.ok && !j.objetos) {
    console.error(new Date().toISOString(), `Correios HTTP ${r.status} (resultado=${modoResultado}) ${cod}:`, texto.slice(0, 500));
    if (r.status === 400 && modoResultado === 'T' && tentativa < 2 && !/idioma|SRO-018/i.test(texto)) {
      modoResultado = 'U';
      console.warn('Correios recusou resultado=T; usando resultado=U (só o último evento) daqui em diante.');
      return consultarCorreios(cod, 2);
    }
    const m = msgCorreios(j);
    throw new Error(m ? `Correios: ${m}` : `Os Correios recusaram a consulta (HTTP ${r.status}). Tente de novo em instantes.`);
  }
  const o = (j.objetos || [])[0] || {};
  const eventos = (o.eventos || []).map(e => ({
    data: String(e.dtHrCriado || '').replace('T', ' ').slice(0, 19),
    descricao: e.descricao || '',
    detalhe: e.detalhe || '',
    codigo: e.codigo || '', tipo: e.tipo || '',
    local: local(e.unidade),
    destino: local(e.unidadeDestino)
  })).sort((a, b) => b.data.localeCompare(a.data));
  const { etapa, entregue, alerta } = interpretar(eventos);
  const ult = eventos[0];
  return {
    cod, eventos, etapa, entregue, alerta,
    status: ult ? ult.descricao : (o.mensagem || 'Objeto ainda sem movimentação nos Correios'),
    detalhe: ult ? (ult.detalhe || (ult.destino ? 'Para ' + ult.destino : '')) : '',
    local: ult ? ult.local : '',
    ultimoEvento: ult ? ult.data : null,
    postagem: eventos.length && (modoResultado === 'T' || /postado/i.test(eventos[eventos.length - 1].descricao)) ? eventos[eventos.length - 1].data : null,
    prazo: o.dtPrevista ? String(o.dtPrevista).slice(0, 10) : null,
    servico: o.tipoPostal ? [o.tipoPostal.categoria, o.tipoPostal.descricao].filter(Boolean).join(' · ') : '',
    mensagem: eventos.length ? '' : (o.mensagem || '')
  };
}

async function lerSalvo(cod) {
  const r = await consulta(`SELECT STATUS status, DETALHE detalhe, LOCAL_ULTIMO local, ETAPA etapa, ENTREGUE entregue, ALERTA alerta,
      CONVERT(varchar(19), DATA_ULTIMO_EVENTO, 120) ultimoEvento, CONVERT(varchar(19), DATA_POSTAGEM, 120) postagem,
      CONVERT(varchar(10), PRAZO, 23) prazo, SERVICO servico, EVENTOS_JSON eventos, MENSAGEM mensagem,
      CONVERT(varchar(19), CONSULTADO_EM, 120) consultadoEm, DATEDIFF(minute, CONSULTADO_EM, SYSDATETIME()) idadeMin
    FROM ${TAB_RAST} WHERE COD_OBJETO = @cod`, [['cod', cod]]);
  if (!r[0]) return null;
  const s = r[0];
  return { cod, ...s, etapa: Number(s.etapa), entregue: !!s.entregue, alerta: !!s.alerta, eventos: JSON.parse(s.eventos || '[]') };
}

async function salvar(d, usuario) {
  const p = [
    ['cod', d.cod], ['status', d.status, 'n'], ['detalhe', d.detalhe, 'n'], ['local', d.local, 'n'],
    ['etapa', String(d.etapa)], ['entregue', d.entregue ? '1' : '0'], ['alerta', d.alerta ? '1' : '0'],
    ['ult', d.ultimoEvento], ['post', d.postagem], ['prazo', d.prazo], ['servico', d.servico, 'n'],
    ['json', JSON.stringify(d.eventos), 'max'], ['msg', d.mensagem, 'n'], ['usuario', usuario]
  ];
  const campos = `STATUS = @status, DETALHE = @detalhe, LOCAL_ULTIMO = @local, ETAPA = @etapa, ENTREGUE = @entregue, ALERTA = @alerta,
    DATA_ULTIMO_EVENTO = TRY_CONVERT(datetime2(0), @ult, 120), DATA_POSTAGEM = TRY_CONVERT(datetime2(0), @post, 120),
    PRAZO = TRY_CONVERT(date, @prazo, 23), SERVICO = @servico, EVENTOS_JSON = @json, MENSAGEM = @msg,
    CONSULTADO_EM = SYSDATETIME(), CONSULTADO_POR = @usuario`;
  await consulta(`
    UPDATE ${TAB_RAST} SET ${campos}, QTD_CONSULTAS = QTD_CONSULTAS + 1 WHERE COD_OBJETO = @cod;
    IF @@ROWCOUNT = 0
      INSERT INTO ${TAB_RAST} (COD_OBJETO, STATUS, DETALHE, LOCAL_ULTIMO, ETAPA, ENTREGUE, ALERTA, DATA_ULTIMO_EVENTO, DATA_POSTAGEM,
                               PRAZO, SERVICO, EVENTOS_JSON, MENSAGEM, CONSULTADO_EM, CONSULTADO_POR, QTD_CONSULTAS)
      VALUES (@cod, @status, @detalhe, @local, @etapa, @entregue, @alerta, TRY_CONVERT(datetime2(0), @ult, 120), TRY_CONVERT(datetime2(0), @post, 120),
              TRY_CONVERT(date, @prazo, 23), @servico, @json, @msg, SYSDATETIME(), @usuario, 1);`, p);
}

const usoRastreio = new Map(); // usuario -> [timestamps]
function limiteRastreio(u) {
  const agora = Date.now(), l = (usoRastreio.get(u) || []).filter(t => agora - t < 60e3);
  l.push(agora); usoRastreio.set(u, l);
  return l.length > Number(env.RASTREIO_POR_MINUTO || 90);
}

async function rastreio(q, usuario) {
  const cod = normCod(q.cod);
  if (!cod) return [400, { erro: 'Código de objeto inválido.' }];
  const pertence = await consulta(
    `SELECT TOP 1 1 ok FROM ${TABELA} WHERE Remetente LIKE @rem AND LTRIM(RTRIM(registro)) IN (@cod, @cod11)`,
    [['rem', '%' + FILTRO_REMETENTE + '%'], ['cod', cod], ['cod11', cod.slice(0, 11)]]);
  if (!pertence.length) return [404, { erro: 'Este objeto não pertence aos envios da Wepink.' }];

  const temTabela = await tabelaRastreio().catch(() => false);
  const salvo = temTabela ? await lerSalvo(cod) : null;
  if (salvo && q.atualizar !== '1' && (salvo.entregue || salvo.idadeMin < CACHE_MIN)) {
    return [200, { ...salvo, origem: 'salvo', salvo: true }];
  }
  if (limiteRastreio(usuario)) return [429, { erro: 'Muitas consultas seguidas. Aguarde um minuto.' }];
  try {
    const d = await consultarCorreios(cod);
    if (temTabela) await salvar(d, usuario);
    return [200, { ...d, consultadoEm: new Date(Date.now() - 3 * 3600e3).toISOString().replace('T', ' ').slice(0, 19), origem: 'correios', salvo: temTabela }];
  } catch (e) {
    console.error(new Date().toISOString(), 'rastreio', cod, e.message);
    if (salvo) return [200, { ...salvo, origem: 'salvo', salvo: true, aviso: 'Os Correios não responderam agora. Mostrando a última consulta salva.' }];
    return [502, { erro: e.message }];
  }
}

/* ---------- Sessão ---------- */
const b64 = s => Buffer.from(s).toString('base64url');
const assinar = s => crypto.createHmac('sha256', SEGREDO).update(s).digest('base64url');
function criarToken(u) {
  const corpo = b64(JSON.stringify({ id: u.id, u: u.login, n: u.nome, p: u.perfil, exp: Date.now() + SESSAO_HORAS * 3600e3 }));
  return corpo + '.' + assinar(corpo);
}
function lerSessao(req) {
  const m = /(?:^|;\s*)sessao=([^;]+)/.exec(req.headers.cookie || '');
  if (!m) return null;
  const [corpo, ass] = m[1].split('.');
  if (!corpo || !ass) return null;
  const esperado = assinar(corpo);
  if (ass.length !== esperado.length || !crypto.timingSafeEqual(Buffer.from(ass), Buffer.from(esperado))) return null;
  try { const s = JSON.parse(Buffer.from(corpo, 'base64url').toString()); return s.exp > Date.now() && s.p ? s : null; } catch { return null; }
}
function senhaConfere(usuario, senha) {
  const certa = USUARIOS.get(String(usuario || '').trim().toLowerCase());
  const a = crypto.createHash('sha256').update(String(senha || '')).digest();
  const b = crypto.createHash('sha256').update(String(certa ?? crypto.randomUUID())).digest();
  return certa !== undefined && crypto.timingSafeEqual(a, b);
}
const falhas = new Map(); // ip -> {n, ate}
function bloqueado(ip) { const f = falhas.get(ip); return f && f.n >= 5 && f.ate > Date.now(); }
function registrarFalha(ip) {
  const f = falhas.get(ip) || { n: 0, ate: 0 };
  f.n = f.ate < Date.now() && f.n >= 5 ? 1 : f.n + 1;
  f.ate = Date.now() + 10 * 60e3;
  falhas.set(ip, f);
}

/* ---------- HTTP ---------- */
const INDEX = path.join(__dirname, 'public', 'index.html');
function json(res, status, dados) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(dados));
}
function lerCorpo(req) {
  // Na Vercel o corpo já chega lido em req.body
  if (env.VERCEL && req.body !== undefined) {
    const b = req.body;
    return Promise.resolve(typeof b === 'string' ? (() => { try { return JSON.parse(b || '{}'); } catch { return {}; } })() : Buffer.isBuffer(b) ? (() => { try { return JSON.parse(b.toString() || '{}'); } catch { return {}; } })() : (b || {}));
  }
  return new Promise((ok, falha) => {
    let s = '';
    req.on('data', c => { s += c; if (s.length > 4600000) { req.destroy(); falha(new Error('corpo grande')); } });
    req.on('end', () => { try { ok(JSON.parse(s || '{}')); } catch { ok({}); } });
    req.on('error', falha);
  });
}

const coletas = require('./coletas')({ consulta, normCod, lerCorpo });
const ponte = require('./ponte-cliente')({ lerCorpo });
const cubadora = require('./cubadora')({ consulta, lerCorpo });
const relatorios = require('./relatorios')({ consulta });

async function tratar(req, res) {
  const url = new URL(req.url, 'http://localhost');
  // Na Vercel, vercel.json reescreve /api/* para /api/index?__rota=/api/*
  const rota = (url.searchParams.get('__rota') || url.pathname).replace(/\/+$/, '') || '/';
  url.searchParams.delete('__rota');
  const q = Object.fromEntries(url.searchParams);
  const ip = req.socket.remoteAddress;
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'same-origin');
  try {
    const logo = /^\/(logo-(?:wepink|agf)\.png)$/.exec(rota);
    if (logo) {
      const arq = path.join(__dirname, 'public', logo[1]);
      if (!fs.existsSync(arq)) { res.writeHead(404); return res.end(); }
      res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=86400' });
      return fs.createReadStream(arq).pipe(res);
    }
    if (rota === '/' || rota === '/index.html') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' });
      return fs.createReadStream(INDEX).pipe(res);
    }
    if (rota === '/api/login' && req.method === 'POST') {
      if (bloqueado(ip)) return json(res, 429, { erro: 'Muitas tentativas. Aguarde 10 minutos.' });
      const { usuario, senha } = await lerCorpo(req);
      let u = await coletas.autenticar(usuario, senha).catch(e => { console.error('login', e.message); return null; });
      if (!u && senhaConfere(usuario, senha)) { const l = String(usuario).trim().toLowerCase(); u = { id: 0, login: l, nome: l, perfil: 'admin' }; }
      if (!u) { registrarFalha(ip); return json(res, 401, { erro: 'Usuário ou senha inválidos.' }); }
      falhas.delete(ip);
      res.setHeader('Set-Cookie', `sessao=${criarToken(u)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSAO_HORAS * 3600}${COOKIE_SEGURO}`);
      return json(res, 200, { ok: true, perfil: u.perfil });
    }
    if (rota === '/api/logout') {
      res.setHeader('Set-Cookie', `sessao=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${COOKIE_SEGURO}`);
      return json(res, 200, { ok: true });
    }
    if (rota.startsWith('/api/')) {
      const s = lerSessao(req);
      if (!s) return json(res, 401, { erro: 'login' });
      if (rota === '/api/me') return json(res, 200, { id: s.id, usuario: s.u, nome: s.n || s.u, perfil: s.p, agf: 'AGF Morada dos Lagos', cliente: 'Wepink' });
      if (rota === '/api/opcoes') return json(res, 200, await opcoes());
      if (rota === '/api/resumo') return json(res, 200, await resumo(q));
      if (rota === '/api/envios') return json(res, 200, await envios(q));
      if (rota === '/api/export.csv') return await exportarCSV(q, res);
      if (rota === '/api/rastreio') { const [st, d] = await rastreio(q, s.u); return json(res, st, d); }
      const rr = await relatorios.rota(rota, req, q, s);
      if (rr) return json(res, rr[0], rr[1]);
      const rc = await cubadora.rota(rota, req, q, s);
      if (rc) return json(res, rc[0], rc[1]);
      const rp = await ponte.rota(rota, req, q, s);
      if (rp) return json(res, rp[0], rp[1]);
      const r = await coletas.rota(rota, req, q, s);
      if (r && r[1] && r[1].__binario) {
        const a = r[1];
        res.writeHead(200, { 'Content-Type': a.mime, 'Content-Length': a.buffer.length, 'Cache-Control': 'private, max-age=86400',
          'Content-Disposition': `${q.baixar ? 'attachment' : 'inline'}; filename="${encodeURIComponent(a.nome)}"` });
        return res.end(a.buffer);
      }
      if (r) return json(res, r[0], r[1]);
      return json(res, 404, { erro: 'Rota não encontrada' });
    }
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Não encontrado');
  } catch (e) {
    if (e instanceof coletas.Erro) return json(res, e.status, { erro: e.message });
    console.error(new Date().toISOString(), rota, e.message);
    if (!res.headersSent) json(res, 500, { erro: 'Não foi possível consultar o banco de dados agora. Tente novamente em instantes.' });
    else res.end();
  }
}

if (env.VERCEL && !env.SESSAO_SEGREDO) console.error('Defina SESSAO_SEGREDO nas variáveis de ambiente da Vercel, senão os logins caem a cada nova instância.');

// Rodando direto (Hostinger, VPS, Windows): sobe o servidor HTTP.
if (require.main === module) {
  http.createServer(tratar).listen(PORTA, () => {
    console.log(`Portal Wepink · AGF Morada dos Lagos rodando em http://localhost:${PORTA}`);
    if (!env.SESSAO_SEGREDO) console.warn('Dica: defina SESSAO_SEGREDO no .env para manter os logins ao reiniciar.');
  });
}

module.exports = { tratar, cepUF, filtros, periodo, UF_SQL, normCod, interpretar };
