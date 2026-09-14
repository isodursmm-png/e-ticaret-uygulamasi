/* ============================================================================
   api/yakit.js  —  Vercel Serverless Function
   ----------------------------------------------------------------------------
   "E-Ticaret Otoları" sayfasındaki Yakıt Alımları paneli — CANLI/anlık "Çek"
   butonu. Petrol Ofisi verisini arac_takip_sistemi'nin backend'i üzerinden
   çeker (bkz. api/_lib/aracTakip.js), yalnızca `araclar` tablosundaki
   plakalarla eşleşenleri döndürür. Kalıcı günlük kayıt için api/yakit-sync.js.

   Neden doğrudan Petrol Ofisi çağrılmıyor: o API IP whitelist'li — yalnızca
   arac_takip_sistemi'nin Render sunucusunun IP'si tanımlı (iki kez test
   edildi, doğrudan çağrı hiç yanıt almadan zaman aşımına uğradı).

   GET Authorization: Bearer <bu projenin supabase access_token'ı>
       ?start=YYYY-MM-DD&end=YYYY-MM-DD  (opsiyonel; varsayılan: son 30 gün)

   Vercel env: bkz. api/_lib/aracTakip.js başlığı + SUPABASE_URL/ANON_KEY/SERVICE_ROLE
   ==========================================================================*/
'use strict';
const { createClient } = require('@supabase/supabase-js');
const { getAracTakipToken, getAraclarMap, fetchYakitRange, aggregateByPlate } = require('./_lib/aracTakip');

module.exports = async (req, res) => {
  try {
    if (req.method !== 'GET') {
      res.setHeader('Allow', 'GET');
      return res.status(405).json({ ok: false, error: 'yalnızca GET' });
    }

    // ---- 1) bu projenin oturumunu doğrula ----
    const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    if (!token) return res.status(401).json({ ok: false, error: 'oturum yok' });
    const authSb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY, {
      auth: { persistSession: false }
    });
    const { data: authData, error: authErr } = await authSb.auth.getUser(token);
    if (authErr || !authData || !authData.user) {
      return res.status(401).json({ ok: false, error: 'oturum geçersiz' });
    }

    // ---- 2) tarih aralığı ----
    const now = new Date();
    const defaultStart = new Date(now.getTime() - 30 * 86400000);
    const start = req.query.start ? new Date(req.query.start + 'T00:00:00') : defaultStart;
    const end = req.query.end ? new Date(req.query.end + 'T23:59:59') : now;
    if (isNaN(start) || isNaN(end)) return res.status(400).json({ ok: false, error: 'geçersiz tarih' });
    if (start > end) return res.status(400).json({ ok: false, error: 'başlangıç tarihi bitişten sonra olamaz' });

    // ---- 3) araclar tablosundaki plakalar (service role — RLS'ten bağımsız) ----
    const svcSb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE, {
      auth: { persistSession: false }
    });
    const plateMeta = await getAraclarMap(svcSb);
    if (!plateMeta.size) {
      return res.status(200).json({ ok: true, start: start.toISOString(), end: end.toISOString(), count: 0, sales: [], byPlate: [] });
    }

    // ---- 4) arac_takip_sistemi env kontrolü + giriş ----
    const base = process.env.ARAC_TAKIP_API_BASE;
    if (!base || !process.env.ARAC_TAKIP_SUPABASE_URL || !process.env.ARAC_TAKIP_PROXY_EMAIL) {
      return res.status(500).json({ ok: false, error: 'ARAC_TAKIP_* ortam değişkenleri tanımlı değil' });
    }
    const proxyToken = await getAracTakipToken();

    // ---- 5) yakıt verisini çek + yalnızca araclar'daki plakalara filtrele/topla ----
    const payload = await fetchYakitRange(base, proxyToken, start.toISOString().slice(0, 10), end.toISOString().slice(0, 10), 20000);
    const { matchedSales, byPlate } = aggregateByPlate(payload.sales, plateMeta);

    return res.status(200).json({
      ok: true,
      start: start.toISOString(),
      end: end.toISOString(),
      count: matchedSales.length,
      sales: matchedSales,
      byPlate
    });
  } catch (e) {
    return res.status(e.status || 500).json({ ok: false, error: String((e && e.message) || e), retry: e.retry });
  }
};

module.exports.config = { maxDuration: 60 };
