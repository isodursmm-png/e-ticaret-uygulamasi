'use strict';
/* ============================================================================
   tufe.js — Aylık TÜİK TÜFE, GIDA VE ALKOLSÜZ İÇECEKLER alt endeksi, bir
   önceki aya göre %. Panodaki FİNAL segmenti "Enf. %" sütunu bunu kullanır.

   Otomatik güncelleme: TCMB EVDS servisi.
     - ENV: EVDS_API_KEY        (ücretsiz: https://evds2.tcmb.gov.tr → Profil → API Anahtarı)
     - ENV: EVDS_TUFE_SERIES    (ops.) gıda alt-endeks seri kodunu geçersiz kılar.
       Varsayılan TP.FG.J1 — TÜFE "Genel" (TP.FG.J0) ile aynı aileden, COICOP
       ana harcama gruplarının 1.si (Gıda ve alkolsüz içecekler). Bu kodu API
       erişimi olmadan tam doğrulayamadık: sonuç mantıksız çıkarsa (çok az
       nokta / aşırı uç değerler) otomatik olarak TÜFE Genel'e (TP.FG.J0)
       düşülür — workflow log'unda hangi serinin kullanıldığı yazar.
     - Anahtar yoksa (ya da EVDS erişilemezse) EMBED_FOOD (aşağıda) kullanılır
       — TÜİK'in resmi aylık bültenlerinden ELLE girilmiş gerçek gıda
       enflasyonu (kaynak: alomaliye.com / TÜİK basın bültenleri). Yeni ay
       çıktıkça buraya eklenmeli, ya da EVDS_API_KEY eklenip otomatikleştirilmeli.
   ========================================================================== */

const FOOD_SERIES_DEFAULT = 'TP.FG.J1';   // Gıda ve alkolsüz içecekler (en iyi tahmin)
const GENEL_SERIES = 'TP.FG.J0';          // TÜFE Genel — doğrulanmış, yedek

/* GIDA ve alkolsüz içecekler — TÜİK resmi aylık bültenlerinden elle girildi
   (2026-09-14 itibarıyla). Anahtarsız/EVDS'siz kullanılan ASIL tablo budur. */
const EMBED_FOOD = {
  '2025-10': 3.41, '2025-11': -0.69, '2025-12': 1.99,
  '2026-01': 6.59, '2026-02': 6.89, '2026-03': 1.80, '2026-04': 3.70,
  '2026-05': -0.48, '2026-06': 0.17, '2026-07': 1.61, '2026-08': 0.22
  // 2026-09 ve sonrası: ay kapanınca buraya ekleyin, ya da EVDS_API_KEY girin.
};

/* TÜFE Genel (gıda değil) — yalnız EVDS "genel" yedek yolu başarılı olur da
   gıda serisi başarısız olursa, eski ayları doldurmak için kullanılır. */
const EMBED_GENEL = {
  '2023-12': 2.93,
  '2024-01': 6.70, '2024-02': 4.53, '2024-03': 3.16, '2024-04': 3.18,
  '2024-05': 3.37, '2024-06': 1.64, '2024-07': 3.23, '2024-08': 2.47,
  '2024-09': 2.97, '2024-10': 2.88, '2024-11': 2.24, '2024-12': 1.03,
  '2025-01': 5.03, '2025-02': 2.27, '2025-03': 2.46, '2025-04': 3.00,
  '2025-05': 1.53, '2025-06': 1.37, '2025-07': 2.06, '2025-08': 2.04,
  '2025-09': 3.23
};

function ymKey(t) {
  // EVDS "Tarih" alanı aylık seride "YYYY-M" ya da "YYYY-MM"
  const m = String(t).match(/(\d{4})-(\d{1,2})/);
  return m ? `${m[1]}-${m[2].padStart(2, '0')}` : null;
}

/** Bir EVDS seri kodunun ay-üstü-ay % değişimini çeker. */
async function fetchEvdsSeries(series, key) {
  const now = new Date();
  const end = `${String(now.getDate()).padStart(2, '0')}-${String(now.getMonth() + 1).padStart(2, '0')}-${now.getFullYear()}`;
  const url = `https://evds2.tcmb.gov.tr/service/evds/series=${encodeURIComponent(series)}&startDate=01-01-2023&endDate=${end}&type=json&frequency=5`;

  const r = await fetch(url, { headers: { key, 'Accept': 'application/json' } });
  if (!r.ok) throw new Error(`EVDS HTTP ${r.status} (${series})`);
  const j = await r.json();
  const items = Array.isArray(j && j.items) ? j.items : [];

  // endeks değerlerini ay sırasına diz
  const fieldRe = new RegExp('^' + series.replace(/\./g, '_') + '$', 'i');
  const idx = [];
  for (const row of items) {
    const ym = ymKey(row.Tarih || row.tarih);
    let val = Object.keys(row).find((k) => fieldRe.test(k));
    val = val != null ? row[val] : undefined;
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

/** Sonuç mantıklı mı? (yeterli ay + makul aralık) — yanlış/boş seri kodunu ele. */
function isSane(monthly) {
  const vals = Object.values(monthly);
  if (vals.length < 6) return false;
  return vals.every((v) => v > -20 && v < 50);
}

/** { monthly:{ 'YYYY-MM': aylıkYüzde }, series, food } */
async function monthlyTufe() {
  const key = (process.env.EVDS_API_KEY || '').trim();
  if (!key) {
    console.warn(`  TÜFE: EVDS_API_KEY yok — elle girilmiş gıda tablosu kullanılıyor (${Object.keys(EMBED_FOOD).length} ay).`);
    return { monthly: EMBED_FOOD, series: 'embed-food', food: true };
  }

  const foodSeries = (process.env.EVDS_TUFE_SERIES || FOOD_SERIES_DEFAULT).trim();
  try {
    const food = await fetchEvdsSeries(foodSeries, key);
    if (isSane(food)) {
      const merged = { ...EMBED_FOOD, ...food };
      console.log(`  TÜFE: ${foodSeries} (gıda) — ${Object.keys(merged).length} ay`);
      return { monthly: merged, series: foodSeries, food: true };
    }
    console.warn(`  TÜFE: ${foodSeries} verisi güvenilir görünmüyor (az/uç değer) — TÜFE Genel'e düşülüyor.`);
  } catch (e) {
    console.warn(`  TÜFE: ${foodSeries} alınamadı (${e.message}) — TÜFE Genel'e düşülüyor.`);
  }

  try {
    const genel = await fetchEvdsSeries(GENEL_SERIES, key);
    if (isSane(genel)) {
      console.log(`  TÜFE: ${GENEL_SERIES} (genel, yedek) — ${Object.keys(genel).length} ay`);
      return { monthly: { ...EMBED_GENEL, ...genel }, series: GENEL_SERIES, food: false };
    }
  } catch (e) {
    console.warn('  TÜFE: genel seri de alınamadı:', e.message);
  }

  console.warn('  TÜFE: EVDS tamamen başarısız — elle girilmiş gıda tablosuna düşülüyor.');
  return { monthly: EMBED_FOOD, series: 'embed-food', food: true };
}

module.exports = { monthlyTufe, EMBED_FOOD, EMBED_GENEL, FOOD_SERIES_DEFAULT, GENEL_SERIES };
