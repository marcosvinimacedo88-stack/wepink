'use strict';
/*
 * Envio de WhatsApp. Escolha o provedor em WHATSAPP_PROVEDOR:
 *   meta  -> API oficial do WhatsApp (Cloud API da Meta). Exige modelos (templates) aprovados.
 *   zapi  -> Z-API (z-api.io). Mais simples de configurar, sem modelos.
 *   (vazio) -> desativado: o portal só mostra os avisos no sino.
 */
const env = process.env;

const somenteDigitos = s => String(s || '').replace(/\D/g, '');
function normalizarTelefone(t) {
  let d = somenteDigitos(t);
  if (d.length === 10 || d.length === 11) d = '55' + d;
  return /^\d{12,13}$/.test(d) ? d : null;
}

function provedor() {
  const p = String(env.WHATSAPP_PROVEDOR || '').toLowerCase();
  if (p === 'meta' && env.WHATSAPP_META_TOKEN && env.WHATSAPP_META_PHONE_ID) return 'meta';
  if (p === 'zapi' && env.ZAPI_INSTANCIA && env.ZAPI_TOKEN) return 'zapi';
  return null;
}

/* ---------- Meta (Cloud API oficial) ---------- */
const graph = () => `${env.WHATSAPP_META_URL || 'https://graph.facebook.com'}/${env.WHATSAPP_META_VERSAO || 'v25.0'}/${env.WHATSAPP_META_PHONE_ID}`;
async function metaPost(caminho, corpo, ehForm) {
  const r = await fetch(graph() + caminho, {
    method: 'POST',
    headers: ehForm ? { Authorization: 'Bearer ' + env.WHATSAPP_META_TOKEN } : { Authorization: 'Bearer ' + env.WHATSAPP_META_TOKEN, 'Content-Type': 'application/json' },
    body: ehForm ? corpo : JSON.stringify(corpo),
    signal: AbortSignal.timeout(20000)
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((j.error && (j.error.error_user_msg || j.error.message)) || `Meta HTTP ${r.status}`);
  return j;
}
async function metaEnviar(tel, { texto, imagem, variaveis }) {
  const lang = { code: env.WHATSAPP_META_IDIOMA || 'pt_BR' };
  const corpo = (variaveis || [texto]).map(v => ({ type: 'text', text: String(v).slice(0, 900) }));
  if (imagem) {
    const fd = new FormData();
    fd.append('messaging_product', 'whatsapp');
    fd.append('type', imagem.mime);
    fd.append('file', new Blob([imagem.buffer], { type: imagem.mime }), imagem.nome || 'protocolo.png');
    const up = await metaPost('/media', fd, true);
    return metaPost('/messages', {
      messaging_product: 'whatsapp', to: tel, type: 'template',
      template: { name: env.WHATSAPP_META_MODELO_IMAGEM || 'agf_protocolo', language: lang,
        components: [{ type: 'header', parameters: [{ type: 'image', image: { id: up.id } }] }, { type: 'body', parameters: corpo }] }
    });
  }
  return metaPost('/messages', {
    messaging_product: 'whatsapp', to: tel, type: 'template',
    template: { name: env.WHATSAPP_META_MODELO_TEXTO || 'agf_aviso', language: lang, components: [{ type: 'body', parameters: corpo }] }
  });
}

/* ---------- Z-API ---------- */
async function zapiEnviar(tel, { texto, imagem }) {
  const base = `${env.ZAPI_URL || 'https://api.z-api.io'}/instances/${env.ZAPI_INSTANCIA}/token/${env.ZAPI_TOKEN}`;
  const headers = { 'Content-Type': 'application/json' };
  if (env.ZAPI_CLIENT_TOKEN) headers['Client-Token'] = env.ZAPI_CLIENT_TOKEN;
  const [rota, corpo] = imagem
    ? ['/send-image', { phone: tel, image: `data:${imagem.mime};base64,${imagem.buffer.toString('base64')}`, caption: texto }]
    : ['/send-text', { phone: tel, message: texto }];
  const r = await fetch(base + rota, { method: 'POST', headers, body: JSON.stringify(corpo), signal: AbortSignal.timeout(20000) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.error) throw new Error(j.error || j.message || `Z-API HTTP ${r.status}`);
  return j;
}

/*
 * enviar(telefone, { texto, imagem?, variaveis? })
 *  texto: mensagem completa (Z-API usa direto; Meta usa como variável {{1}} do modelo agf_aviso)
 *  variaveis: lista de textos para o modelo da Meta (opcional)
 *  imagem: { buffer, mime, nome }
 * Retorna { ok, status, detalhe }
 */
async function enviar(telefone, msg) {
  const tel = normalizarTelefone(telefone);
  if (!tel) return { ok: false, status: 'erro', detalhe: 'Telefone inválido' };
  const p = provedor();
  if (!p) return { ok: false, status: 'desativado', detalhe: 'WhatsApp automático não configurado' };
  try {
    const r = p === 'meta' ? await metaEnviar(tel, msg) : await zapiEnviar(tel, msg);
    return { ok: true, status: 'enviado', detalhe: JSON.stringify(r).slice(0, 900) };
  } catch (e) {
    return { ok: false, status: 'erro', detalhe: e.message.slice(0, 900) };
  }
}

module.exports = { enviar, normalizarTelefone, provedor };
