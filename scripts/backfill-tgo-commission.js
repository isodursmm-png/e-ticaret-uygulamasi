/* ============================================================================
   backfill-tgo-commission.js  —  Trendyol GO siparişlerinin GERÇEK komisyonunu
   (Cari Hesap Ekstresi / finans API) raw_orders'taki mevcut ty4 satırlarına
   TEK SEFERLİK işler.
   ----------------------------------------------------------------------------
   Canlı `topla.js` koşusu (tgo-api.js) yalnız son TGO_KOMISYON_DAYS (varsayılan
   60) gün için gerçek komisyonu çeker — tüm geçmişi her saat taramak çok
   pahalı olurdu. Bu betik, raw_orders'ta zaten duran (Komisyon=0 ile gelmiş)
   ESKİ Trendyol siparişlerini bir kez düzeltir.

   Kullanım:
     node scripts/backfill-tgo-commission.js                # önizleme (yazmaz)
     node scripts/backfill-tgo-commission.js --run           # gerçekten yaz
     node scripts/backfill-tgo-commission.js --run --from=2024-01
   Sonra:
     node scripts/rebuild-from-raw.js
   ==========================================================================*/
'use strict';
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const { fetchCommissions } = require('./lib/sources/tgo-api');

function parseArgs(argv) {
  const a = { run: false, from: null };
  for (const s of argv) {
    if (s === '--run') a.run = true;
    else if (s.startsWith('--from=')) a.from = s.slice(7).trim();
  }
  return a;
}

async function main() {
  const { run, from } = parseArgs(process.argv.slice(2));
  const URL = process.env.SUPABASE_URL, KEY = process.env.SUPABASE_SERVICE_ROLE;
  if (!URL || !KEY) throw new Error('.env: SUPABASE_URL ve SUPABASE_SERVICE_ROLE gerekli.');
  const sb = createClient(URL, KEY, { auth: { persistSession: false } });

  // 1) Aralık başlangıcı. "bucket" kolonunda indeks yok — min(order_date) için
  //    tüm tabloyu tarayıp timeout'a girer. Bilinen arşiv başlangıcı Aralık
  //    2023'tür (bkz. rebuild-from-raw.js önceki çıktıları); --from ile ezilebilir.
  const minDate = from ? new Date(from + '-01T00:00:00Z') : new Date('2023-12-01T00:00:00Z');
  const toDate = Date.now();

  console.log(`Aralık: ${minDate.toISOString().slice(0, 10)} → ${new Date(toDate).toISOString().slice(0, 10)}`);
  console.log(run ? '⚠ GERÇEK YAZMA MODU (--run)' : 'ÖNİZLEME — hiçbir şey yazılmaz (--run ile çalıştırın)');

  // 2) Trendyol finans API'sinden tüm aralık için orderNumber -> komisyon.
  console.log('\nTrendyol finans API (Cari Hesap Ekstresi) taranıyor…');
  const t0 = Date.now();
  const komMap = await fetchCommissions({ from: minDate.getTime(), to: toDate });
  console.log(`  ${komMap.size} sipariş için komisyon bulundu (${((Date.now() - t0) / 1000).toFixed(0)}sn)`);
  if (!komMap.size) { console.log('\nKomisyon verisi bulunamadı — TGO_SELLER_ID/TGO_TOKEN doğrulayın.'); return; }

  // 3) raw_orders'ta bu sipariş no'lara ait ty4 satırlarını DOĞRUDAN key ile
  //    (trendyol:ty4:<no>) parça parça çek — "bucket" kolonunda indeks
  //    gerektirmez, primary key (key) üzerinden her zaman hızlıdır.
  console.log('\nraw_orders (ty4) key bazında eşleştiriliyor…');
  const orderNos = [...komMap.keys()];
  let scanned = 0, matched = 0, changed = 0;
  const pending = [];

  async function flush() {
    if (!pending.length) return;
    if (run) {
      const { error } = await sb.from('raw_orders').upsert(pending, { onConflict: 'key', ignoreDuplicates: false });
      if (error) throw new Error('raw_orders upsert: ' + error.message);
    }
    changed += pending.length;
    pending.length = 0;
  }

  for (let i = 0; i < orderNos.length; i += 300) {
    const chunk = orderNos.slice(i, i + 300);
    const keys = chunk.map((no) => `trendyol:ty4:${no}`);
    const { data, error } = await sb.from('raw_orders').select('key,data').in('key', keys);
    if (error) throw new Error(error.message);
    scanned += chunk.length;
    for (const row of data || []) {
      const orderNo = String((row.data && row.data['Sipariş No']) || '').trim();
      const v = orderNo && komMap.get(orderNo);
      if (v == null) continue;
      matched++;
      const cur = Number(row.data['Komisyon']) || 0;
      const real = Math.round(v * 100) / 100;
      if (Math.abs(cur - real) < 0.01) continue;   // zaten doğru
      pending.push({ key: row.key, data: { ...row.data, Komisyon: real }, updated_at: new Date().toISOString() });
    }
    if (pending.length >= 300) await flush();
    process.stdout.write(`  denenen sipariş no ${scanned}/${orderNos.length} · bulunan+eşleşen ${matched} · güncellenecek ${changed + pending.length}\r`);
  }
  await flush();
  process.stdout.write('\n');

  console.log(`\n✓ Bitti — ${orderNos.length} sipariş no denendi (finans API), ${matched} tanesi raw_orders'ta bulundu, ` +
    `${changed} satır ${run ? 'güncellendi' : 'güncellenecekti'}.`);
  if (run) console.log('Panoyu güncelle:  node scripts/rebuild-from-raw.js');
  else console.log('Gerçekten yazmak için:  node scripts/backfill-tgo-commission.js --run' + (from ? ` --from=${from}` : ''));
}

main()
  .then(() => { process.exitCode = 0; })
  .catch((e) => { console.error('\n✕', e.message || e); process.exitCode = 1; })
  .finally(() => { setTimeout(() => process.exit(process.exitCode || 0), 500).unref(); });
