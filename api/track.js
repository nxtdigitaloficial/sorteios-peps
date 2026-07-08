// Função serverless (Vercel) — Meta Conversions API (CAPI)
// Recebe o evento do navegador e reenvia para a Meta pelo lado do servidor.
// O token de acesso vem da variável de ambiente META_CAPI_TOKEN (nunca fica no código).

const PIXEL_ID = '946426101790251';
const API_VERSION = 'v21.0';

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ ok: false, error: 'Method not allowed' });
    return;
  }

  const token = process.env.META_CAPI_TOKEN;
  if (!token) {
    res.status(500).json({ ok: false, error: 'META_CAPI_TOKEN nao configurado' });
    return;
  }

  // O corpo pode chegar já como objeto (parse automático) ou como string.
  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch (e) { body = {}; }
  }
  body = body || {};

  const cookies = parseCookies(req.headers.cookie || '');

  const ip =
    (req.headers['x-forwarded-for'] || '').split(',')[0].trim() ||
    (req.socket && req.socket.remoteAddress) ||
    undefined;

  const userData = {
    client_user_agent: req.headers['user-agent'],
  };
  if (ip) userData.client_ip_address = ip;

  const fbp = body.fbp || cookies['_fbp'];
  const fbc = body.fbc || cookies['_fbc'];
  if (fbp) userData.fbp = fbp;
  if (fbc) userData.fbc = fbc;

  const event = {
    event_name: body.event_name || 'ViewContent',
    event_time: Math.floor(Date.now() / 1000),
    action_source: 'website',
    user_data: userData,
  };
  if (body.event_id) event.event_id = body.event_id;
  if (body.event_source_url) event.event_source_url = body.event_source_url;
  if (body.content_name) event.custom_data = { content_name: body.content_name };

  const payload = { data: [event] };
  const testCode = body.test_event_code || process.env.META_TEST_EVENT_CODE;
  if (testCode) payload.test_event_code = testCode;

  try {
    const fbRes = await fetch(
      'https://graph.facebook.com/' + API_VERSION + '/' + PIXEL_ID +
        '/events?access_token=' + encodeURIComponent(token),
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }
    );
    const result = await fbRes.json();
    res.status(fbRes.ok ? 200 : 502).json({ ok: fbRes.ok, meta: result });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e && e.message ? e.message : e) });
  }
};

function parseCookies(str) {
  const out = {};
  str.split(';').forEach(function (pair) {
    const idx = pair.indexOf('=');
    if (idx > -1) {
      const k = pair.slice(0, idx).trim();
      out[k] = decodeURIComponent(pair.slice(idx + 1).trim());
    }
  });
  return out;
}
