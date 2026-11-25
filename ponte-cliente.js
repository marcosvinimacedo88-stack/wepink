'use strict';
/*
 * Lado do portal da Ponte MySQL: conversa com o serviço ponte-mysql pela internet (túnel HTTPS + token).
 * Variáveis: PONTE_URL (ex.: https://ponte.seudominio.com.br) e PONTE_TOKEN.
 */
module.exports = function criarPonte({ lerCorpo }) {
  const env = process.env;
  const base = () => String(env.PONTE_URL || '').replace(/\/+$/, '');
  const configurada = () => !!(base() && String(env.PONTE_TOKEN || '').length >= 32);

  async function chamar(caminho, metodo = 'GET', corpo) {
    let r;
    try {
      r = await fetch(base() + caminho, {
        method: metodo,
        headers: { Authorization: 'Bearer ' + env.PONTE_TOKEN, 'Content-Type': 'application/json', Accept: 'application/json' },
        body: corpo ? JSON.stringify(corpo) : undefined,
        signal: AbortSignal.timeout(Number(env.PONTE_TEMPO_MS || 25000))
      });
    } catch (e) {
      const err = new Error(e.name === 'TimeoutError' ? 'A ponte demorou demais para responder.' : 'Não foi possível falar com a ponte (computador desligado, sem internet ou túnel parado).');
      err.status = 504; throw err;
    }
    const ehJson = /json/.test(r.headers.get('content-type') || '');
    const j = ehJson ? await r.json().catch(() => ({})) : {};
    if (!r.ok) {
      let msg = j.erro;
      if (!msg && !ehJson) msg = [502, 503, 530, 1033].includes(r.status)
        ? `O túnel da Cloudflare não alcançou a ponte (HTTP ${r.status}): a janela da ponte (iniciar-ponte.bat) está fechada, travou ou o túnel caiu.`
        : r.status === 524 ? 'A consulta demorou mais de 100 segundos e o túnel desistiu. Reduza o período.'
        : `A ponte respondeu com erro (HTTP ${r.status}).`;
      if (r.status === 401) msg = 'A ponte recusou o token: confira se o PONTE_TOKEN da Vercel é igual ao do .env da ponte.';
      const err = new Error(msg || `A ponte respondeu com erro (HTTP ${r.status}).`); err.status = 502; throw err;
    }
    return j;
  }

  let cache = { t: 0, v: null };
  async function lista() {
    if (cache.v && Date.now() - cache.t < 120e3) return cache.v;
    const j = await chamar('/consultas');
    cache = { t: Date.now(), v: j.consultas || [] };
    return cache.v;
  }

  async function rota(caminho, req, q, s) {
    if (!caminho.startsWith('/api/ponte/')) return null;
    try {
      if (caminho === '/api/ponte/status') {
        if (s.p !== 'admin') return [403, { erro: 'Só o administrador vê o status da ponte.' }];
        if (!configurada()) return [200, { configurada: false }];
        try { const r = await chamar('/saude'); cache.t = 0; return [200, { configurada: true, online: true, ...r }]; }
        catch (e) { return [200, { configurada: true, online: false, erro: e.message }]; }
      }
      if (caminho === '/api/ponte/consultas') {
        if (!configurada()) return [200, { configurada: false, consultas: [] }];
        try { return [200, { configurada: true, consultas: (await lista()).filter(c => (c.perfis || []).includes(s.p)) }]; }
        catch (e) { return [200, { configurada: true, offline: true, erro: e.message, consultas: [] }]; }
      }
      const m = /^\/api\/ponte\/consulta\/([\w-]{1,60})$/.exec(caminho);
      if (m && req.method === 'POST') {
        if (!configurada()) return [503, { erro: 'A ponte MySQL ainda não foi configurada (PONTE_URL e PONTE_TOKEN).' }];
        const def = (await lista()).find(c => c.nome === m[1]);
        if (!def) return [404, { erro: 'Consulta não encontrada na ponte.' }];
        if (!(def.perfis || []).includes(s.p)) return [403, { erro: 'Seu perfil não tem acesso a esta consulta.' }];
        const corpo = await lerCorpo(req);
        const params = {};
        for (const p of def.parametros || []) if (corpo && corpo[p.nome] != null) params[p.nome] = String(corpo[p.nome]).slice(0, 100);
        return [200, await chamar('/consulta/' + m[1], 'POST', params)];
      }
      return [404, { erro: 'Rota não encontrada' }];
    } catch (e) {
      console.error(new Date().toISOString(), 'ponte', caminho, e.message);
      return [e.status && e.status < 600 ? e.status : 502, { erro: e.message }];
    }
  }
  return { rota, configurada };
};
