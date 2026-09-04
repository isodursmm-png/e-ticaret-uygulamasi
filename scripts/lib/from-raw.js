/* ============================================================================
   lib/from-raw.js  —  Supabase public.raw_orders → { t0, t1, ys, ty4, ty5 }
   ----------------------------------------------------------------------------
   Tüm geçmiş arşivini buildPayload'ın beklediği kova biçimine geri çevirir.
   Keyset sayfalama (key > lastKey) — milyonlarca satırda bile hızlı.
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
  let lastKey = '';
  let total = 0;

  for (;;) {
    let q = sb.from('raw_orders')
      .select('key,bucket,data,order_date')
      .order('key', { ascending: true })
      .limit(pageSize);
    if (lastKey) q = q.gt('key', lastKey);
    if (sinceISO) q = q.gte('order_date', sinceISO);

    const { data, error } = await q;
    if (error) throw new Error('raw_orders okuma: ' + error.message);
    if (!data || !data.length) break;

    for (const row of data) {
      if (merged[row.bucket]) { merged[row.bucket].push(row.data); byBucket[row.bucket]++; }
    }
    total += data.length;
    lastKey = data[data.length - 1].key;
    if (onProgress) onProgress(total);

    if (data.length < pageSize) break;   // kısa sayfa = son sayfa
  }

  return { merged, total, byBucket };
}

module.exports = { fetchMergedFromRaw, BUCKETS };
