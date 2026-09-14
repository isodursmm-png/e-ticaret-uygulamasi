/* ============================================================================
   api/_lib/aracTakip.js  —  arac_takip_sistemi (Petrol Ofisi) proxy — ortak mantık
   ----------------------------------------------------------------------------
   api/yakit.js (canlı, anlık "Çek" butonu) ve api/yakit-sync.js (günlük,
   otomatik kayıt) tarafından ortaklaşa kullanılır. Dosya adı "_lib" ile
   başladığı için Vercel bunu bir route olarak yayınlamaz.
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

/** public.araclar → normalize(plaka) -> { id, plaka, sube, sofor, kullanim } */
async function getAraclarMap(svcSb) {
  const { data, error } = await svcSb.from('araclar').select('id,plaka,sube,sofor,kullanim');
  if (error) throw new Error('araclar okunamadı: ' + error.message);
  const map = new Map();
  for (const a of data || []) if (a.plaka) map.set(norm(a.plaka), a);
  return map;
}

/** arac_takip_sistemi'nin /api/yakitlar'ını çağırır. Zaman aşımında {status:504, retry:true} fırlatır. */
async function fetchYakitRange(base, token, startISO, endISO, timeoutMs = 20000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const fr = await fetch(`${base}/api/yakitlar?start=${startISO}&end=${endISO}`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: ctrl.signal
    });
    if (!fr.ok) {
      const t = await fr.text().catch(() => '');
      const err = new Error(`arac_takip_sistemi ${fr.status}: ${t.slice(0, 300)}`);
      err.status = 502;
      // 502/503/504: Render'ın kendisi upstream (Petrol Ofisi) hatası bildiriyor
      // (ör. {"error":"terminated"} — soket kopması). Genelde geçici, tekrar
      // denemeye değer; 4xx (auth/istek hatası) değerse tekrar denemenin faydası yok.
      if (fr.status >= 500) err.retry = true;
      throw err;
    }
    return await fr.json();
  } catch (e) {
    if (e.name === 'AbortError') {
      const err = new Error('arac_takip_sistemi yanıt vermedi (Render uyanıyor veya Petrol Ofisi yavaş olabilir) — birkaç saniye sonra tekrar deneyin.');
      err.status = 504; err.retry = true;
      throw err;
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

/** ham satışları araclar'daki plakalarla eşleştirip plaka bazında toplar.
    araclar'da olup hiç alım yapmayan plakalar da 0 değerlerle listede kalır. */
function aggregateByPlate(sales, plateMeta) {
  const byPlateMap = new Map();
  const matchedSales = [];
  for (const s of sales || []) {
    const key = norm(s.plaka);
    const meta = plateMeta.get(key);
    if (!meta) continue;
    matchedSales.push(s);
    const agg = byPlateMap.get(key) || {
      id: meta.id, plaka: meta.plaka, sube: meta.sube, sofor: meta.sofor, kullanim: meta.kullanim,
      litre: 0, tutar: 0, islem: 0
    };
    agg.litre += Number(s.litre) || 0;
    agg.tutar += Number(s.tutar) || 0;
    agg.islem += 1;
    byPlateMap.set(key, agg);
  }
  for (const [key, meta] of plateMeta) {
    if (!byPlateMap.has(key)) {
      byPlateMap.set(key, { id: meta.id, plaka: meta.plaka, sube: meta.sube, sofor: meta.sofor, kullanim: meta.kullanim, litre: 0, tutar: 0, islem: 0 });
    }
  }
  return { matchedSales, byPlate: [...byPlateMap.values()].sort((a, b) => b.tutar - a.tutar) };
}

module.exports = { norm, getAracTakipToken, getAraclarMap, fetchYakitRange, aggregateByPlate };
