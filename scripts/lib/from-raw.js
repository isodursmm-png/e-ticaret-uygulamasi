/* ============================================================================
   lib/from-raw.js  —  Supabase public.raw_orders → { t0, t1, ys, ty4, ty5 }
   ----------------------------------------------------------------------------
   Tüm geçmiş arşivini buildPayload'ın beklediği kova biçimine geri çevirir.
   İki ayrı sayfalama stratejisi var — ikisi de sıralama sütunuyla AYNI
   sütunda ilerler, aksi halde Postgres eşleşen satırları bulmak için
   taradığı sütunun tamamını taramak zorunda kalıp zaman aşımına uğrar:
     - sinceISO YOKSA: key'e göre keyset (eski davranış, tüm geçmiş).
     - sinceISO VARSA: order_date'e göre keyset (filtre = sıralama sütunu).
       Aynı order_date değerine sahip satırlar sayfa sınırında tekrar
       gelebileceğinden `seen` ile ayıklanıyor.

   TİCİMAX: raw_orders artık Ticimax verisi TUTMUYOR (public.ticimax'a
   taşındı — bkz. ticimax-tablo-doldur.js/ticimax-tablo-sync.js). Bu yüzden
   t0/t1 kovaları raw_orders'tan DEĞİL, ayrıca public.ticimax tablosundan
   (ham SOAP nesnesi → toRowsInto ile aynı xlsx-şekilli satırlara çevrilerek)
   dolduruluyor — bkz. fetchTicimaxTable.
   ==========================================================================*/
'use strict';
const { toRowsInto } = require('./sources/ticimax');

const BUCKETS = ['t0', 't1', 'ys', 'ty4', 'ty5'];

/** Geçici hatalarda (statement timeout / ağ / 5xx) artan beklemeyle tekrar dener.
    Tablo büyüdükçe tek bir sayfa sorgusu ara sıra DB yükü/timeout'a takılabiliyor —
    tüm okuma (10+ dk) bu yüzden baştan başlamasın diye sayfa bazında dener. */
async function withPageRetry(fn, tries = 4) {
  let last;
  for (let i = 0; i < tries; i++) {
    try { return await fn(); }
    catch (e) {
      last = e;
      const m = String((e && e.message) || e);
      if (i < tries - 1 && /timeout|ETIMEDOUT|ECONNRESET|EAI_AGAIN|fetch failed|socket hang up|network|\b5\d\d\b/i.test(m)) {
        await new Promise((r) => setTimeout(r, 2000 * (i + 1)));
      } else throw e;
    }
  }
  throw last;
}

/**
 * @param sb            supabase client (service_role)
 * @param opts.sinceISO sadece bu tarihten yeni siparişler (order_date >=)
 * @param opts.pageSize  varsayılan 1000
 * @param opts.onProgress fn(toplamSatır)
 * @returns { merged, total, byBucket }
 */
async function fetchMergedFromRaw(sb, { sinceISO = null, pageSize = 1000, onProgress = null } = {}) {
  const merged = { t0: [], t1: [], ys: [], ty4: [], ty5: [] };
  const byBucket = { t0: 0, t1: 0, ys: 0, ty4: 0, ty5: 0 };
  let total = 0;

  const add = (row) => {
    if (merged[row.bucket]) { merged[row.bucket].push(row.data); byBucket[row.bucket]++; }
  };

  if (sinceISO) {
    let cursor = sinceISO;
    let inclusive = true;   // aynı order_date sınırında satır kaçırmamak için ilk turda >=
    const seen = new Set();
    for (;;) {
      const buildQ = () => {
        let q = sb.from('raw_orders')
          .select('key,bucket,data,order_date')
          .order('order_date', { ascending: true })
          .order('key', { ascending: true })
          .limit(pageSize);
        return inclusive ? q.gte('order_date', cursor) : q.gt('order_date', cursor);
      };
      const { data, error } = await withPageRetry(() => buildQ());
      if (error) throw new Error('raw_orders okuma: ' + error.message);
      if (!data || !data.length) break;

      let fresh = 0;
      for (const row of data) {
        if (seen.has(row.key)) continue;
        seen.add(row.key);
        add(row);
        fresh++;
      }
      total += fresh;
      cursor = data[data.length - 1].order_date;
      // Bu sayfada hiç yeni satır gelmediyse (pageSize'dan fazla satır tam aynı
      // order_date'e sahip — pratikte olmaz) sonsuz döngüye düşmemek için sınırı geç.
      inclusive = fresh === 0;
      if (onProgress) onProgress(total);
      if (data.length < pageSize) break;
    }
  } else {
    let lastKey = '';
    for (;;) {
      const buildQ = () => {
        let q = sb.from('raw_orders')
          .select('key,bucket,data,order_date')
          .order('key', { ascending: true })
          .limit(pageSize);
        return lastKey ? q.gt('key', lastKey) : q;
      };
      const { data, error } = await withPageRetry(() => buildQ());
      if (error) throw new Error('raw_orders okuma: ' + error.message);
      if (!data || !data.length) break;

      for (const row of data) add(row);
      total += data.length;
      lastKey = data[data.length - 1].key;
      if (onProgress) onProgress(total);
      if (data.length < pageSize) break;
    }
  }

  const ticimaxCount = await fetchTicimaxTable(sb, { sinceISO, pageSize, merged, byBucket, onProgress: (n) => onProgress && onProgress(total + n) });
  total += ticimaxCount;

  return { merged, total, byBucket };
}

/** public.ticimax (ham SOAP arşivi) → merged.t0/t1'e ekler (toRowsInto ile
    aynı xlsx-şekilli satırlara çevirerek). raw_orders'la aynı sayfalama
    mantığı: sinceISO varsa order_date keyset, yoksa siparis_no (PK) keyset. */
async function fetchTicimaxTable(sb, { sinceISO, pageSize, merged, byBucket, onProgress }) {
  // data (ham SOAP nesnesi) satır başına büyük olabilir (çok kalemli siparişler) —
  // raw_orders'takinden daha küçük sayfa kullan, zaman aşımı riskini azalt.
  pageSize = Math.min(pageSize, 300);
  let written = 0;
  const addOrder = (raw) => {
    const beforeT0 = merged.t0.length, beforeT1 = merged.t1.length;
    toRowsInto([raw], merged.t0, merged.t1);
    byBucket.t0 += merged.t0.length - beforeT0;
    byBucket.t1 += merged.t1.length - beforeT1;
    written++;
  };

  if (sinceISO) {
    let cursor = sinceISO;
    let inclusive = true;
    const seen = new Set();
    for (;;) {
      const buildQ = () => {
        let q = sb.from('ticimax')
          .select('siparis_no,data,order_date')
          .order('order_date', { ascending: true })
          .order('siparis_no', { ascending: true })
          .limit(pageSize);
        return inclusive ? q.gte('order_date', cursor) : q.gt('order_date', cursor);
      };
      const { data, error } = await withPageRetry(() => buildQ());
      if (error) throw new Error('ticimax okuma: ' + error.message);
      if (!data || !data.length) break;

      let fresh = 0;
      for (const row of data) {
        if (seen.has(row.siparis_no)) continue;
        seen.add(row.siparis_no);
        addOrder(row.data);
        fresh++;
      }
      cursor = data[data.length - 1].order_date;
      inclusive = fresh === 0;
      if (onProgress) onProgress(written);
      if (data.length < pageSize) break;
    }
  } else {
    let lastKey = '';
    for (;;) {
      const buildQ = () => {
        let q = sb.from('ticimax')
          .select('siparis_no,data')
          .order('siparis_no', { ascending: true })
          .limit(pageSize);
        return lastKey ? q.gt('siparis_no', lastKey) : q;
      };
      const { data, error } = await withPageRetry(() => buildQ());
      if (error) throw new Error('ticimax okuma: ' + error.message);
      if (!data || !data.length) break;

      for (const row of data) addOrder(row.data);
      lastKey = data[data.length - 1].siparis_no;
      if (onProgress) onProgress(written);
      if (data.length < pageSize) break;
    }
  }
  return written;
}

module.exports = { fetchMergedFromRaw, BUCKETS };
