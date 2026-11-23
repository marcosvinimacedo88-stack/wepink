'use strict';
/*
 * Protocolo de coletas: usuários por perfil, coletas, embarques, conferência e pendências.
 * Tabelas: criar_tabelas_coletas.sql
 */
const crypto = require('crypto');

module.exports = function criarColetas({ consulta, normCod, lerCorpo }) {
  const PERFIS = ['cliente', 'transporte', 'operacao', 'admin'];
  const MOTIVOS = [
    'Objeto não localizado na carga', 'Embalagem avariada', 'Sem etiqueta', 'Etiqueta ilegível ou danificada',
    'Etiqueta duplicada', 'Endereço incompleto ou CEP inválido', 'Peso ou dimensões fora do padrão',
    'Conteúdo proibido ou restrito', 'Objeto sem registro no sistema', 'Outro'
  ];
  const PODE = {
    solicitar: ['cliente', 'transporte', 'operacao', 'admin'],
    agendar: ['transporte', 'admin'],
    coletar: ['transporte', 'admin'],
    cancelar: ['cliente', 'transporte', 'admin'],
    embarque: ['operacao', 'admin'],
    conferir: ['operacao', 'admin'],
    finalizar: ['operacao', 'admin'],
    ciente: ['cliente', 'admin'],
    resolver: ['operacao', 'admin'],
    usuarios: ['admin']
  };

  class Erro extends Error { constructor(status, msg) { super(msg); this.status = status; } }
  const exigir = (s, acao) => { if (!PODE[acao].includes(s.p)) throw new Erro(403, 'Seu perfil não tem permissão para esta ação.'); };
  const reData = /^\d{4}-\d{2}-\d{2}$/, reHora = /^([01]\d|2[0-3]):[0-5]\d$/;
  const txt = (v, max = 500) => { const s = String(v ?? '').trim().slice(0, max); return s || null; };
  const int = (v, min = 0, max = 1e6) => { const n = Number(v); return Number.isInteger(n) && n >= min && n <= max ? n : null; };
  const hora = v => (reHora.test(String(v || '')) ? String(v) : null);
  const xml = v => String(v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));
  const hojeBR = () => new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 10);

  /* ---------- Senhas ---------- */
  function gerarHash(senha) {
    const sal = crypto.randomBytes(16);
    return 'scrypt$' + sal.toString('base64') + '$' + crypto.scryptSync(String(senha), sal, 32).toString('base64');
  }
  function confere(senha, hash) {
    const [alg, sal, h] = String(hash || '').split('$');
    if (alg !== 'scrypt' || !sal || !h) return false;
    const a = crypto.scryptSync(String(senha || ''), Buffer.from(sal, 'base64'), 32), b = Buffer.from(h, 'base64');
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  }

  /* ---------- Tabelas ---------- */
  let tab = { v: null, t: 0 };
  async function tabelas() {
    if (tab.v === true || (tab.v === false && Date.now() - tab.t < 30e3)) return tab.v;
    const r = await consulta(`SELECT CASE WHEN OBJECT_ID('dbo.PORTAL_COLETAS','U') IS NULL OR OBJECT_ID('dbo.PORTAL_USUARIOS','U') IS NULL
      OR OBJECT_ID('dbo.PORTAL_EMBARQUES','U') IS NULL OR OBJECT_ID('dbo.PORTAL_PENDENCIAS','U') IS NULL OR OBJECT_ID('dbo.PORTAL_HISTORICO','U') IS NULL
      THEN 0 ELSE 1 END ok`, []);
    tab = { v: !!r[0].ok, t: Date.now() };
    return tab.v;
  }
  async function exigirTabelas() {
    if (!(await tabelas().catch(() => false))) throw new Erro(503, 'A área de coletas ainda não foi ativada: rode o script criar_tabelas_coletas.sql no banco.');
  }

  async function autenticar(login, senha) {
    if (!(await tabelas().catch(() => false))) return null;
    const r = await consulta(`SELECT ID id, LOGIN login, NOME nome, PERFIL perfil, SENHA_HASH hash FROM PORTAL_USUARIOS WHERE LOGIN = @l AND ATIVO = 1`,
      [['l', String(login || '').trim().toLowerCase()]]);
    if (!r[0] || !confere(senha, r[0].hash)) return null;
    consulta(`UPDATE PORTAL_USUARIOS SET ULTIMO_ACESSO = SYSDATETIME() WHERE ID = @id`, [['id', String(r[0].id)]]).catch(() => {});
    return { id: r[0].id, login: r[0].login, nome: r[0].nome, perfil: r[0].perfil };
  }

  async function hist(coletaId, s, acao, detalhe) {
    await consulta(`INSERT INTO PORTAL_HISTORICO (COLETA_ID, USUARIO_ID, USUARIO, PERFIL, ACAO, DETALHE) VALUES (@c, @u, @n, @p, @a, @d)`,
      [['c', String(coletaId)], ['u', String(s.id ?? 0)], ['n', s.n || s.u, 'n'], ['p', s.p], ['a', acao, 'n'], ['d', detalhe || null, 'n']]);
  }
  async function coleta(id) {
    const r = await consulta(`SELECT ID id, STATUS status, CONVERT(varchar(10), DATA_COLETA, 23) data, CONVERT(varchar(5), HORARIO_COLETA, 108) horario, SOLICITADO_POR solicitadoPor
      FROM PORTAL_COLETAS WHERE ID = @id`, [['id', String(id)]]);
    if (!r[0]) throw new Erro(404, 'Coleta não encontrada.');
    return r[0];
  }
  const exigirStatus = (c, lista, msg) => { if (!lista.includes(c.status)) throw new Erro(409, msg); };

  /* ---------- Consultas ---------- */
  async function listar(q) {
    const fim = reData.test(q.fim || '') ? q.fim : hojeBR();
    const ini = reData.test(q.ini || '') ? q.ini : new Date(Date.parse(fim) - 29 * 864e5).toISOString().slice(0, 10);
    const params = [['ini', ini], ['fim', fim]];
    let w = 'c.DATA_COLETA BETWEEN CAST(@ini AS date) AND CAST(@fim AS date)';
    if (q.status === 'abertas') { w = `c.STATUS NOT IN ('concluida','cancelada')`; params.length = 0; }
    else if (q.status && /^[a-z_]+$/.test(q.status)) { w += ' AND c.STATUS = @st'; params.push(['st', q.status]); }
    const linhas = await consulta(`
      SELECT c.ID id, CONVERT(varchar(10), c.DATA_COLETA, 23) data, c.STATUS status, c.VOLUMES_PREVISTOS previstos,
        CONVERT(varchar(5), c.HORARIO_PREVISTO, 108) horarioPrevisto, CONVERT(varchar(5), c.HORARIO_COLETA, 108) horario,
        c.MOTORISTA motorista, c.PLACA placa, us.NOME solicitante, CONVERT(varchar(19), c.SOLICITADO_EM, 120) solicitadoEm,
        (SELECT COUNT(*) FROM PORTAL_EMBARQUES e WHERE e.COLETA_ID = c.ID) embarques,
        (SELECT ISNULL(SUM(e.QTD_OBJETOS), 0) FROM PORTAL_EMBARQUES e WHERE e.COLETA_ID = c.ID) objetos,
        (SELECT COUNT(*) FROM PORTAL_EMBARQUES e WHERE e.COLETA_ID = c.ID AND e.CONFERIDO = 1) conferidos,
        (SELECT COUNT(*) FROM PORTAL_PENDENCIAS p WHERE p.COLETA_ID = c.ID) pendencias,
        (SELECT COUNT(*) FROM PORTAL_PENDENCIAS p WHERE p.COLETA_ID = c.ID AND p.STATUS <> 'resolvida') pendAbertas
      FROM PORTAL_COLETAS c LEFT JOIN PORTAL_USUARIOS us ON us.ID = c.SOLICITADO_POR
      WHERE ${w} ORDER BY c.DATA_COLETA DESC, c.ID DESC`, params);
    const validas = linhas.filter(l => l.status !== 'cancelada');
    const objetos = validas.reduce((a, l) => a + l.objetos, 0), embarques = validas.reduce((a, l) => a + l.embarques, 0);
    return {
      ini, fim, coletas: linhas,
      kpis: { coletas: validas.length, objetos, embarques, media: embarques ? Math.round(objetos / embarques) : 0, pendAbertas: validas.reduce((a, l) => a + l.pendAbertas, 0) }
    };
  }

  async function detalhe(id) {
    const nome = col => `(SELECT NOME FROM PORTAL_USUARIOS WHERE ID = c.${col})`;
    const [c] = await consulta(`
      SELECT c.ID id, CONVERT(varchar(10), c.DATA_COLETA, 23) data, c.STATUS status, c.VOLUMES_PREVISTOS previstos, c.OBS_CLIENTE obsCliente,
        ${nome('SOLICITADO_POR')} solicitante, CONVERT(varchar(19), c.SOLICITADO_EM, 120) solicitadoEm, c.SOLICITADO_POR solicitadoPor,
        CONVERT(varchar(5), c.HORARIO_PREVISTO, 108) horarioPrevisto, c.MOTORISTA motorista, c.PLACA placa,
        CONVERT(varchar(5), c.HORARIO_COLETA, 108) horario, c.OBS_TRANSPORTE obsTransporte,
        ${nome('AGENDADO_POR')} agendadoPor, CONVERT(varchar(19), c.AGENDADO_EM, 120) agendadoEm,
        ${nome('COLETADO_POR')} coletadoPor, CONVERT(varchar(19), c.COLETADO_EM, 120) coletadoEm,
        c.OBS_OPERACAO obsOperacao, ${nome('FINALIZADO_POR')} finalizadoPor, CONVERT(varchar(19), c.FINALIZADO_EM, 120) finalizadoEm,
        CONVERT(varchar(19), c.CANCELADO_EM, 120) canceladoEm, c.MOTIVO_CANCELAMENTO motivoCancelamento
      FROM PORTAL_COLETAS c WHERE c.ID = @id`, [['id', String(id)]]);
    if (!c) throw new Erro(404, 'Coleta não encontrada.');
    const [embarques, pendencias, historico] = await Promise.all([
      consulta(`SELECT e.ID id, CONVERT(varchar(10), e.DATA, 23) data, e.NUM_EMBARQUE numero, e.QTD_OBJETOS qtd, CONVERT(varchar(5), e.HORARIO_COLETA, 108) horario,
          e.CONFERIDO conferido, e.TUDO_OK tudoOk, e.QTD_TRATADOS tratados, e.OBS_CONFERENCIA obs,
          (SELECT NOME FROM PORTAL_USUARIOS WHERE ID = e.CONFERIDO_POR) conferidoPor, CONVERT(varchar(19), e.CONFERIDO_EM, 120) conferidoEm,
          (SELECT COUNT(*) FROM PORTAL_PENDENCIAS p WHERE p.EMBARQUE_ID = e.ID) pendencias
        FROM PORTAL_EMBARQUES e WHERE e.COLETA_ID = @id ORDER BY e.ID`, [['id', String(id)]]),
      consulta(`SELECT p.ID id, p.EMBARQUE_ID embarqueId, e.NUM_EMBARQUE embarque, p.COD_OBJETO cod, p.MOTIVO motivo, p.OBS obs, p.STATUS status,
          CONVERT(varchar(19), p.CRIADO_EM, 120) criadoEm, p.RESPOSTA_CLIENTE resposta, (SELECT NOME FROM PORTAL_USUARIOS WHERE ID = p.CIENTE_POR) cientePor,
          CONVERT(varchar(19), p.CIENTE_EM, 120) cienteEm, p.SOLUCAO solucao, (SELECT NOME FROM PORTAL_USUARIOS WHERE ID = p.RESOLVIDO_POR) resolvidoPor,
          CONVERT(varchar(19), p.RESOLVIDO_EM, 120) resolvidoEm
        FROM PORTAL_PENDENCIAS p JOIN PORTAL_EMBARQUES e ON e.ID = p.EMBARQUE_ID WHERE p.COLETA_ID = @id ORDER BY p.ID`, [['id', String(id)]]),
      consulta(`SELECT USUARIO usuario, PERFIL perfil, ACAO acao, DETALHE detalhe, CONVERT(varchar(19), EM, 120) em
        FROM PORTAL_HISTORICO WHERE COLETA_ID = @id ORDER BY EM DESC, ID DESC`, [['id', String(id)]])
    ]);
    return { coleta: c, embarques, pendencias, historico, motivos: MOTIVOS };
  }

  async function notificacoes(s) {
    const r = await consulta(`
      SELECT 'pendencia' tipo, p.COLETA_ID coletaId, COUNT(*) n, CONVERT(varchar(10), MAX(c.DATA_COLETA), 23) data
        FROM PORTAL_PENDENCIAS p JOIN PORTAL_COLETAS c ON c.ID = p.COLETA_ID WHERE p.STATUS = 'aberta' GROUP BY p.COLETA_ID
      UNION ALL
      SELECT 'ciente', p.COLETA_ID, COUNT(*), CONVERT(varchar(10), MAX(c.DATA_COLETA), 23)
        FROM PORTAL_PENDENCIAS p JOIN PORTAL_COLETAS c ON c.ID = p.COLETA_ID WHERE p.STATUS = 'ciente' GROUP BY p.COLETA_ID
      UNION ALL
      SELECT STATUS, ID, 1, CONVERT(varchar(10), DATA_COLETA, 23) FROM PORTAL_COLETAS WHERE STATUS IN ('solicitada','agendada','coletada','em_tratamento')`, []);
    const meus = {
      cliente: ['pendencia'],
      transporte: ['solicitada', 'agendada'],
      operacao: ['coletada', 'em_tratamento', 'ciente'],
      admin: ['pendencia', 'ciente', 'solicitada', 'agendada', 'coletada', 'em_tratamento']
    }[s.p] || [];
    const texto = (t, n, id) => ({
      pendencia: `Coleta nº ${id}: ${n} objeto${n > 1 ? 's' : ''} com problema no tratamento`,
      ciente: `Coleta nº ${id}: cliente deu ciência de ${n} pendência${n > 1 ? 's' : ''}`,
      solicitada: `Coleta nº ${id} solicitada, aguardando o transporte`,
      agendada: `Coleta nº ${id} agendada, confirme quando coletar`,
      coletada: `Coleta nº ${id} chegou, lance os embarques`,
      em_tratamento: `Coleta nº ${id} em tratamento, confira e finalize`
    })[t];
    const itens = r.filter(x => meus.includes(x.tipo)).sort((a, b) => b.data.localeCompare(a.data)).slice(0, 40)
      .map(x => ({ coletaId: x.coletaId, tipo: x.tipo, data: x.data, texto: texto(x.tipo, x.n, x.coletaId) }));
    return { total: itens.length, itens };
  }

  /* ---------- Ações ---------- */
  async function criar(b, s) {
    exigir(s, 'solicitar');
    const data = reData.test(b.data || '') ? b.data : null;
    if (!data) throw new Erro(400, 'Informe a data da coleta.');
    const previstos = b.previstos === '' || b.previstos == null ? null : int(b.previstos, 0, 1e6);
    if (b.previstos !== '' && b.previstos != null && previstos === null) throw new Erro(400, 'Volume previsto inválido.');
    const [r] = await consulta(`INSERT INTO PORTAL_COLETAS (DATA_COLETA, VOLUMES_PREVISTOS, OBS_CLIENTE, SOLICITADO_POR) VALUES (CAST(@d AS date), @v, @o, @u);
      SELECT CAST(SCOPE_IDENTITY() AS int) id`, [['d', data], ['v', previstos == null ? null : String(previstos)], ['o', txt(b.obs, 1000), 'n'], ['u', String(s.id ?? 0)]]);
    await hist(r.id, s, 'Coleta solicitada', [`Data ${data.split('-').reverse().join('/')}`, previstos != null ? `${previstos} volumes previstos` : '', txt(b.obs, 300)].filter(Boolean).join(' · '));
    return { id: r.id };
  }

  async function agendar(id, b, s) {
    exigir(s, 'agendar');
    const c = await coleta(id);
    exigirStatus(c, ['solicitada', 'agendada'], 'Esta coleta não pode mais ser agendada.');
    const h = hora(b.horarioPrevisto);
    await consulta(`UPDATE PORTAL_COLETAS SET STATUS = 'agendada', HORARIO_PREVISTO = TRY_CONVERT(time(0), @h), MOTORISTA = @m, PLACA = @p,
      OBS_TRANSPORTE = ISNULL(@o, OBS_TRANSPORTE), AGENDADO_POR = @u, AGENDADO_EM = SYSDATETIME() WHERE ID = @id`,
      [['h', h], ['m', txt(b.motorista, 120), 'n'], ['p', txt(String(b.placa || '').toUpperCase(), 10)], ['o', txt(b.obs, 1000), 'n'], ['u', String(s.id ?? 0)], ['id', String(id)]]);
    await hist(id, s, 'Coleta agendada', [h && `Previsão ${h}`, txt(b.motorista, 120) && `Motorista ${txt(b.motorista, 120)}`, txt(b.placa, 10) && `Placa ${String(b.placa).toUpperCase()}`].filter(Boolean).join(' · '));
    return { ok: true };
  }

  async function coletar(id, b, s) {
    exigir(s, 'coletar');
    const c = await coleta(id);
    exigirStatus(c, ['solicitada', 'agendada'], 'Esta coleta já foi confirmada ou não está mais aberta.');
    const h = hora(b.horario);
    if (!h) throw new Erro(400, 'Informe o horário da coleta.');
    await consulta(`UPDATE PORTAL_COLETAS SET STATUS = 'coletada', HORARIO_COLETA = TRY_CONVERT(time(0), @h), MOTORISTA = ISNULL(@m, MOTORISTA),
      PLACA = ISNULL(@p, PLACA), OBS_TRANSPORTE = ISNULL(@o, OBS_TRANSPORTE), COLETADO_POR = @u, COLETADO_EM = SYSDATETIME() WHERE ID = @id`,
      [['h', h], ['m', txt(b.motorista, 120), 'n'], ['p', txt(String(b.placa || '').toUpperCase(), 10)], ['o', txt(b.obs, 1000), 'n'], ['u', String(s.id ?? 0)], ['id', String(id)]]);
    await hist(id, s, 'Carga coletada', [`Horário ${h}`, txt(b.motorista, 120) && `Motorista ${txt(b.motorista, 120)}`, txt(b.placa, 10) && `Placa ${String(b.placa).toUpperCase()}`, txt(b.obs, 300)].filter(Boolean).join(' · '));
    return { ok: true };
  }

  async function cancelar(id, b, s) {
    exigir(s, 'cancelar');
    const c = await coleta(id);
    exigirStatus(c, s.p === 'cliente' ? ['solicitada'] : ['solicitada', 'agendada'], s.p === 'cliente' ? 'A coleta já foi agendada: fale com a AGF para cancelar.' : 'Só dá para cancelar antes da coleta.');
    const motivo = txt(b.motivo, 500);
    if (!motivo) throw new Erro(400, 'Informe o motivo do cancelamento.');
    await consulta(`UPDATE PORTAL_COLETAS SET STATUS = 'cancelada', CANCELADO_POR = @u, CANCELADO_EM = SYSDATETIME(), MOTIVO_CANCELAMENTO = @m WHERE ID = @id`,
      [['u', String(s.id ?? 0)], ['m', motivo, 'n'], ['id', String(id)]]);
    await hist(id, s, 'Coleta cancelada', motivo);
    return { ok: true };
  }

  async function addEmbarque(id, b, s) {
    exigir(s, 'embarque');
    const c = await coleta(id);
    exigirStatus(c, ['coletada', 'em_tratamento'], c.status === 'solicitada' || c.status === 'agendada'
      ? 'Aguardando o transporte confirmar a coleta.' : 'Esta coleta já foi finalizada.');
    const numero = String(b.numero || '').trim();
    if (!/^[\w./-]{1,30}$/.test(numero)) throw new Erro(400, 'Informe o número do embarque (até 30 caracteres, sem espaços).');
    const qtd = int(b.qtd, 0, 100000);
    if (qtd === null) throw new Erro(400, 'Quantidade de objetos inválida.');
    const data = reData.test(b.data || '') ? b.data : c.data;
    const h = hora(b.horario) || c.horario;
    try {
      await consulta(`INSERT INTO PORTAL_EMBARQUES (COLETA_ID, DATA, NUM_EMBARQUE, QTD_OBJETOS, HORARIO_COLETA, CRIADO_POR)
        VALUES (@c, CAST(@d AS date), @n, @q, TRY_CONVERT(time(0), @h), @u);
        UPDATE PORTAL_COLETAS SET STATUS = 'em_tratamento' WHERE ID = @c AND STATUS = 'coletada';`,
        [['c', String(id)], ['d', data], ['n', numero], ['q', String(qtd)], ['h', h], ['u', String(s.id ?? 0)]]);
    } catch (e) {
      if (/UQ_PORTAL_EMBARQUES|duplicate|2627|2601/i.test(e.message + (e.number || ''))) throw new Erro(409, `O embarque ${numero} já foi lançado nesta coleta.`);
      throw e;
    }
    await hist(id, s, 'Embarque lançado', `Nº ${numero} · ${qtd} objetos${h ? ' · coleta às ' + h : ''}`);
    return { ok: true };
  }

  async function excluirEmbarque(eid, s) {
    exigir(s, 'embarque');
    const [e] = await consulta(`SELECT e.ID id, e.COLETA_ID coletaId, e.NUM_EMBARQUE numero, e.CONFERIDO conferido FROM PORTAL_EMBARQUES e WHERE e.ID = @id`, [['id', String(eid)]]);
    if (!e) throw new Erro(404, 'Embarque não encontrado.');
    if (e.conferido) throw new Erro(409, 'Embarque já conferido não pode ser excluído.');
    const c = await coleta(e.coletaId);
    exigirStatus(c, ['em_tratamento'], 'Esta coleta já foi finalizada.');
    await consulta(`DELETE FROM PORTAL_EMBARQUES WHERE ID = @id AND CONFERIDO = 0;
      IF NOT EXISTS (SELECT 1 FROM PORTAL_EMBARQUES WHERE COLETA_ID = @c) UPDATE PORTAL_COLETAS SET STATUS = 'coletada' WHERE ID = @c AND STATUS = 'em_tratamento';`,
      [['id', String(eid)], ['c', String(e.coletaId)]]);
    await hist(e.coletaId, s, 'Embarque excluído', `Nº ${e.numero}`);
    return { ok: true };
  }

  async function conferir(eid, b, s) {
    exigir(s, 'conferir');
    const [e] = await consulta(`SELECT ID id, COLETA_ID coletaId, NUM_EMBARQUE numero, QTD_OBJETOS qtd, CONFERIDO conferido FROM PORTAL_EMBARQUES WHERE ID = @id`, [['id', String(eid)]]);
    if (!e) throw new Erro(404, 'Embarque não encontrado.');
    if (e.conferido) throw new Erro(409, 'Este embarque já foi conferido.');
    const c = await coleta(e.coletaId);
    exigirStatus(c, ['em_tratamento'], 'Esta coleta não está em tratamento.');
    const ok = b.tudoOk === true || b.tudoOk === '1' || b.tudoOk === 1;
    let objetos = [];
    if (!ok) {
      const invalidos = [], vistos = new Set();
      for (const o of [].concat(b.objetos || []).slice(0, 2000)) {
        const cod = normCod(o && o.cod);
        if (!cod) { invalidos.push(String((o && o.cod) || '').slice(0, 20)); continue; }
        if (vistos.has(cod)) continue;
        vistos.add(cod);
        objetos.push({ cod, motivo: MOTIVOS.includes(o.motivo) ? o.motivo : 'Outro', obs: txt(o.obs, 500) });
      }
      if (invalidos.length) throw new Erro(400, `Códigos inválidos: ${invalidos.slice(0, 8).join(', ')}${invalidos.length > 8 ? '…' : ''}`);
      if (!objetos.length) throw new Erro(400, 'Informe os objetos que deram problema.');
      if (objetos.length > e.qtd) throw new Erro(400, `O embarque tem ${e.qtd} objetos e foram informados ${objetos.length} com problema.`);
    }
    const tratados = ok ? e.qtd : (int(b.tratados, 0, e.qtd) ?? e.qtd - objetos.length);
    const r = await consulta(`SET XACT_ABORT ON; BEGIN TRAN;
      UPDATE PORTAL_EMBARQUES SET CONFERIDO = 1, TUDO_OK = @ok, QTD_TRATADOS = @t, OBS_CONFERENCIA = @o, CONFERIDO_POR = @u, CONFERIDO_EM = SYSDATETIME()
        WHERE ID = @e AND CONFERIDO = 0;
      IF @@ROWCOUNT = 0 BEGIN ROLLBACK; SELECT 0 ok; RETURN; END
      DECLARE @x xml = @j;
      INSERT INTO PORTAL_PENDENCIAS (COLETA_ID, EMBARQUE_ID, COD_OBJETO, MOTIVO, OBS, CRIADO_POR)
        SELECT @c, @e, t.o.value('@c', 'varchar(20)'), t.o.value('@m', 'nvarchar(100)'), NULLIF(t.o.value('@b', 'nvarchar(500)'), ''), @u
        FROM @x.nodes('/o') t(o);
      COMMIT; SELECT 1 ok;`,
      [['ok', ok ? '1' : '0'], ['t', String(tratados)], ['o', txt(b.obs, 1000), 'n'], ['u', String(s.id ?? 0)], ['e', String(eid)], ['c', String(e.coletaId)], ['j', objetos.map(o => `<o c="${xml(o.cod)}" m="${xml(o.motivo)}" b="${xml(o.obs || '')}"/>`).join(''), 'max']]);
    if (!r[0] || !r[0].ok) throw new Erro(409, 'Este embarque já foi conferido.');
    await hist(e.coletaId, s, ok ? 'Embarque conferido sem problemas' : 'Embarque conferido com problemas',
      ok ? `Nº ${e.numero} · ${e.qtd} objetos tratados` : `Nº ${e.numero} · ${tratados} de ${e.qtd} tratados · ${objetos.length} com problema`);
    return { ok: true, pendencias: objetos.length };
  }

  async function finalizar(id, b, s) {
    exigir(s, 'finalizar');
    const c = await coleta(id);
    exigirStatus(c, ['em_tratamento'], 'Esta coleta não está em tratamento.');
    const [r] = await consulta(`SELECT (SELECT COUNT(*) FROM PORTAL_EMBARQUES WHERE COLETA_ID = @id) emb,
      (SELECT COUNT(*) FROM PORTAL_EMBARQUES WHERE COLETA_ID = @id AND CONFERIDO = 0) falta,
      (SELECT ISNULL(SUM(QTD_OBJETOS), 0) FROM PORTAL_EMBARQUES WHERE COLETA_ID = @id) obj,
      (SELECT COUNT(*) FROM PORTAL_PENDENCIAS WHERE COLETA_ID = @id AND STATUS <> 'resolvida') pend`, [['id', String(id)]]);
    if (!r.emb) throw new Erro(409, 'Lance ao menos um embarque antes de finalizar.');
    if (r.falta) throw new Erro(409, `Ainda falta conferir ${r.falta} embarque${r.falta > 1 ? 's' : ''}.`);
    const novo = r.pend ? 'pendente' : 'concluida';
    await consulta(`UPDATE PORTAL_COLETAS SET STATUS = @st, OBS_OPERACAO = ISNULL(@o, OBS_OPERACAO), FINALIZADO_POR = @u, FINALIZADO_EM = SYSDATETIME() WHERE ID = @id`,
      [['st', novo], ['o', txt(b.obs, 1000), 'n'], ['u', String(s.id ?? 0)], ['id', String(id)]]);
    await hist(id, s, r.pend ? 'Tratamento finalizado com pendências' : 'Tratamento finalizado',
      `${r.emb} embarques · ${r.obj} objetos` + (r.pend ? ` · ${r.pend} objeto${r.pend > 1 ? 's' : ''} com problema, cliente notificado` : ''));
    return { status: novo };
  }

  async function ciente(pid, b, s) {
    exigir(s, 'ciente');
    const [p] = await consulta(`SELECT ID id, COLETA_ID coletaId, COD_OBJETO cod, STATUS status FROM PORTAL_PENDENCIAS WHERE ID = @id`, [['id', String(pid)]]);
    if (!p) throw new Erro(404, 'Pendência não encontrada.');
    if (p.status !== 'aberta') throw new Erro(409, 'Esta pendência já foi respondida.');
    await consulta(`UPDATE PORTAL_PENDENCIAS SET STATUS = 'ciente', RESPOSTA_CLIENTE = @r, CIENTE_POR = @u, CIENTE_EM = SYSDATETIME() WHERE ID = @id AND STATUS = 'aberta'`,
      [['r', txt(b.resposta, 500), 'n'], ['u', String(s.id ?? 0)], ['id', String(pid)]]);
    await hist(p.coletaId, s, 'Cliente ciente da pendência', `${p.cod}${txt(b.resposta, 300) ? ' · ' + txt(b.resposta, 300) : ''}`);
    return { ok: true };
  }

  async function cienteTodas(id, b, s) {
    exigir(s, 'ciente');
    await coleta(id);
    const r = await consulta(`UPDATE PORTAL_PENDENCIAS SET STATUS = 'ciente', RESPOSTA_CLIENTE = @r, CIENTE_POR = @u, CIENTE_EM = SYSDATETIME()
      WHERE COLETA_ID = @id AND STATUS = 'aberta'; SELECT @@ROWCOUNT n;`, [['r', txt(b.resposta, 500), 'n'], ['u', String(s.id ?? 0)], ['id', String(id)]]);
    const n = r[0] ? r[0].n : 0;
    if (n) await hist(id, s, 'Cliente ciente das pendências', `${n} objeto${n > 1 ? 's' : ''}${txt(b.resposta, 300) ? ' · ' + txt(b.resposta, 300) : ''}`);
    return { ok: true, n };
  }

  async function resolver(pid, b, s) {
    exigir(s, 'resolver');
    const [p] = await consulta(`SELECT ID id, COLETA_ID coletaId, COD_OBJETO cod, STATUS status FROM PORTAL_PENDENCIAS WHERE ID = @id`, [['id', String(pid)]]);
    if (!p) throw new Erro(404, 'Pendência não encontrada.');
    if (p.status === 'resolvida') throw new Erro(409, 'Esta pendência já foi resolvida.');
    const solucao = txt(b.solucao, 500);
    if (!solucao) throw new Erro(400, 'Descreva como a pendência foi resolvida.');
    const [r] = await consulta(`UPDATE PORTAL_PENDENCIAS SET STATUS = 'resolvida', SOLUCAO = @s, RESOLVIDO_POR = @u, RESOLVIDO_EM = SYSDATETIME() WHERE ID = @id;
      UPDATE PORTAL_COLETAS SET STATUS = 'concluida' WHERE ID = @c AND STATUS = 'pendente'
        AND NOT EXISTS (SELECT 1 FROM PORTAL_PENDENCIAS WHERE COLETA_ID = @c AND STATUS <> 'resolvida');
      SELECT STATUS status FROM PORTAL_COLETAS WHERE ID = @c;`,
      [['s', solucao, 'n'], ['u', String(s.id ?? 0)], ['id', String(pid)], ['c', String(p.coletaId)]]);
    await hist(p.coletaId, s, 'Pendência resolvida', `${p.cod} · ${solucao}`);
    if (r && r.status === 'concluida') await hist(p.coletaId, s, 'Coleta concluída', 'Todas as pendências foram resolvidas');
    return { ok: true, status: r && r.status };
  }

  /* ---------- Usuários ---------- */
  async function listarUsuarios(s) {
    exigir(s, 'usuarios');
    return { usuarios: await consulta(`SELECT ID id, LOGIN login, NOME nome, EMAIL email, PERFIL perfil, ATIVO ativo,
      CONVERT(varchar(19), CRIADO_EM, 120) criadoEm, CONVERT(varchar(19), ULTIMO_ACESSO, 120) ultimoAcesso FROM PORTAL_USUARIOS ORDER BY ATIVO DESC, PERFIL, NOME`, []) };
  }
  async function salvarUsuario(b, s) {
    exigir(s, 'usuarios');
    const nome = txt(b.nome, 120), perfil = PERFIS.includes(b.perfil) ? b.perfil : null, email = txt(b.email, 160);
    if (!nome || !perfil) throw new Erro(400, 'Informe nome e perfil.');
    if (b.senha && String(b.senha).length < 8) throw new Erro(400, 'A senha precisa ter ao menos 8 caracteres.');
    if (!b.id) {
      const login = String(b.login || '').trim().toLowerCase();
      if (!/^[a-z0-9._-]{3,60}$/.test(login)) throw new Erro(400, 'Login: de 3 a 60 caracteres, só letras, números, ponto, hífen ou sublinhado.');
      if (!b.senha) throw new Erro(400, 'Defina uma senha inicial.');
      try {
        await consulta(`INSERT INTO PORTAL_USUARIOS (LOGIN, NOME, EMAIL, PERFIL, SENHA_HASH) VALUES (@l, @n, @e, @p, @h)`,
          [['l', login], ['n', nome, 'n'], ['e', email, 'n'], ['p', perfil], ['h', gerarHash(b.senha)]]);
      } catch (e) {
        if (/UQ_PORTAL_USUARIOS|duplicate|2627|2601/i.test(e.message + (e.number || ''))) throw new Erro(409, `O login ${login} já existe.`);
        throw e;
      }
      return { ok: true };
    }
    const id = int(b.id, 1, 1e9);
    if (!id) throw new Erro(400, 'Usuário inválido.');
    const ativo = b.ativo === false || b.ativo === '0' || b.ativo === 0 ? '0' : '1';
    if (id === s.id && (ativo === '0' || perfil !== 'admin')) throw new Erro(400, 'Você não pode desativar nem tirar o perfil de administrador do seu próprio usuário.');
    await consulta(`UPDATE PORTAL_USUARIOS SET NOME = @n, EMAIL = @e, PERFIL = @p, ATIVO = @a${b.senha ? ', SENHA_HASH = @h' : ''} WHERE ID = @id`,
      [['n', nome, 'n'], ['e', email, 'n'], ['p', perfil], ['a', ativo], ['h', b.senha ? gerarHash(b.senha) : null], ['id', String(id)]]);
    return { ok: true };
  }
  async function minhaSenha(b, s) {
    if (!s.id) throw new Erro(400, 'Este acesso vem do arquivo .env: troque a senha lá.');
    const [u] = await consulta(`SELECT SENHA_HASH hash FROM PORTAL_USUARIOS WHERE ID = @id AND ATIVO = 1`, [['id', String(s.id)]]);
    if (!u || !confere(b.atual, u.hash)) throw new Erro(400, 'Senha atual incorreta.');
    if (String(b.nova || '').length < 8) throw new Erro(400, 'A nova senha precisa ter ao menos 8 caracteres.');
    await consulta(`UPDATE PORTAL_USUARIOS SET SENHA_HASH = @h WHERE ID = @id`, [['h', gerarHash(b.nova)], ['id', String(s.id)]]);
    return { ok: true };
  }

  /* ---------- Roteamento ---------- */
  async function rota(caminho, req, q, s) {
    const post = req.method === 'POST';
    if (caminho === '/api/notificacoes') { if (!(await tabelas().catch(() => false))) return [200, { total: 0, itens: [], inativo: true }]; return [200, await notificacoes(s)]; }
    if (caminho === '/api/minha-senha' && post) { await exigirTabelas(); return [200, await minhaSenha(await lerCorpo(req), s)]; }
    if (caminho === '/api/usuarios') { await exigirTabelas(); return [200, post ? await salvarUsuario(await lerCorpo(req), s) : await listarUsuarios(s)]; }
    const m = /^\/api\/(coletas|embarques|pendencias)(?:\/(\d+))?(?:\/([a-z-]+))?$/.exec(caminho);
    if (!m) return null;
    await exigirTabelas();
    const [, rec, id, acao] = m;
    const b = post ? await lerCorpo(req) : {};
    if (rec === 'coletas') {
      if (!id && !acao) return [200, post ? await criar(b, s) : await listar(q)];
      if (id && !acao && !post) return [200, await detalhe(id)];
      const f = { agendar, coletar, cancelar, embarques: addEmbarque, finalizar, 'ciente-todas': cienteTodas }[acao];
      if (id && f && post) return [200, await f(id, b, s)];
    }
    if (rec === 'embarques' && id && post) {
      if (acao === 'conferir') return [200, await conferir(id, b, s)];
      if (acao === 'excluir') return [200, await excluirEmbarque(id, s)];
    }
    if (rec === 'pendencias' && id && post) {
      if (acao === 'ciente') return [200, await ciente(id, b, s)];
      if (acao === 'resolver') return [200, await resolver(id, b, s)];
    }
    return [404, { erro: 'Rota não encontrada' }];
  }

  return { rota, autenticar, gerarHash, Erro, PERFIS };
};
