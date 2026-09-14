/* ============================================================================
   api/yakit.js  —  Vercel Serverless Function
   ----------------------------------------------------------------------------
   "E-Ticaret Otoları" sayfasındaki Yakıt Alımları paneli için: Petrol Ofisi
   "Automatic" filo kartı verisini arac_takip_sistemi'nin backend'i üzerinden
   çeker, yalnızca bu projenin `araclar` tablosundaki plakalarla eşleşenleri
   döndürür.

   Neden doğrudan Petrol Ofisi çağrılmıyor: o API IP whitelist'li — yalnızca
   arac_takip_sistemi'nin Render sunucusunun IP'si tanımlı. Vercel'den (veya
   herhangi bir yerden) doğrudan çağrı denendi, yanıtsız zaman aşımına uğradı.
   Bunun yerine arac_takip_sistemi'nin Supabase projesinde bu iş için açılmış
   bir "servis kullanıcısı" ile giriş yapılıp, o backend'in zaten var olan
   GET /api/yakitlar uç noktası normal bir oturum gibi çağrılıyor.
   arac_takip_sistemi'nin kodunda hiçbir değişiklik gerekmedi.

   GET Authorization: Bearer <bu projenin supabase access_token'ı>
       ?start=YYYY-MM-DD&end=YYYY-MM-DD  (opsiyonel; varsayılan: son 30 gün)

   Render ücretsiz planda hareketsizlik sonrası uykuya dalıyor; ilk istek
   uyanma + Petrol Ofisi çağrısı yüzünden 1-2 dakika sürebilir. Render'ı
   uykuda tutmak için harici bir "uptime ping" servisi (ör. cron-job.org,
   UptimeRobot) her ~10 dakikada bir ARAC_TAKIP_API_BASE'e istek atabilir.

   Vercel env:
     SUPABASE_URL, SUPABASE_ANON_KEY      (bu projenin oturum doğrulaması)
     SUPABASE_SERVICE_ROLE                (araclar tablosunu okumak için)
     ARAC_TAKIP_API_BASE                  https://arac-bakim-sistemi.onrender.com
     ARAC_TAKIP_SUPABASE_URL              arac_takip_sistemi'nin Supabase URL'i
     ARAC_TAKIP_SUPABASE_ANON_KEY         arac_takip_sistemi'nin anon/publishable key'i
     ARAC_TAKIP_PROXY_EMAIL / _PASSWORD   o Supabase'te oluşturulmuş servis kullanıcısı
   ==========================================================================*/
'use strict';
const { createClient } = require('@supabase/supabase-js');

const norm = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

// Sıcak (warm) çağrılar arası basit token cache — her istekte yeniden giriş yapmayı önler.
let cachedToken = null;   // { token, exp }
async function getAracTakipToken() {
  if (cachedToken && cachedToken.exp > Date.now()) return cachedToken.token;

  const sb = createClient(process.env.ARAC_TAKIP_SUPABASE_URL, process.env.ARAC_TAKIP_SUPABASE_ANON_KEY, {
    auth: { persistSession: false }
  });
  const { data, error } = await sb.auth.signInWithPassword({
    email: process.env.ARAC_TAKIP_PROXY_EMAIL,
    password: process.env.ARAC_TAKIP_PROXY_PASSWORD
  });
  if (error || !data.session) throw new Error('arac_takip_sistemi girişi başarısız: ' + (error && error.message));

  cachedToken = { token: data.session.access_token, exp: Date.now() + 50 * 60 * 1000 };
  return cachedToken.token;
}

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
    const { data: araclar, error: aracErr } = await svcSb.from('araclar').select('plaka,sube,sofor,kullanim');
    if (aracErr) return res.status(500).json({ ok: false, error: 'araclar okunamadı: ' + aracErr.message });

    const plateMeta = new Map();          // normalize(plaka) -> { plaka, sube, sofor, kullanim }
    for (const a of araclar || []) {
      if (a.plaka) plateMeta.set(norm(a.plaka), a);
    }
    if (!plateMeta.size) {
      return res.status(200).json({ ok: true, start: start.toISOString(), end: end.toISOString(), count: 0, sales: [], byPlate: [] });
    }

    // ---- 4) arac_takip_sistemi env kontrolü + giriş ----
    const base = process.env.ARAC_TAKIP_API_BASE;
    if (!base || !process.env.ARAC_TAKIP_SUPABASE_URL || !process.env.ARAC_TAKIP_PROXY_EMAIL) {
      return res.status(500).json({ ok: false, error: 'ARAC_TAKIP_* ortam değişkenleri tanımlı değil' });
    }
    const proxyToken = await getAracTakipToken();

    // ---- 5) yakıt verisini çek ----
    const qs = `start=${start.toISOString().slice(0, 10)}&end=${end.toISOString().slice(0, 10)}`;
    const fr = await fetch(`${base}/api/yakitlar?${qs}`, {
      headers: { Authorization: `Bearer ${proxyToken}` }
    });
    if (!fr.ok) {
      const t = await fr.text().catch(() => '');
      return res.status(502).json({ ok: false, error: `arac_takip_sistemi ${fr.status}: ${t.slice(0, 300)}` });
    }
    const payload = await fr.json();

    // ---- 6) yalnızca araclar'daki plakalara filtrele + plaka bazında topla ----
    const byPlateMap = new Map();
    const sales = [];
    for (const s of payload.sales || []) {
      const key = norm(s.plaka);
      const meta = plateMeta.get(key);
      if (!meta) continue;
      sales.push(s);
      const agg = byPlateMap.get(key) || {
        plaka: meta.plaka, sube: meta.sube, sofor: meta.sofor, kullanim: meta.kullanim,
        litre: 0, tutar: 0, islem: 0
      };
      agg.litre += Number(s.litre) || 0;
      agg.tutar += Number(s.tutar) || 0;
      agg.islem += 1;
      byPlateMap.set(key, agg);
    }
    // araclar'da olup bu aralıkta hiç alım yapmayanları da 0'la listede tut
    for (const [key, meta] of plateMeta) {
      if (!byPlateMap.has(key)) {
        byPlateMap.set(key, { plaka: meta.plaka, sube: meta.sube, sofor: meta.sofor, kullanim: meta.kullanim, litre: 0, tutar: 0, islem: 0 });
      }
    }
    const byPlate = [...byPlateMap.values()].sort((a, b) => b.tutar - a.tutar);

    return res.status(200).json({
      ok: true,
      start: start.toISOString(),
      end: end.toISOString(),
      count: sales.length,
      sales,
      byPlate
    });
  } catch (e) {
    return res.status(500).json({ ok: false, error: String((e && e.message) || e) });
  }
};

module.exports.config = { maxDuration: 90 };
