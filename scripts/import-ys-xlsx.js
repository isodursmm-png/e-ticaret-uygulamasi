/* ============================================================================
   import-ys-xlsx.js  —  Elle indirilmiş Yemeksepeti sipariş Excel'ini
   public.raw_orders'a KONTROLLÜ ekler (duplicate YOK).
   ----------------------------------------------------------------------------
   Excel, "3-Yemeksepeti Sipariş Listesi.xlsx" ile aynı kolonlara sahip olmalı
   (Sipariş No, Kabul Edilme Zamanı, Siparişin Alındığı Tarih, Mağaza, Ürünler…).

   Tekilleştirme: raw-store.js her satır için deterministik bir `key` üretir
   ("yemeksepeti:ys:<Sipariş No>").  raw_orders.key PRIMARY KEY olduğundan
   upsert(onConflict: 'key') ile:
     - yeni sipariş        -> INSERT
     - daha önce görülen   -> UPDATE (data tazelenir, first_seen sabit kalır)
   Aynı Excel'i iki kez çalıştırmak yeni satır OLUŞTURMAZ.

   analytics_payload'a DOKUNMAZ. Panoyu güncellemek için sonrasında:
     node scripts/rebuild-from-raw.js

   Kullanım:
     node scripts/import-ys-xlsx.js "C:/Users/.../Yemek Sepeti Siparişler.xlsx"
     node scripts/import-ys-xlsx.js <dosya> --dry-run     # yazma, sadece özet
   ========================================================================== */
'use strict';
require('dotenv').config();
const fs = require('fs');
const XLSX = require('xlsx');
const { createClient } = require('@supabase/supabase-js');
const { toRawRows, pushRaw } = require('./lib/raw-store');

function parseArgs(argv) {
  const a = { file: null, dryRun: false };
  for (const s of argv) {
    if (s === '--dry-run') a.dryRun = true;
    else if (!s.startsWith('--')) a.file = s;
  }
  return a;
}

/** raw_orders'ta bucket='ys' satır sayısı (yeni/güncellenen ayrımı için). */
async function countYs(sb) {
  const { count, error } = await sb
    .from('raw_orders')
    .select('key', { count: 'exact', head: true })
    .eq('bucket', 'ys');
  if (error) throw new Error('raw_orders sayımı: ' + error.message);
  return count || 0;
}

async function main() {
  const { file, dryRun } = parseArgs(process.argv.slice(2));
  if (!file) throw new Error('Excel yolu verin: node scripts/import-ys-xlsx.js "<dosya.xlsx>"');
  if (!fs.existsSync(file)) throw new Error('Dosya yok: ' + file);

  const URL = process.env.SUPABASE_URL;
  const KEY = process.env.SUPABASE_SERVICE_ROLE;
  if (!dryRun && (!URL || !KEY)) throw new Error('.env: SUPABASE_URL ve SUPABASE_SERVICE_ROLE gerekli.');

  console.log('Excel okunuyor:', file);
  const wb = XLSX.readFile(file, { cellDates: true });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const src = XLSX.utils.sheet_to_json(sheet, { defval: null, raw: true });
  console.log(`  ${src.length} satır · sayfa "${wb.SheetNames[0]}"`);

  if (!src.length) throw new Error('Excel boş.');
  if (!('Sipariş No' in src[0])) {
    throw new Error('"Sipariş No" kolonu yok — bu Yemeksepeti sipariş listesi Excel\'i değil.');
  }

  // Ham satırlar → raw_orders satırları (deterministik key).
  const rows = toRawRows({ ys: src });
  const noNo = src.length - rows.length;

  // Excel içi mükerrer Sipariş No (aynı sipariş birden çok mağazadan) → key'e "~" eklenmiş.
  const dupInFile = rows.filter((r) => r.key.endsWith('~')).length;
  const uniqueOrderNos = new Set(rows.map((r) => r.order_no)).size;

  console.log(`\nHazırlanan raw satır: ${rows.length}`);
  console.log(`  benzersiz Sipariş No : ${uniqueOrderNos}`);
  if (dupInFile) console.log(`  Excel içi mükerrer   : ${dupInFile} (key'e "~" eklenerek korundu)`);
  if (noNo)      console.log(`  Sipariş No boş → atlandı: ${noNo}`);
  const withDate = rows.filter((r) => r.order_date).length;
  console.log(`  tarihi çözülen        : ${withDate}/${rows.length}`);

  if (dryRun) {
    console.log('\n--dry-run — Supabase\'e yazılmadı.');
    console.log('Örnek key:', rows[0].key);
    return;
  }

  const sb = createClient(URL, KEY, { auth: { persistSession: false } });

  const before = await countYs(sb);
  console.log(`\nraw_orders (bucket=ys) mevcut: ${before}`);

  const written = await pushRaw(sb, rows, { chunk: 500 });
  const after = await countYs(sb);

  const inserted = after - before;
  const updated = written - inserted;
  console.log(`\n✓ upsert tamam — ${written} satır işlendi`);
  console.log(`  yeni eklenen (INSERT) : ${inserted}`);
  console.log(`  güncellenen (UPDATE)  : ${updated}  (zaten vardı, duplicate oluşmadı)`);
  console.log(`  raw_orders (bucket=ys) toplam: ${after}`);
  console.log('\nPanoyu güncellemek için:  node scripts/rebuild-from-raw.js');
}

main()
  .then(() => { process.exitCode = 0; })
  .catch((e) => { console.error('\n✕', e.message); process.exitCode = 1; })
  .finally(() => { setTimeout(() => process.exit(process.exitCode || 0), 500).unref(); });
