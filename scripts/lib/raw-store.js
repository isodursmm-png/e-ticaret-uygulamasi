/* ============================================================================
   lib/raw-store.js  —  ham satış arşivi (Supabase: public.raw_orders)
   ----------------------------------------------------------------------------
   analytics_payload her koşuda ezilir; raw_orders BİRİKİR. topla.js her
   çalıştığında kaynaklardan gelen ham satırları `key` üzerinden upsert eder:
   yeni kayıt INSERT, daha önce görülen UPDATE (first_seen sabit kalır).

   `merged` = { t0, t1, ys, ty4, ty5 }  (bkz. normalize.js)
   ==========================================================================*/
'use strict';
const { parseAny } = require('./normalize');

/* Her kova için: kaynak/kanal, satır düzeyi, sipariş no kolonu, tarih kolon(lar)ı. */
const BUCKETS = {
  t1:  { source: 'ticimax',     channel: 'Ticimax',     level: 'order', no: 'Sipariş No',       date: ['Siparis Tarihi'] },
  t0:  { source: 'ticimax',     channel: 'Ticimax',     level: 'item',  no: 'Sipariş No',       date: ['Siparis Tarihi'] },
  ys:  { source: 'yemeksepeti', channel: 'Yemeksepeti', level: 'order', no: 'Sipariş No',       date: ['Kabul Edilme Zamanı', 'Siparişin Alındığı Tarih'] },
  ty4: { source: 'trendyol',    channel: 'Trendyol',    level: 'order', no: 'Sipariş No',       date: ['Sipariş Tarihi'] },
  ty5: { source: 'trendyol',    channel: 'Trendyol',    level: 'item',  no: 'Sipariş Numarası', date: ['Sipariş Tarihi'] }
};

/** merged → raw_orders satırları. Kalem düzeyinde anahtar, sipariş içi sıradır
    (kaynaklar tüm pencereyi yeniden çektiği için koşular arası kararlı/idempotent). */
function toRawRows(merged = {}) {
  const now = new Date().toISOString();
  const byKey = new Map();       // key -> satır (tek upsert'te key tekrarı yasak)
  for (const [bucket, cfg] of Object.entries(BUCKETS)) {
    const list = Array.isArray(merged[bucket]) ? merged[bucket] : [];
    const lineIdx = new Map();   // sipariş no -> sıradaki kalem indexi
    for (const r of list) {
      const orderNo = String(r[cfg.no] == null ? '' : r[cfg.no]).trim();
      if (!orderNo) continue;

      let dt = null;
      for (const f of cfg.date) { if (!dt) dt = parseAny(r[f]); }

      let key;
      if (cfg.level === 'item') {
        const i = lineIdx.get(orderNo) || 0;
        lineIdx.set(orderNo, i + 1);
        key = `${cfg.source}:${bucket}:${orderNo}:${i}`;
      } else {
        key = `${cfg.source}:${bucket}:${orderNo}`;
      }
      // Aynı key tekrar geldiyse (ör. Yemeksepeti aynı siparişi birden çok
      // şubeden döndürüyor) sonek ekle — veri kaybetme, ama tek upsert
      // deyiminde çakışma da olmasın.
      while (byKey.has(key)) key += '~';

      byKey.set(key, {
        key,
        source: cfg.source,
        bucket,
        level: cfg.level,
        order_no: orderNo,
        order_date: dt ? dt.toISOString() : null,
        channel: cfg.channel,
        data: r,
        updated_at: now
      });
    }
  }
  return [...byKey.values()];
}

/** Trendyol Sipariş API'si komisyonu sipariş bazında vermez (ty4.Komisyon=0
    gelir) — bu yüzden panelden elle yüklenen "Komisyon Listesi" xlsx'iyle
    (import-xlsx-raw.js) doldurulmuş gerçek komisyonu korur: gelen satır 0/boş
    ve DB'de zaten >0 bir değer kayıtlıysa, üzerine yazmak yerine onu tutar.
    Aksi halde her saatlik canlı senkron, elle girilen komisyonu sıfırlardı. */
async function preserveKnownCommission(sb, rows) {
  const cand = rows.filter((r) => r.bucket === 'ty4' && !(Number(r.data && r.data['Komisyon']) > 0));
  if (!cand.length) return;
  for (let i = 0; i < cand.length; i += 200) {
    const slice = cand.slice(i, i + 200);
    const { data: ex } = await sb.from('raw_orders').select('key, data').in('key', slice.map((r) => r.key));
    const byKey = new Map((ex || []).map((r) => [r.key, r.data]));
    for (const r of slice) {
      const oldKom = Number((byKey.get(r.key) || {})['Komisyon']);
      if (oldKom > 0) r.data['Komisyon'] = oldKom;
    }
  }
}

/** raw_orders'a parça parça upsert (onConflict: key). first_seen'e dokunmaz. */
async function pushRaw(sb, rows, { chunk = 500 } = {}) {
  await preserveKnownCommission(sb, rows);
  let n = 0;
  for (let i = 0; i < rows.length; i += chunk) {
    const part = rows.slice(i, i + chunk);
    const { error } = await sb
      .from('raw_orders')
      .upsert(part, { onConflict: 'key', ignoreDuplicates: false });
    if (error) throw new Error('raw_orders upsert: ' + error.message);
    n += part.length;
  }
  return n;
}

module.exports = { toRawRows, pushRaw, BUCKETS };
