'use strict';
/*
 * Produtividade do TCE (tabela REGISTROSMICROPOST, SQL Server) e Relatório da operação para a diretoria.
 *   GET /api/tce?ini=AAAA-MM-DD&hi=HH:MM&fim=AAAA-MM-DD&hf=HH:MM[&triagem=...]
 *   GET /api/relatorio?ini=...&hi=...&fim=...&hf=...
 * Perfis: operação e administrador.
 */
module.exports = function criarRelatorios({ consulta }) {
  const PERFIS = ['operacao', 'admin'];
  const TABELA = 'REGISTROSMICROPOST';
  const MAX_DIAS = 31;
  // Remetentes considerados no TCE e no relatório (parecido com: LIKE %nome%). Separe por ponto e vírgula.
  const REMETENTES = String(process.env.FILTRO_TCE || 'SAVI COSMETICOS LTDA;SLV SUPLEMENTOS LTDA').split(';').map(x => x.trim()).filter(Boolean).slice(0, 10);
  const escLike = v => v.replace(/[[\]%_]/g, m => '[' + m + ']');
  const filtroRem = () => ({ w: '(' + REMETENTES.map((_, i) => `Remetente LIKE @rem${i}`).join(' OR ') + ')', params: REMETENTES.map((r, i) => [`rem${i}`, '%' + escLike(r) + '%']) });
  const reData = /^\d{4}-\d{2}-\d{2}$/, reHora = /^([01]\d|2[0-3]):[0-5]\d$/;
  const LOGIN = `ISNULL(NULLIF(LTRIM(RTRIM(Login)), ''), '(sem login)')`;
  const TRIAGEM = `ISNULL(NULLIF(LTRIM(RTRIM(Triagem)), ''), '(sem triagem)')`;
  const hojeBR = () => new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 10);

  class Falha extends Error { constructor(status, msg) { super(msg); this.status = status; } }

  function janela(q) {
    const ini = reData.test(q.ini || '') ? q.ini : hojeBR();
    const fim = reData.test(q.fim || '') ? q.fim : ini;
    const hi = reHora.test(q.hi || '') ? q.hi : '00:00';
    const hf = reHora.test(q.hf || '') ? q.hf : '23:59';
    const a = `${ini}T${hi}:00`, b = `${fim}T${hf}:00`;
    if (a > b) throw new Falha(400, 'O início precisa ser antes do fim.');
    if ((Date.parse(fim) - Date.parse(ini)) / 864e5 > MAX_DIAS) throw new Falha(400, `Escolha um período de até ${MAX_DIAS} dias.`);
    // fim inclusivo até o último segundo do minuto escolhido
    const r = filtroRem();
    return { ini, hi, fim, hf, params: [['a', a], ['b', b], ...r.params], w: `data >= CAST(@a AS datetime) AND data < DATEADD(minute, 1, CAST(@b AS datetime)) AND ${r.w}` };
  }

  /* ---------- TCE ---------- */
  async function tce(q) {
    const j = janela(q);
    let w = j.w; const params = [...j.params];
    const triagem = String(q.triagem || '').trim().slice(0, 100);
    if (triagem) { w += ` AND ${TRIAGEM} = @tri`; params.push(['tri', triagem]); }
    const T = `FROM ${TABELA} WITH (NOLOCK) WHERE ${w}`;
    const [horas, extremos, triagens, remetentes, status] = await Promise.all([
      consulta(`SELECT CONVERT(varchar(10), CAST(data AS date), 23) dia, DATEPART(hour, data) h, ${LOGIN} login, COUNT(*) qtd
                ${T} GROUP BY CAST(data AS date), DATEPART(hour, data), ${LOGIN}`, params),
      consulta(`SELECT ${LOGIN} login, CONVERT(varchar(19), MIN(data), 120) primeiro, CONVERT(varchar(19), MAX(data), 120) ultimo
                ${T} GROUP BY ${LOGIN}`, params),
      consulta(`SELECT ${TRIAGEM} triagem, COUNT(*) qtd ${T} GROUP BY ${TRIAGEM} ORDER BY qtd DESC`, params),
      consulta(`SELECT TOP 15 ISNULL(NULLIF(LTRIM(RTRIM(Remetente)), ''), '(sem remetente)') remetente, COUNT(*) qtd
                ${T} GROUP BY ISNULL(NULLIF(LTRIM(RTRIM(Remetente)), ''), '(sem remetente)') ORDER BY qtd DESC`, params),
      consulta(`SELECT CAST(Status AS varchar(20)) status, COUNT(*) qtd ${T} GROUP BY Status ORDER BY qtd DESC`, params)
    ]);
    // triagens do período sem o filtro, para o seletor
    let opcoes = triagens.map(t => t.triagem);
    if (triagem) opcoes = (await consulta(`SELECT DISTINCT ${TRIAGEM} triagem FROM ${TABELA} WITH (NOLOCK) WHERE ${j.w}`, j.params)).map(t => t.triagem).sort();
    return {
      filtro: { ini: j.ini, hi: j.hi, fim: j.fim, hf: j.hf, triagem: triagem || null },
      total: triagens.reduce((s, t) => s + t.qtd, 0),
      horas, extremos, triagens, remetentes, status, opcoesTriagem: opcoes, remetentesFiltro: REMETENTES, geradoEm: new Date().toISOString()
    };
  }

  /* ---------- Relatório da operação ---------- */
  async function existe(tabela) {
    return (await consulta(`SELECT CASE WHEN OBJECT_ID(@t, 'U') IS NULL THEN 0 ELSE 1 END ok`, [['t', 'dbo.' + tabela]]))[0].ok === 1;
  }
  async function colunaExiste(tabela, coluna) {
    return (await consulta(`SELECT CASE WHEN COL_LENGTH(@t, @c) IS NULL THEN 0 ELSE 1 END ok`, [['t', 'dbo.' + tabela], ['c', coluna]]))[0].ok === 1;
  }

  async function coletasDoPeriodo(j) {
    if (!(await existe('PORTAL_COLETAS'))) return { indisponivel: 'As tabelas de coletas ainda não foram criadas.' };
    const frota = await existe('PORTAL_COLETA_VEICULOS');
    const local = await colunaExiste('PORTAL_COLETAS', 'LOCAL_COLETA');
    // momento da coleta = data da coleta + horário (da coleta, do 1º caminhão ou o previsto)
    const hora = frota ? 'COALESCE(c.HORARIO_COLETA, cv.h, c.HORARIO_PREVISTO)' : 'COALESCE(c.HORARIO_COLETA, c.HORARIO_PREVISTO)';
    const momento = `(CAST(c.DATA_COLETA AS datetime) + CAST(ISNULL(${hora}, CAST('00:00' AS time)) AS datetime))`;
    const linhas = await consulta(`
      SELECT c.ID id, CONVERT(varchar(10), c.DATA_COLETA, 23) data, CONVERT(varchar(5), ${hora}, 108) horario, c.STATUS status,
        ${local ? 'c.LOCAL_COLETA' : 'NULL'} local, c.VOLUMES_PREVISTOS previstos,
        (SELECT COUNT(*) FROM PORTAL_EMBARQUES e WHERE e.COLETA_ID = c.ID) embarques,
        (SELECT ISNULL(SUM(e.QTD_OBJETOS), 0) FROM PORTAL_EMBARQUES e WHERE e.COLETA_ID = c.ID) objetos,
        (SELECT COUNT(*) FROM PORTAL_EMBARQUES e WHERE e.COLETA_ID = c.ID AND e.CONFERIDO = 1) conferidos,
        (SELECT ISNULL(SUM(CASE WHEN e.CONFERIDO = 1 THEN ISNULL(e.QTD_TRATADOS, e.QTD_OBJETOS) ELSE 0 END), 0) FROM PORTAL_EMBARQUES e WHERE e.COLETA_ID = c.ID) tratados,
        (SELECT COUNT(*) FROM PORTAL_PENDENCIAS p WHERE p.COLETA_ID = c.ID) pendencias
        ${frota ? `, cv.n caminhoes, cv.paletes paletes,
        (SELECT ISNULL(SUM(v.QTD_OBJETOS), 0) FROM PORTAL_COLETA_VEICULOS v WHERE v.COLETA_ID = c.ID
          AND NOT EXISTS (SELECT 1 FROM PORTAL_EMBARQUES e WHERE e.COLETA_VEICULO_ID = v.ID)) objetosManifesto` : ''}
      FROM PORTAL_COLETAS c
      ${frota ? `OUTER APPLY (SELECT MIN(v.HORARIO_COLETA) h, COUNT(*) n, ISNULL(SUM(v.PALETES), 0) paletes FROM PORTAL_COLETA_VEICULOS v WHERE v.COLETA_ID = c.ID) cv` : ''}
      WHERE c.DATA_COLETA BETWEEN DATEADD(day, -1, CAST(@a AS date)) AND CAST(@b AS date)
        AND ${momento} >= CAST(@a AS datetime) AND ${momento} < DATEADD(minute, 1, CAST(@b AS datetime))
      ORDER BY ${momento}, c.ID`, j.params);
    for (const l of linhas) { l.caminhoes = l.caminhoes || 0; l.paletes = l.paletes || 0; l.objetos += l.objetosManifesto || 0; delete l.objetosManifesto; }
    return { linhas, frota };
  }

  async function ocorrenciasDoPeriodo(j) {
    if (!(await existe('PORTAL_PENDENCIAS'))) return { indisponivel: 'As tabelas de coletas ainda não foram criadas.' };
    const linhas = await consulta(`
      SELECT p.ID id, p.COLETA_ID coleta, e.NUM_EMBARQUE embarque, p.COD_OBJETO objeto, p.MOTIVO motivo, p.OBS obs, p.STATUS status,
        CONVERT(varchar(16), p.CRIADO_EM, 120) criadoEm, p.SOLUCAO solucao, p.RESPOSTA_CLIENTE resposta
      FROM PORTAL_PENDENCIAS p LEFT JOIN PORTAL_EMBARQUES e ON e.ID = p.EMBARQUE_ID
      WHERE p.CRIADO_EM >= CAST(@a AS datetime) AND p.CRIADO_EM < DATEADD(minute, 1, CAST(@b AS datetime))
      ORDER BY p.CRIADO_EM`, j.params);
    return { linhas };
  }

  async function relatorio(q) {
    const j = janela(q);
    const seguro = p => p.catch(e => { console.error('relatorio', e.message); return { indisponivel: 'Não foi possível consultar esta parte agora.' }; });
    const [tceDados, coletas, ocorrencias] = await Promise.all([
      seguro(tce({ ini: j.ini, hi: j.hi, fim: j.fim, hf: j.hf })),
      seguro(coletasDoPeriodo(j)),
      seguro(ocorrenciasDoPeriodo(j))
    ]);
    return { filtro: { ini: j.ini, hi: j.hi, fim: j.fim, hf: j.hf }, tce: tceDados, coletas, ocorrencias, geradoEm: new Date().toISOString() };
  }

  async function rota(caminho, req, q, s) {
    if (caminho !== '/api/tce' && caminho !== '/api/relatorio') return null;
    if (!PERFIS.includes(s.p)) return [403, { erro: 'Seu perfil não tem acesso a este relatório.' }];
    try {
      return [200, caminho === '/api/tce' ? await tce(q) : await relatorio(q)];
    } catch (e) {
      if (e instanceof Falha) return [e.status, { erro: e.message }];
      throw e;
    }
  }
  return { rota };
};
