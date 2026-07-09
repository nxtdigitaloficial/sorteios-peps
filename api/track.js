// Função serverless (Vercel) — Meta Conversions API (CAPI)
// Recebe o evento do navegador e reenvia para a Meta pelo lado do servidor.
// O token de acesso vem da variável de ambiente META_CAPI_TOKEN (nunca fica no código).
//
// Regra de desduplicação (Meta Payload Helper): todo evento do servidor DEVE
// levar o mesmo event_id + event_name do evento do Pixel. Por isso, requisições
// sem event_id são rejeitadas — é melhor não enviar do que enviar sem dedup e
// gerar contagem em dobro nas campanhas.

const crypto = require('crypto');

const PIXEL_ID = '946426101790251';
const API_VERSION = 'v21.0';
const ALLOWED_EVENTS = ['PageView', 'ViewContent'];

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

  const body = await readJsonBody(req);

  if (!body.event_id || typeof body.event_id !== 'string') {
    res.status(400).json({ ok: false, error: 'event_id obrigatorio (desduplicacao)' });
    return;
  }
  if (!ALLOWED_EVENTS.includes(body.event_name)) {
    res.status(400).json({ ok: false, error: 'event_name invalido' });
    return;
  }

  const cookies = parseCookies(req.headers.cookie || '');

  const ip =
    (req.headers['x-forwarded-for'] || '').split(',')[0].trim() ||
    (req.socket && req.socket.remoteAddress) ||
    undefined;

  const userData = {
    client_user_agent: req.headers['user-agent'],
  };
  if (ip) userData.client_ip_address = ip;

  // fbp/fbc: usa o que o navegador mandou; senão, lê dos cookies da própria requisição
  const fbp = body.fbp || cookies['_fbp'];
  const fbc = body.fbc || cookies['_fbc'];
  if (fbp) userData.fbp = fbp;
  if (fbc) userData.fbc = fbc;

  // external_id: o Pixel envia com hash SHA-256 automatico; aqui fazemos o
  // mesmo hash para os dois lados casarem na Meta.
  if (body.external_id && typeof body.external_id === 'string') {
    userData.external_id = crypto
      .createHash('sha256')
      .update(body.external_id)
      .digest('hex');
  }

  const event = {
    event_name: body.event_name,
    event_id: body.event_id,
    event_time: Math.floor(Date.now() / 1000),
    action_source: 'website',
    user_data: userData,
  };
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
    res.status(fbRes.ok ? 200 : 502).json({
      ok: fbRes.ok,
      meta: result,
      sent: { event_name: event.event_name, event_id: event.event_id },
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e && e.message ? e.message : e) });
  }
};

// Aceita o corpo em qualquer formato que a plataforma entregar:
// objeto já parseado, string, Buffer, ou stream ainda não lido.
async function readJsonBody(req) {
  let b = req.body;
  if (b === undefined || b === null) {
    try {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      b = Buffer.concat(chunks).toString('utf8');
    } catch (e) {
      b = '';
    }
  }
  if (Buffer.isBuffer(b)) b = b.toString('utf8');
  if (typeof b === 'string') {
    try { b = JSON.parse(b); } catch (e) { b = {}; }
  }
  return b && typeof b === 'object' && !Array.isArray(b) ? b : {};
}

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
