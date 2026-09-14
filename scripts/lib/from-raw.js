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
   ==========================================================================*/
'use strict';

const BUCKETS = ['t0', 't1', 'ys', 'ty4', 'ty5'];

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
      let q = sb.from('raw_orders')
        .select('key,bucket,data,order_date')
        .order('order_date', { ascending: true })
        .order('key', { ascending: true })
        .limit(pageSize);
      q = inclusive ? q.gte('order_date', cursor) : q.gt('order_date', cursor);

      const { data, error } = await q;
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
      let q = sb.from('raw_orders')
        .select('key,bucket,data,order_date')
        .order('key', { ascending: true })
        .limit(pageSize);
      if (lastKey) q = q.gt('key', lastKey);

      const { data, error } = await q;
      if (error) throw new Error('raw_orders okuma: ' + error.message);
      if (!data || !data.length) break;

      for (const row of data) add(row);
      total += data.length;
      lastKey = data[data.length - 1].key;
      if (onProgress) onProgress(total);
      if (data.length < pageSize) break;
    }
  }

  return { merged, total, byBucket };
}

module.exports = { fetchMergedFromRaw, BUCKETS };
