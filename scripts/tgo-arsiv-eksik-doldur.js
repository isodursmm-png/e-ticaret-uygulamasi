/* ============================================================================
   tgo-arsiv-eksik-doldur.js  —  tgo-arsiv-doldur.js sırasında HTTP 429 (rate
   limit) yüzünden boş/eksik kalan belirli pencereleri TEK TEK, aralarda
   bekleyerek yeniden çeker ve public.tgo_arsiv_2022_2024'e upsert eder.
   ----------------------------------------------------------------------------
   order_no unique olduğundan upsert güvenli — zaten yazılmış satırlara
   dokunmaz, yalnızca eksikleri tamamlar/tazeler.

   Kullanım:
     node scripts/tgo-arsiv-eksik-doldur.js --run
   ========================================================================== */
'use strict';
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const { fetchOrderFinance } = require('./lib/sources/tgo-api');

// tgo-arsiv-doldur.js loglarında HTTP 429 sonrası 0/kısmi kalan pencereler.
const WINDOWS = [
  ['2024-05-22', '2024-06-05'], ['2024-05-08', '2024-05-22'], ['2024-04-24', '2024-05-08'],
  ['2024-01-17', '2024-01-31'], ['2024-01-03', '2024-01-17'], ['2023-12-20', '2024-01-03'],
  ['2023-09-27', '2023-10-11'], ['2023-09-13', '2023-09-27'], ['2023-07-05', '2023-07-19'],
  ['2023-06-21', '2023-07-05'], ['2023-03-29', '2023-04-12'], ['2023-03-15', '2023-03-29'],
  ['2023-01-04', '2023-01-18'], ['2022-10-12', '2022-10-26'], ['2022-09-28', '2022-10-12'],
  ['2022-09-14', '2022-09-28'], ['2022-07-20', '2022-08-03'], ['2022-05-25', '2022-06-08'],
  ['2022-05-11', '2022-05-25'], ['2022-04-27', '2022-05-11'], ['2022-03-02', '2022-03-16'],
  ['2022-02-16', '2022-03-02'], ['2022-02-02', '2022-02-16'],
  // kısmen eksik (yalnız ilk sayfalar geldi) — tam pencereyi tazele
  ['2024-06-05', '2024-06-19'], ['2023-10-11', '2023-10-25'], ['2023-07-19', '2023-08-02'],
  ['2023-04-12', '2023-04-26'], ['2023-01-18', '2023-02-01'], ['2022-10-26', '2022-11-09'],
  ['2022-08-03', '2022-08-17'], ['2022-06-08', '2022-06-22'], ['2022-03-16', '2022-03-30']
];

const r2 = (n) => Math.round((n || 0) * 100) / 100;
const sleep = (ms) => new Promise((res) => setTimeout(res, ms));

async function main() {
  const run = process.argv.includes('--run');
  const URL = process.env.SUPABASE_URL, KEY = process.env.SUPABASE_SERVICE_ROLE;
  if (!URL || !KEY) throw new Error('.env: SUPABASE_URL ve SUPABASE_SERVICE_ROLE gerekli.');
  const sb = createClient(URL, KEY, { auth: { persistSession: false } });

  console.log(`${WINDOWS.length} pencere yeniden çekilecek (aralarda 5sn bekleme).`);
  console.log(run ? '⚠ GERÇEK YAZMA MODU (--run)' : 'ÖNİZLEME — yazılmayacak (--run ile çalıştırın)');

  let totalFound = 0, totalWritten = 0;
  for (let i = 0; i < WINDOWS.length; i++) {
    const [startISO, endISO] = WINDOWS[i];
    const from = new Date(startISO + 'T00:00:00Z').getTime();
    const to = new Date(endISO + 'T00:00:00Z').getTime();
    process.stdout.write(`[${i + 1}/${WINDOWS.length}] ${startISO} → ${endISO} … `);
    let map;
    try {
      map = await fetchOrderFinance({ from, to });
    } catch (e) {
      console.log(`HATA: ${e.message}`);
      await sleep(8000);
      continue;
    }
    totalFound += map.size;
    console.log(`${map.size} sipariş`);

    if (run && map.size) {
      const rows = [...map.entries()].map(([order_no, r]) => ({
        order_no,
        store_id: r.storeId != null ? String(r.storeId) : null,
        store_name: r.storeName || null,
        order_date: r.orderDate ? new Date(r.orderDate).toISOString() : null,
        tutar: r2(r.ciro),
        komisyon: r2(r.kom)
      }));
      for (let j = 0; j < rows.length; j += 500) {
        const part = rows.slice(j, j + 500);
        const { error } = await sb.from('tgo_arsiv_2022_2024').upsert(part, { onConflict: 'order_no' });
        if (error) throw new Error('upsert: ' + error.message);
        totalWritten += part.length;
      }
    }
    await sleep(5000); // pencereler arası nefes payı — 429'u tekrar tetiklememek için
  }

  console.log(`\nToplam bulunan: ${totalFound} sipariş.`);
  if (run) console.log(`Toplam yazılan/tazelenen: ${totalWritten} satır.`);
  else console.log('Gerçekten yazmak için: node scripts/tgo-arsiv-eksik-doldur.js --run');
}

main()
  .then(() => { process.exitCode = 0; })
  .catch((e) => { console.error('\n✕', e.message || e); process.exitCode = 1; })
  .finally(() => { setTimeout(() => process.exit(process.exitCode || 0), 500).unref(); });
