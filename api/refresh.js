/* ============================================================================
   api/refresh.js  —  Vercel Serverless Function
   ----------------------------------------------------------------------------
   Panodaki "⟳ Yenile" düğmesinin çağırdığı ince tetikleyici.

   - POST  Authorization: Bearer <supabase access_token>
       → oturumu doğrular, GitHub Actions "collect" iş akışını tetikler
         (repository_dispatch: refresh). Asıl veri çekme işi orada
         (Playwright dahil) çalışır; bitince analytics_payload güncellenir.

   Neden burada veri çekilmiyor: Yemeksepeti / Trendyol GO panelleri için
   başlıksız tarayıcı (Playwright + Chromium) gerekiyor; Vercel fonksiyon
   ortamı ve süre limiti buna uygun değil. Tek motor = GitHub Actions.

   Vercel env:
     SUPABASE_URL, SUPABASE_ANON_KEY        (oturum doğrulama)
     GH_DISPATCH_REPO   örn. isodursmm-png/e-ticaret-uygulamasi
     GH_DISPATCH_TOKEN  fine-grained PAT — Contents: Read and write
     CRON_SECRET        (opsiyonel; Vercel Cron GET çağrısı için)
   ==========================================================================*/
'use strict';
const { createClient } = require('@supabase/supabase-js');

module.exports = async (req, res) => {
  try {
    if (req.method === 'GET') {
      // Vercel Cron: Authorization: Bearer $CRON_SECRET
      const s = process.env.CRON_SECRET;
      if (!s || req.headers.authorization !== `Bearer ${s}`) {
        return res.status(401).json({ ok: false, error: 'yetkisiz' });
      }
    } else if (req.method === 'POST') {
      const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
      if (!token) return res.status(401).json({ ok: false, error: 'oturum yok' });
      const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY, {
        auth: { persistSession: false }
      });
      const { data, error } = await sb.auth.getUser(token);
      if (error || !data || !data.user) {
        return res.status(401).json({ ok: false, error: 'oturum geçersiz' });
      }
    } else {
      res.setHeader('Allow', 'POST');
      return res.status(405).json({ ok: false, error: 'yalnızca POST' });
    }

    const repo = process.env.GH_DISPATCH_REPO;
    const ght = process.env.GH_DISPATCH_TOKEN;
    if (!repo || !ght) {
      return res.status(500).json({ ok: false, error: 'GH_DISPATCH_REPO / GH_DISPATCH_TOKEN tanımlı değil' });
    }

    const gr = await fetch(`https://api.github.com/repos/${repo}/dispatches`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${ght}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'eta-refresh',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ event_type: 'refresh', client_payload: { at: new Date().toISOString() } })
    });

    if (!gr.ok) {
      const t = await gr.text().catch(() => '');
      return res.status(502).json({ ok: false, error: `GitHub dispatch ${gr.status}: ${t.slice(0, 300)}` });
    }

    return res.status(202).json({ ok: true, triggered: true, message: 'Yenileme başlatıldı; veri 1-3 dk içinde güncellenir.' });
  } catch (e) {
    return res.status(500).json({ ok: false, error: String((e && e.message) || e) });
  }
};

module.exports.config = { maxDuration: 30 };
