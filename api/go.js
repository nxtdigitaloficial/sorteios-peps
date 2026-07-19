// Função serverless (Vercel) — redirecionador do botão "Entrar no Grupo VIP".
// Registra o clique no Supabase, escolhe o grupo conforme as regras (função
// registrar_clique no banco) e redireciona a pessoa para o WhatsApp.
//
// Robustez: se o Supabase estiver indisponível ou ainda não configurado,
// redireciona para o link reserva — o visitante nunca fica sem destino.

const FALLBACK_LINK = 'https://chat.whatsapp.com/JJl7p5jjARbKZ35wcjQKw6';
const SUPABASE_TIMEOUT_MS = 3000;

module.exports = async (req, res) => {
  const url = new URL(req.url, 'https://sorteios-peps.shop');
  const q = url.searchParams;
  const cookies = parseCookies(req.headers.cookie || '');

  const ip =
    (req.headers['x-forwarded-for'] || '').split(',')[0].trim() ||
    (req.socket && req.socket.remoteAddress) ||
    null;

  const fbclid = q.get('fbclid');
  const fbc =
    cookies['_fbc'] || (fbclid ? 'fb.1.' + Date.now() + '.' + fbclid : null);

  let link = process.env.WHATSAPP_FALLBACK_LINK || FALLBACK_LINK;

  const su = process.env.SUPABASE_URL;
  const sk = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (su && sk) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), SUPABASE_TIMEOUT_MS);
      const r = await fetch(su + '/rest/v1/rpc/registrar_clique', {
        method: 'POST',
        headers: {
          apikey: sk,
          Authorization: 'Bearer ' + sk,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          p_external_id: cookies['ext_id'] || null,
          p_ip: ip,
          p_user_agent: req.headers['user-agent'] || null,
          p_url: q.toString() ? '/?' + q.toString() : '/',
          p_fbp: cookies['_fbp'] || null,
          p_fbc: fbc,
          p_fbclid: fbclid,
          p_utm_source: q.get('utm_source'),
          p_utm_medium: q.get('utm_medium'),
          p_utm_campaign: q.get('utm_campaign'),
          p_utm_content: q.get('utm_content'),
          p_utm_term: q.get('utm_term'),
        }),
        signal: ctrl.signal,
      });
      clearTimeout(timer);
      if (r.ok) {
        const rows = await r.json();
        if (Array.isArray(rows) && rows[0] && rows[0].link) {
          link = rows[0].link;
        }
      }
    } catch (e) {
      // banco fora do ar: segue com o link reserva
    }
  }

  res.statusCode = 302;
  res.setHeader('Location', link);
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  res.end();
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
