'use strict';
/* ============================================================================
   tufe.js — Aylık TÜİK TÜFE (Tüketici Fiyat Endeksi), bir önceki aya göre %.
   Panodaki FİNAL segmenti "Enf. %" sütunu bunu kullanır.

   Otomatik güncelleme: TCMB EVDS servisi (seri TP.FG.J0 = TÜFE Genel endeks),
   aylara göre çekilip ay-üstü-ay yüzde değişim hesaplanır.
     - ENV: EVDS_API_KEY  (ücretsiz: https://evds2.tcmb.tr → Profil → API Anahtarı)
     - Anahtar yoksa yalnızca aşağıdaki gömülü tablo kullanılır.
   Gömülü tablo (fallback) resmî TÜİK aylık oranlarıdır; EVDS'den gelen değer
   varsa onun üzerine yazılır.
   ========================================================================== */

const EMBED = {
  '2023-12': 2.93,
  '2024-01': 6.70, '2024-02': 4.53, '2024-03': 3.16, '2024-04': 3.18,
  '2024-05': 3.37, '2024-06': 1.64, '2024-07': 3.23, '2024-08': 2.47,
  '2024-09': 2.97, '2024-10': 2.88, '2024-11': 2.24, '2024-12': 1.03,
  '2025-01': 5.03, '2025-02': 2.27, '2025-03': 2.46, '2025-04': 3.00,
  '2025-05': 1.53, '2025-06': 1.37, '2025-07': 2.06, '2025-08': 2.04,
  '2025-09': 3.23
  // 2025-10 ve sonrası: EVDS_API_KEY ile otomatik gelir
};

function ymKey(t) {
  // EVDS "Tarih" alanı aylık seride "YYYY-M" ya da "YYYY-MM"
  const m = String(t).match(/(\d{4})-(\d{1,2})/);
  return m ? `${m[1]}-${m[2].padStart(2, '0')}` : null;
}

async function fetchEvds() {
  const key = (process.env.EVDS_API_KEY || '').trim();
  if (!key) return {};

  const now = new Date();
  const end = `${String(now.getDate()).padStart(2, '0')}-${String(now.getMonth() + 1).padStart(2, '0')}-${now.getFullYear()}`;
  const url = `https://evds2.tcmb.gov.tr/service/evds/series=TP.FG.J0&startDate=01-01-2023&endDate=${end}&type=json&frequency=5`;

  const r = await fetch(url, { headers: { key, 'Accept': 'application/json' } });
  if (!r.ok) throw new Error(`EVDS HTTP ${r.status}`);
  const j = await r.json();
  const items = Array.isArray(j && j.items) ? j.items : [];

  // endeks değerlerini ay sırasına diz
  const idx = [];
  for (const row of items) {
    const ym = ymKey(row.Tarih || row.tarih);
    // alan adı genelde TP_FG_J0; sürüme göre değişebilir → TP_FG_J0 ile başlayan ilk sayısal alan
    let val = row.TP_FG_J0;
    if (val == null) {
      const k = Object.keys(row).find(k => /^TP_FG_J0/i.test(k));
      if (k) val = row[k];
    }
    const num = parseFloat(val);
    if (ym && isFinite(num)) idx.push([ym, num]);
  }
  idx.sort((a, b) => (a[0] < b[0] ? -1 : 1));

  const out = {};
  for (let i = 1; i < idx.length; i++) {
    const pct = (idx[i][1] / idx[i - 1][1] - 1) * 100;
    if (isFinite(pct)) out[idx[i][0]] = Math.round(pct * 100) / 100;
  }
  return out;
}

/** { 'YYYY-MM': aylıkYüzde, ... } — gömülü tablo + (varsa) EVDS. */
async function monthlyTufe() {
  let evds = {};
  try {
    evds = await fetchEvds();
  } catch (e) {
    console.warn('  TÜFE/EVDS atlandı:', e.message);
  }
  return { ...EMBED, ...evds };
}

module.exports = { monthlyTufe, EMBED };
