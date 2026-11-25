'use strict';
/*
 * Cadastro de operadores das cubadoras (SQL Server). Os dados de bipagem vêm do MySQL pela Ponte.
 * Tabela: criar_tabela_cubadora.sql
 */
module.exports = function criarCubadora({ consulta, lerCorpo }) {
  const PERFIS = ['operacao', 'admin'];
  let tab = { v: null, t: 0 };
  async function existe() {
    if (tab.v === true || (tab.v === false && Date.now() - tab.t < 30e3)) return tab.v;
    const r = await consulta(`SELECT CASE WHEN OBJECT_ID('dbo.PORTAL_OPERADORES_CUBADORA','U') IS NULL THEN 0 ELSE 1 END ok`, []);
    tab = { v: !!r[0].ok, t: Date.now() };
    return tab.v;
  }
  const erro = (st, m) => [st, { erro: m }];

  async function rota(caminho, req, q, s) {
    if (caminho !== '/api/cubadora/operadores') return null;
    if (!PERFIS.includes(s.p)) return erro(403, 'Seu perfil não tem acesso às cubadoras.');
    if (!(await existe().catch(() => false))) return erro(503, 'Rode o script criar_tabela_cubadora.sql no banco para ativar o cadastro de operadores.');
    if (req.method !== 'POST') {
      return [200, { operadores: await consulta(`SELECT ID id, NUMERO numero, NOME nome, TURNO turno, ATIVO ativo FROM PORTAL_OPERADORES_CUBADORA ORDER BY ATIVO DESC, NOME`, []) }];
    }
    const b = await lerCorpo(req);
    const numero = String(b.numero ?? '').trim();
    const nome = String(b.nome ?? '').trim().slice(0, 120);
    const turno = String(b.turno ?? '').trim().slice(0, 30) || null;
    if (!/^[0-9A-Za-z_-]{1,20}$/.test(numero)) return erro(400, 'Informe o número do operador na cubadora (até 20 caracteres, sem espaços).');
    if (!nome) return erro(400, 'Informe o nome do operador.');
    const ativo = b.ativo === false || b.ativo === '0' ? '0' : '1';
    const id = Number.isInteger(Number(b.id)) && Number(b.id) > 0 ? String(Number(b.id)) : null;
    try {
      if (id) await consulta(`UPDATE PORTAL_OPERADORES_CUBADORA SET NUMERO = @n, NOME = @nm, TURNO = @t, ATIVO = @a WHERE ID = @id`,
        [['n', numero], ['nm', nome, 'n'], ['t', turno, 'n'], ['a', ativo], ['id', id]]);
      else await consulta(`INSERT INTO PORTAL_OPERADORES_CUBADORA (NUMERO, NOME, TURNO) VALUES (@n, @nm, @t)`, [['n', numero], ['nm', nome, 'n'], ['t', turno, 'n']]);
    } catch (e) {
      if (/UQ_PORTAL_OP_CUB_NUMERO|duplicate|2627|2601/i.test(e.message + (e.number || ''))) return erro(409, `O número ${numero} já está cadastrado.`);
      throw e;
    }
    return [200, { ok: true }];
  }
  return { rota };
};
