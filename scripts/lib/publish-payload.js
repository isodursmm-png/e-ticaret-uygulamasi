/* ============================================================================
   lib/publish-payload.js  —  raw_orders (tüm geçmiş) → analytics_payload (parçalı)
   ----------------------------------------------------------------------------
   Pano payload'ını ham arşivin TAMAMINDAN kurar, gzip'leyip ~3 MB'lık base64
   parçalara böler ve analytics_payload'a birden çok satır olarak yazar:
     id='eticaret'      → { data:{__chunks:N}, geo, meta }
     id='eticaret~p0..' → { data:{__part:'<b64>'} }
   Tek satır/istek ~5 MB Supabase sınırını böyle aşarız. boot.js parçaları
   sırayla birleştirip gunzip eder.
   ==========================================================================*/
'use strict';
const { buildPayload, packChunks, packData } = require('./normalize');
const { fetchMergedFromRaw } = require('./from-raw');

const MAIN_ID = 'eticaret';
const CHUNK = 3_000_000;

async function writeRows(sb, chunks, geo, meta) {
  for (let i = 0; i < chunks.length; i++) {
    const { error } = await sb.from('analytics_payload')
      .upsert({ id: `${MAIN_ID}~p${i}`, data: { __part: chunks[i] }, updated_at: new Date().toISOString() });
    if (error) throw new Error(`parça ${i}: ${error.message}`);
  }
  const { error } = await sb.from('analytics_payload')
    .upsert({ id: MAIN_ID, data: { __chunks: chunks.length }, geo, meta, updated_at: new Date().toISOString() });
  if (error) throw new Error('ana satır: ' + error.message);
  // artık kullanılmayan eski parçaları temizle
  const { data: ex } = await sb.from('analytics_payload').select('id').like('id', `${MAIN_ID}~p%`);
  const keep = new Set(chunks.map((_, i) => `${MAIN_ID}~p${i}`));
  const stale = (ex || []).map((r) => r.id).filter((id) => !keep.has(id));
  if (stale.length) await sb.from('analytics_payload').delete().in('id', stale);
  return stale.length;
}

/** raw_orders'tan tüm-geçmiş payload'ı kur ve yaz.
    @param fallbackP  raw_orders boşsa yazılacak canlı payload (opsiyonel) */
async function publishFromRaw(sb, { geo = null, sinceISO = null, fallbackP = null, log = () => {} } = {}) {
  const { merged, total, byBucket } = await fetchMergedFromRaw(sb, { sinceISO });
  log(`raw_orders: ${total} satır (${Object.entries(byBucket).map(([k, v]) => k + ':' + v).join(' ')})`);

  if (!total) {
    if (!fallbackP) throw new Error('raw_orders boş ve fallback payload yok.');
    log('raw_orders boş — canlı payload tek satır yazılıyor (fallback).');
    const { error } = await sb.from('analytics_payload')
      .upsert({ id: MAIN_ID, data: packData(fallbackP), geo, meta: fallbackP.meta, updated_at: new Date().toISOString() });
    if (error) throw new Error('fallback upsert: ' + error.message);
    return { meta: fallbackP.meta, chunks: 1, total: 0, fallback: true };
  }

  const P = buildPayload(merged, { itmMonthly: true });
  P.meta.itmRes = 'monthly';
  P.meta.source = 'raw_orders';
  const pk = packChunks(P, CHUNK);
  log(`payload: ${(pk.bytes / 1048576).toFixed(1)} MB → gzip ${(pk.gz / 1048576).toFixed(2)} MB → ${pk.chunks.length} parça`);
  const removed = await writeRows(sb, pk.chunks, geo, P.meta);
  return { meta: P.meta, chunks: pk.chunks.length, total, byBucket, removed };
}

/** Aylık TÜİK TÜFE'yi (gıda sektörü, EVDS_API_KEY'le otomatik; yoksa genel
    yedek) ayrı bir satıra yaz: id='tufe' → { data:{ monthly, series, food, updated } }.
    boot.js bunu okuyup window.__TUFE__ yapar; FİNAL segmenti "Enf. %" sütununda kullanır.
    Hatalar yutulur — pano kurulumunu bloklamaz. */
async function publishTufe(sb, log = () => {}) {
  try {
    const { monthlyTufe } = require('./tufe');
    const { monthly, series, food } = await monthlyTufe();
    const n = Object.keys(monthly).length;
    if (!n) return { ok: false, months: 0 };
    const { error } = await sb.from('analytics_payload')
      .upsert({ id: 'tufe', data: { monthly, series, food, updated: new Date().toISOString() }, updated_at: new Date().toISOString() });
    if (error) throw new Error(error.message);
    log(`TÜFE tablosu yazıldı — ${n} ay (${food ? 'gıda sektörü, seri ' + series : 'genel TÜFE — yedek'})`);
    return { ok: true, months: n, food };
  } catch (e) {
    log('TÜFE yazılamadı: ' + (e.message || e));
    return { ok: false, error: String(e.message || e) };
  }
}

module.exports = { publishFromRaw, publishTufe, MAIN_ID };
