/* ============================================================================
   tgo-urun-arsiv-doldur.js  —  Trendyol GO finans/settlements API'sinden
   2022-02-02 → 2024-12-31 dönemini BARKOD bazlı (ham, aggregate edilmemiş)
   olarak public.tgo_urun_arsiv_2022_2024 tablosuna doldurur.
   ----------------------------------------------------------------------------
   raw_orders/analytics_payload'a (canlı pano) DOKUNMAZ. Önce
   supabase/schema.sql'deki tgo_urun_arsiv_2022_2024 bloğunu Supabase
   SQL Editor'da çalıştırıp tabloyu oluşturun.

   429 (rate limit) tecrübesi: tgo-arsiv-doldur.js aralıksız 76 pencereyi
   art arda çekince sık 429 yiyip veri kaybetmişti (bkz. tgo-arsiv-
   eksik-doldur.js). Bunu baştan önlemek için burada 14 günlük pencereler
   TEK TEK, aralarında birkaç saniye bekleyerek çekiliyor.

   Kullanım:
     node scripts/tgo-urun-arsiv-doldur.js --run
   ========================================================================== */
'use strict';
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const { fetchSettlementLines } = require('./lib/sources/tgo-api');

const FROM = new Date('2022-02-02T00:00:00Z').getTime();
const TO = new Date('2025-01-01T00:00:00Z').getTime();
const WIN = 14 * 86400e3;
const r2 = (n) => Math.round((n || 0) * 100) / 100;
const sleep = (ms) => new Promise((res) => setTimeout(res, ms));

function buildWindows() {
  const out = [];
  let end = TO;
  while (end > FROM) {
    const start = Math.max(end - WIN, FROM);
    out.push([start, end]);
    end = start;
  }
  return out.reverse();
}

async function main() {
  const run = process.argv.includes('--run');
  const URL = process.env.SUPABASE_URL, KEY = process.env.SUPABASE_SERVICE_ROLE;
  if (!URL || !KEY) throw new Error('.env: SUPABASE_URL ve SUPABASE_SERVICE_ROLE gerekli.');
  const sb = createClient(URL, KEY, { auth: { persistSession: false } });

  const windows = buildWindows();
  console.log(`Aralık: ${new Date(FROM).toISOString().slice(0, 10)} → ${new Date(TO).toISOString().slice(0, 10)} (${windows.length} pencere, aralarda 4sn bekleme)`);
  console.log(run ? '⚠ GERÇEK YAZMA MODU (--run)' : 'ÖNİZLEME — yazılmayacak (--run ile çalıştırın)');

  let totalFound = 0, totalWritten = 0;
  const failed = [];

  for (let i = 0; i < windows.length; i++) {
    const [from, to] = windows[i];
    const iso = (t) => new Date(t).toISOString().slice(0, 10);
    process.stdout.write(`[${i + 1}/${windows.length}] ${iso(from)} → ${iso(to)} … `);
    let lines;
    try {
      lines = await fetchSettlementLines({ from, to });
    } catch (e) {
      console.log(`HATA: ${e.message}`);
      failed.push([from, to]);
      await sleep(8000);
      continue;
    }
    totalFound += lines.length;
    console.log(`${lines.length} satır`);

    if (run && lines.length) {
      const rows = lines
        .filter((t) => t && t.id != null)
        .map((t) => ({
          settlement_id: String(t.id),
          order_no: t.orderNumber != null ? String(t.orderNumber) : null,
          barcode: t.barcode || null,
          store_id: t.storeId != null ? String(t.storeId) : null,
          store_name: t.storeName || null,
          order_date: t.orderDate ? new Date(Number(t.orderDate) || t.orderDate).toISOString() : null,
          tutar: r2(t.credit),
          komisyon: r2(t.commissionAmount)
        }));
      for (let j = 0; j < rows.length; j += 500) {
        const part = rows.slice(j, j + 500);
        const { error } = await sb.from('tgo_urun_arsiv_2022_2024').upsert(part, { onConflict: 'settlement_id' });
        if (error) throw new Error('upsert: ' + error.message);
        totalWritten += part.length;
      }
    }
    await sleep(4000);
  }

  console.log(`\nToplam bulunan: ${totalFound} satır.`);
  if (run) console.log(`Toplam yazılan: ${totalWritten} satır.`);
  else console.log('Gerçekten yazmak için: node scripts/tgo-urun-arsiv-doldur.js --run');
  if (failed.length) {
    console.log(`\n⚠ ${failed.length} pencere hata verdi (tekrar denenmeli):`);
    failed.forEach(([f, t]) => console.log('  ', new Date(f).toISOString().slice(0, 10), '->', new Date(t).toISOString().slice(0, 10)));
  }
}

main()
  .then(() => { process.exitCode = 0; })
  .catch((e) => { console.error('\n✕', e.message || e); process.exitCode = 1; })
  .finally(() => { setTimeout(() => process.exit(process.exitCode || 0), 500).unref(); });
