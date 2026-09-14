/* ============================================================================
   api/yakit-sync.js  —  Vercel Serverless Function (Cron)
   ----------------------------------------------------------------------------
   Petrol Ofisi yakıt verisini (arac_takip_sistemi proxy'si üzerinden, bkz.
   api/_lib/aracTakip.js) çekip public.yakitlar tablosuna KALICI olarak yazar.
   Vercel Cron ile her gün bir kez tetiklenir — içinde bulunduğumuz ay henüz
   kapanmadığı için her çalıştığında o ayın satırını GÜNCELLER (upsert),
   böylece "ay bazlı, günlük eklenen" bir kayıt oluşur.

   GET Authorization: Bearer <CRON_SECRET>      (api/refresh.js ile aynı sır)
       ?ay=YYYY-MM   (opsiyonel — geçmiş bir ayı elle yeniden senkronlamak için;
                      verilmezse içinde bulunduğumuz ay, bugüne kadar)

   Vercel Cron: vercel.json > crons — her gün bir kez.
   Vercel env: aracTakip.js'teki ARAC_TAKIP_* + SUPABASE_URL/SERVICE_ROLE + CRON_SECRET
   ==========================================================================*/
'use strict';
const { createClient } = require('@supabase/supabase-js');
const { getAracTakipToken, getAraclarMap, fetchYakitRange, aggregateByPlate } = require('./_lib/aracTakip');

/** ?ay=YYYY-MM -> o ayın [1. gün, son gün] aralığı; boşsa içinde bulunduğumuz ay [1. gün, bugün]. */
function monthRange(ayParam) {
  const now = new Date();
  let y = now.getFullYear(), m = now.getMonth() + 1;
  if (ayParam && /^\d{4}-\d{2}$/.test(ayParam)) {
    [y, m] = ayParam.split('-').map(Number);
  }
  const isCurrent = y === now.getFullYear() && m === now.getMonth() + 1;
  const start = new Date(y, m - 1, 1);
  const end = isCurrent ? now : new Date(y, m, 0);
  const pad = (n) => String(n).padStart(2, '0');
  return {
    startISO: `${y}-${pad(m)}-01`,
    endISO: `${end.getFullYear()}-${pad(end.getMonth() + 1)}-${pad(end.getDate())}`,
    ayFirst: `${y}-${pad(m)}-01`
  };
}

async function fetchWithRetry(base, token, startISO, endISO) {
  try {
    return await fetchYakitRange(base, token, startISO, endISO, 25000);
  } catch (e) {
    if (!e.retry) throw e;
    await new Promise((r) => setTimeout(r, 3000));
    return await fetchYakitRange(base, token, startISO, endISO, 25000);
  }
}

module.exports = async (req, res) => {
  try {
    if (req.method !== 'GET') {
      res.setHeader('Allow', 'GET');
      return res.status(405).json({ ok: false, error: 'yalnızca GET' });
    }

    const secret = process.env.CRON_SECRET;
    const auth = String(req.headers.authorization || '');
    if (!secret || auth !== `Bearer ${secret}`) {
      return res.status(401).json({ ok: false, error: 'yetkisiz' });
    }

    const { startISO, endISO, ayFirst } = monthRange(req.query.ay);

    const svcSb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE, {
      auth: { persistSession: false }
    });
    const plateMeta = await getAraclarMap(svcSb);
    if (!plateMeta.size) return res.status(200).json({ ok: true, ay: ayFirst, written: 0, note: 'araclar boş' });

    const base = process.env.ARAC_TAKIP_API_BASE;
    if (!base || !process.env.ARAC_TAKIP_SUPABASE_URL || !process.env.ARAC_TAKIP_PROXY_EMAIL) {
      return res.status(500).json({ ok: false, error: 'ARAC_TAKIP_* ortam değişkenleri tanımlı değil' });
    }
    const token = await getAracTakipToken();
    const payload = await fetchWithRetry(base, token, startISO, endISO);
    const { byPlate } = aggregateByPlate(payload.sales, plateMeta);

    const now = new Date().toISOString();
    const rows = byPlate.map((p) => ({
      arac_id: p.id, ay: ayFirst, litre: p.litre, tutar: p.tutar, islem: p.islem, updated_at: now
    }));
    const { error } = await svcSb.from('yakitlar').upsert(rows, { onConflict: 'arac_id,ay' });
    if (error) return res.status(500).json({ ok: false, error: 'yakitlar upsert: ' + error.message });

    return res.status(200).json({ ok: true, ay: ayFirst, start: startISO, end: endISO, arac: rows.length });
  } catch (e) {
    return res.status(e.status || 500).json({ ok: false, error: String((e && e.message) || e) });
  }
};

module.exports.config = { maxDuration: 60 };
