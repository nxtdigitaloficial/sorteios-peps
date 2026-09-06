// Endpoint de administração — protegido por senha (env ADMIN_TOKEN).
// Todas as ações rodam no servidor com a chave do Supabase (nunca no navegador).
const crypto = require('crypto');
const SU = process.env.SUPABASE_URL;
const SK = process.env.SUPABASE_SERVICE_ROLE_KEY;
const WA = /^https:\/\/chat\.whatsapp\.com\/[A-Za-z0-9]+$/;

function tokenOk(req) {
  const t = String(req.headers['x-admin-token'] || '');
  const real = String(process.env.ADMIN_TOKEN || '');
  if (!real || !t) return false;
  const a = Buffer.from(t), b = Buffer.from(real);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

async function sb(path, opts) {
  const r = await fetch(SU + path, {
    ...(opts || {}),
    headers: {
      apikey: SK, Authorization: 'Bearer ' + SK,
      'Content-Type': 'application/json',
      ...((opts && opts.headers) || {}),
    },
  });
  const txt = await r.text();
  let data = null; try { data = txt ? JSON.parse(txt) : null; } catch (e) { data = txt; }
  return { ok: r.ok, status: r.status, data };
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') { res.status(405).json({ ok: false, error: 'method' }); return; }
  if (!tokenOk(req)) { res.status(401).json({ ok: false, error: 'nao autorizado' }); return; }
  if (!SU || !SK) { res.status(500).json({ ok: false, error: 'supabase nao configurado' }); return; }

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = {}; } }
  body = body || {};
  const acao = body.acao;

  try {
    if (acao === 'estado') {
      const g = await sb('/rest/v1/grupos?select=*&order=id.asc');
      const c = await sb('/rest/v1/config?id=eq.1&select=*');
      res.status(200).json({ ok: true, grupos: g.data || [], config: (c.data && c.data[0]) || null });
      return;
    }

    if (acao === 'grupo_add') {
      const row = {
        nome: String(body.nome || '').slice(0, 80),
        link: String(body.link || '').trim(),
        peso: Number(body.peso) || 0,
        ativo: body.ativo !== false,
        max_cliques: (body.max_cliques === '' || body.max_cliques == null) ? null : Number(body.max_cliques),
      };
      if (!row.nome || !WA.test(row.link)) { res.status(400).json({ ok: false, error: 'nome ou link invalido (link deve ser chat.whatsapp.com)' }); return; }
      const r = await sb('/rest/v1/grupos', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify(row) });
      res.status(r.ok ? 200 : 500).json({ ok: r.ok, grupo: r.data && r.data[0], erro: r.ok ? undefined : r.data });
      return;
    }

    if (acao === 'grupo_editar') {
      const id = Number(body.id); if (!id) { res.status(400).json({ ok: false, error: 'id' }); return; }
      const upd = {};
      if (body.nome != null) upd.nome = String(body.nome).slice(0, 80);
      if (body.link != null) { const l = String(body.link).trim(); if (!WA.test(l)) { res.status(400).json({ ok: false, error: 'link invalido' }); return; } upd.link = l; }
      if (body.peso != null) upd.peso = Number(body.peso) || 0;
      if (body.ativo != null) upd.ativo = !!body.ativo;
      if ('max_cliques' in body) upd.max_cliques = (body.max_cliques === '' || body.max_cliques == null) ? null : Number(body.max_cliques);
      const r = await sb('/rest/v1/grupos?id=eq.' + id, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify(upd) });
      res.status(r.ok ? 200 : 500).json({ ok: r.ok, grupo: r.data && r.data[0], erro: r.ok ? undefined : r.data });
      return;
    }

    if (acao === 'config_salvar') {
      const upd = { atualizado_em: new Date().toISOString() };
      if ('trava_ativa' in body) upd.trava_ativa = !!body.trava_ativa;
      if ('dominios_extra' in body) upd.dominios_extra = Array.isArray(body.dominios_extra) ? body.dominios_extra.map(s => String(s).toLowerCase().trim()).filter(Boolean) : [];
      if ('grupo_fallback' in body) upd.grupo_fallback = Number(body.grupo_fallback) || 1;
      if ('somente_anuncio' in body) upd.somente_anuncio = !!body.somente_anuncio;
      if ('fidelidade_dias' in body) upd.fidelidade_dias = Math.max(1, Math.min(3650, Number(body.fidelidade_dias) || 30));
      const r = await sb('/rest/v1/config?id=eq.1', { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify(upd) });
      res.status(r.ok ? 200 : 500).json({ ok: r.ok, config: r.data && r.data[0], erro: r.ok ? undefined : r.data });
      return;
    }

    if (acao === 'metricas') {
      const r = await sb('/rest/v1/rpc/metricas', {
        method: 'POST',
        body: JSON.stringify({
          p_de: body.de, p_ate: body.ate,
          p_dominio: body.dominio || 'todos', p_versao: body.versao || 'todos', p_origem: body.origem || 'todos',
        }),
      });
      res.status(r.ok ? 200 : 500).json({ ok: r.ok, metricas: r.data, erro: r.ok ? undefined : r.data });
      return;
    }

    res.status(400).json({ ok: false, error: 'acao desconhecida' });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e && e.message ? e.message : e) });
  }
};
