/* ============================================================================
   backfill-tgo-orders-from-finance.js  —  Trendyol GO sipariş BAŞLIKLARINI
   (ty4) finans/settlements API'sinden yeniden inşa edip raw_orders'taki
   EKSİK olanları doldurur.
   ----------------------------------------------------------------------------
   Neden: Grocery sipariş API'si (packages, modifikasyon-tarihi penceresiyle)
   eski ayları güvenilir dönmüyor — birkaç boş pencerede erken duruyor, bu
   yüzden raw_orders'taki ty4 (sipariş başlığı) sayısı gerçek sipariş
   sayısının çok altında kalıyordu (ty5/kalem satırları ise tam). Finans
   API'si (Cari Hesap Ekstresi) ise TÜM geçmişi güvenilir döndürüyor
   (doğrulandı: 2023-12 → bugün, 150k+ işlem). Sipariş başına "Satış"
   kalemlerinin credit toplamı = Tutar, commissionAmount toplamı = gerçek
   Komisyon (canlı veriyle birebir eşleşti).

   YALNIZCA EKSİK sipariş no'ları yazar — raw_orders'ta zaten var olan ty4
   satırlarına (canlı sipariş API'sinden gelmiş) DOKUNMAZ.

   Kullanım:
     node scripts/backfill-tgo-orders-from-finance.js                    # önizleme
     node scripts/backfill-tgo-orders-from-finance.js --run              # gerçekten yaz
     node scripts/backfill-tgo-orders-from-finance.js --run --from=2025-01
   Sonra:
     node scripts/backfill-tgo-commission.js --run   # (varsa) kalan komisyon boşluklarını doldur
     node scripts/rebuild-from-raw.js
   ==========================================================================*/
'use strict';
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const { fetchOrderFinance } = require('./lib/sources/tgo-api');
const { toRawRows, pushRaw } = require('./lib/raw-store');

function parseArgs(argv) {
  const a = { run: false, from: '2025-01' };
  for (const s of argv) {
    if (s === '--run') a.run = true;
    else if (s.startsWith('--from=')) a.from = s.slice(7).trim();
  }
  return a;
}
const r2 = (n) => Math.round((n || 0) * 100) / 100;

async function main() {
  const { run, from } = parseArgs(process.argv.slice(2));
  const URL = process.env.SUPABASE_URL, KEY = process.env.SUPABASE_SERVICE_ROLE;
  if (!URL || !KEY) throw new Error('.env: SUPABASE_URL ve SUPABASE_SERVICE_ROLE gerekli.');
  const sb = createClient(URL, KEY, { auth: { persistSession: false } });

  const minDate = new Date(from + '-01T00:00:00Z');
  const toDate = Date.now();
  console.log(`Aralık: ${minDate.toISOString().slice(0, 10)} → ${new Date(toDate).toISOString().slice(0, 10)}`);
  console.log(run ? '⚠ GERÇEK YAZMA MODU (--run)' : 'ÖNİZLEME — hiçbir şey yazılmaz (--run ile çalıştırın)');

  console.log('\nTrendyol finans API (Cari Hesap Ekstresi) taranıyor…');
  const t0 = Date.now();
  const finMap = await fetchOrderFinance({ from: minDate.getTime(), to: toDate });
  console.log(`  ${finMap.size} sipariş bulundu (${((Date.now() - t0) / 1000).toFixed(0)}sn)`);
  if (!finMap.size) { console.log('\nVeri bulunamadı — TGO_SELLER_ID/TGO_TOKEN doğrulayın.'); return; }

  // raw_orders'ta ZATEN VAR olan ty4 key'lerini bul (parça parça .in sorgusu).
  console.log('\nraw_orders (ty4) mevcut key taraması…');
  const allNos = [...finMap.keys()];
  const existing = new Set();
  for (let i = 0; i < allNos.length; i += 300) {
    const chunk = allNos.slice(i, i + 300);
    const keys = chunk.map((no) => `trendyol:ty4:${no}`);
    const { data, error } = await sb.from('raw_orders').select('key').in('key', keys);
    if (error) throw new Error(error.message);
    for (const r of data || []) existing.add(r.key);
    process.stdout.write(`  taranan ${Math.min(i + 300, allNos.length)}/${allNos.length}\r`);
  }
  process.stdout.write('\n');

  const missing = allNos.filter((no) => !existing.has(`trendyol:ty4:${no}`));
  console.log(`\nToplam sipariş: ${allNos.length} · zaten var: ${existing.size} · EKSİK (yazılacak): ${missing.length}`);
  if (!missing.length) { console.log('\n✓ Eksik sipariş yok — raw_orders zaten tam.'); return; }

  // Eksik sipariş no'ları için ty4 satırları kur.
  const t4 = missing.map((no) => {
    const r = finMap.get(no);
    const d = r.orderDate ? new Date(r.orderDate) : null;
    return {
      'Sipariş No': no,
      'Mağaza Adı': r.storeName || (r.storeId ? `TGO ${r.storeId}` : 'TGO Market'),
      'Mağaza Adresi': '',
      'Sipariş Tarihi': d && !isNaN(d) ? d.toISOString() : null,
      'Tutar': r2(r.ciro),
      'Komisyon': r2(r.kom),
      'Satıcı Hakediş': 0,
      'Statü': 'Teslim Edildi',
      'Ödeme Yöntemi': 'Online',
      'Müşteri': null
    };
  });

  if (!run) {
    console.log('\nÖrnek (ilk 3):', JSON.stringify(t4.slice(0, 3), null, 1));
    console.log(`\nGerçekten yazmak için:  node scripts/backfill-tgo-orders-from-finance.js --run --from=${from}`);
    return;
  }

  const rows = toRawRows({ ty4: t4 });
  console.log(`\n${rows.length} raw satır yazılıyor…`);
  let written = 0;
  for (let i = 0; i < rows.length; i += 500) {
    written += await pushRaw(sb, rows.slice(i, i + 500));
    process.stdout.write(`  yazılan ${written}/${rows.length}\r`);
  }
  process.stdout.write('\n');
  console.log(`\n✓ Bitti — ${written} eksik sipariş başlığı (ty4) raw_orders'a eklendi.`);
  console.log('Panoyu güncelle:  node scripts/rebuild-from-raw.js');
}

main()
  .then(() => { process.exitCode = 0; })
  .catch((e) => { console.error('\n✕', e.message || e); process.exitCode = 1; })
  .finally(() => { setTimeout(() => process.exit(process.exitCode || 0), 500).unref(); });
