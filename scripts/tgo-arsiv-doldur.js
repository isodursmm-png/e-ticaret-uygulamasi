/* ============================================================================
   tgo-arsiv-doldur.js  —  Trendyol GO finans/settlements API'sinden
   2022-02-02 → 2024-12-31 dönemini public.tgo_arsiv_2022_2024 tablosuna doldurur.
   ----------------------------------------------------------------------------
   raw_orders/analytics_payload'a (canlı pano) DOKUNMAZ — ayrı, salt arşiv
   amaçlı bir tablo. Önce supabase/schema.sql'deki tgo_arsiv_2022_2024 bloğunu
   Supabase SQL Editor'da çalıştırıp tabloyu oluşturun.

   Kullanım:
     node scripts/tgo-arsiv-doldur.js                # önizleme (yazmaz)
     node scripts/tgo-arsiv-doldur.js --run           # gerçekten yazar
   ========================================================================== */
'use strict';
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const { fetchOrderFinance } = require('./lib/sources/tgo-api');

const FROM = new Date('2022-02-02T00:00:00Z').getTime();
const TO = new Date('2025-01-01T00:00:00Z').getTime();
const r2 = (n) => Math.round((n || 0) * 100) / 100;

async function main() {
  const run = process.argv.includes('--run');
  const URL = process.env.SUPABASE_URL, KEY = process.env.SUPABASE_SERVICE_ROLE;
  if (!URL || !KEY) throw new Error('.env: SUPABASE_URL ve SUPABASE_SERVICE_ROLE gerekli.');
  const sb = createClient(URL, KEY, { auth: { persistSession: false } });

  console.log(`Aralık: ${new Date(FROM).toISOString().slice(0, 10)} → ${new Date(TO).toISOString().slice(0, 10)}`);
  console.log(run ? '⚠ GERÇEK YAZMA MODU (--run)' : 'ÖNİZLEME — hiçbir şey yazılmaz (--run ile çalıştırın)');

  console.log('\nTrendyol finans API (Cari Hesap Ekstresi) taranıyor — bu uzun sürebilir…');
  const t0 = Date.now();
  const finMap = await fetchOrderFinance({ from: FROM, to: TO });
  console.log(`\n${finMap.size} sipariş bulundu (${((Date.now() - t0) / 1000 / 60).toFixed(1)} dk)`);
  if (!finMap.size) { console.log('Veri bulunamadı.'); return; }

  const rows = [...finMap.entries()].map(([order_no, r]) => ({
    order_no,
    store_id: r.storeId != null ? String(r.storeId) : null,
    store_name: r.storeName || null,
    order_date: r.orderDate ? new Date(r.orderDate).toISOString() : null,
    tutar: r2(r.ciro),
    komisyon: r2(r.kom)
  }));

  console.log('\nÖrnek (ilk 3):', JSON.stringify(rows.slice(0, 3), null, 1));
  if (!run) {
    console.log('\nGerçekten yazmak için:  node scripts/tgo-arsiv-doldur.js --run');
    return;
  }

  console.log(`\n${rows.length} satır tgo_arsiv_2022_2024'e upsert ediliyor…`);
  let written = 0;
  for (let i = 0; i < rows.length; i += 500) {
    const part = rows.slice(i, i + 500);
    const { error } = await sb.from('tgo_arsiv_2022_2024').upsert(part, { onConflict: 'order_no' });
    if (error) throw new Error('upsert: ' + error.message);
    written += part.length;
    process.stdout.write(`  yazılan ${written}/${rows.length}\r`);
  }
  process.stdout.write('\n');
  console.log(`\n✓ Bitti — ${written} sipariş tgo_arsiv_2022_2024'e yazıldı.`);
}

main()
  .then(() => { process.exitCode = 0; })
  .catch((e) => { console.error('\n✕', e.message || e); process.exitCode = 1; })
  .finally(() => { setTimeout(() => process.exit(process.exitCode || 0), 500).unref(); });
