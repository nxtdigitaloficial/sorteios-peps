// Endpoint público (somente leitura) com a config que o navegador precisa
// para a trava de domínio. CORS aberto de propósito: assim um clone hospedado
// em outro domínio também consegue ler e se auto-redirecionar pro site real.
module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'public, max-age=60');

  let trava_ativa = true;
  let dominios_extra = [];

  const su = process.env.SUPABASE_URL;
  const sk = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (su && sk) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 2500);
      const r = await fetch(
        su + '/rest/v1/config?id=eq.1&select=trava_ativa,dominios_extra',
        { headers: { apikey: sk, Authorization: 'Bearer ' + sk }, signal: ctrl.signal }
      );
      clearTimeout(timer);
      if (r.ok) {
        const rows = await r.json();
        if (rows && rows[0]) {
          trava_ativa = rows[0].trava_ativa !== false;
          dominios_extra = Array.isArray(rows[0].dominios_extra) ? rows[0].dominios_extra : [];
        }
      }
    } catch (e) { /* falha: devolve defaults */ }
  }

  res.status(200).json({ trava_ativa, dominios_extra });
};
