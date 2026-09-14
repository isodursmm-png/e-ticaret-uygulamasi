/* ============================================================================
   import-xlsx-raw.js  —  Elle indirilmiş sipariş Excel'ini public.raw_orders'a
   KONTROLLÜ ekler (duplicate YOK).
   ----------------------------------------------------------------------------
   Desteklenen Excel'ler (kolonlarından otomatik algılanır):
     • Yemeksepeti sipariş listesi    → bucket "ys"  (sipariş düzeyi)
     • Trendyol sipariş listesi ürünlü → bucket "ty5" (kalem düzeyi)
     • Trendyol komisyon listesi       → bucket "ty4" (sipariş düzeyi)
     • Ticimax ürünlü sipariş listesi  → bucket "t0"  (kalem düzeyi)
     • Ticimax sipariş listesi         → bucket "t1"  (sipariş düzeyi)

   Tekilleştirme: raw-store.js her satır için deterministik `key` üretir
   (ör. "yemeksepeti:ys:<Sipariş No>", "trendyol:ty5:<Sipariş Numarası>:<kalem sırası>").
   raw_orders.key PRIMARY KEY → upsert(onConflict:'key'):
     - yeni      -> INSERT
     - mevcut    -> UPDATE (data tazelenir, first_seen sabit)
   Aynı Excel'i tekrar çalıştırmak yeni satır OLUŞTURMAZ.

   analytics_payload'a DOKUNMAZ. Panoyu güncellemek için sonra:
     node scripts/rebuild-from-raw.js

   Not: büyük dosyalar için betik kendini artırılmış Node yığınıyla (4 GB)
   yeniden başlatır.

   Kullanım:
     node scripts/import-xlsx-raw.js "<dosya.xlsx>" [--bucket=ys|ty5|ty4|t0|t1] [--dry-run]
   ========================================================================== */
'use strict';

/* --- Büyük Excel'ler için yığın alanını artır: kendini bir kez yeniden başlat --- */
if (!process.env.__XLSX_RAW_CHILD) {
  const { spawnSync } = require('child_process');
  const r = spawnSync(process.execPath,
    ['--max-old-space-size=4096', __filename, ...process.argv.slice(2)],
    { stdio: 'inherit', env: { ...process.env, __XLSX_RAW_CHILD: '1' } });
  process.exit(r.status == null ? 1 : r.status);
}

require('dotenv').config();
const fs = require('fs');
const XLSX = require('xlsx');
const { createClient } = require('@supabase/supabase-js');
const { toRawRows, BUCKETS } = require('./lib/raw-store');

/** raw_orders'a parça parça upsert (onConflict: key). first_seen'e dokunmaz.
    "No space left on device" gibi kurtarılamaz hatalarda hemen durur. */
async function pushRaw(sb, rows, { chunk = 500, onChunk } = {}) {
  let n = 0;
  for (let i = 0; i < rows.length; i += chunk) {
    const part = rows.slice(i, i + chunk);
    let ok = false;
    for (let t = 0; t < 4 && !ok; t++) {
      const { error } = await sb.from('raw_orders').upsert(part, { onConflict: 'key', ignoreDuplicates: false });
      if (!error) { ok = true; break; }
      if (/no space left on device|disk full|quota/i.test(error.message || '')) {
        const e = new Error('raw_orders upsert: ' + error.message);
        e.diskFull = true; e.written = n; throw e;
      }
      if (t === 3) throw new Error('raw_orders upsert: ' + error.message);
      await new Promise((r) => setTimeout(r, 1500 * (t + 1)));
    }
    n += part.length;
    if (onChunk) onChunk(part.length);
  }
  return n;
}

/** Verilen key'lerden raw_orders'ta ZATEN VAR olanların kümesi (PK üzerinde
    küçük parçalı .in sorgusu). Hata olursa null döner → çağıran tümünü upsert eder. */
async function existingKeys(sb, keys, { chunk = 300 } = {}) {
  const found = new Set();
  for (let i = 0; i < keys.length; i += chunk) {
    const part = keys.slice(i, i + chunk);
    let ok = false;
    for (let t = 0; t < 4 && !ok; t++) {
      try {
        const { data, error } = await sb.from('raw_orders').select('key').in('key', part);
        if (error) throw new Error(error.message);
        for (const row of data) found.add(row.key);
        ok = true;
      } catch (e) {
        if (t === 3) { console.warn(`\n  ⚠ mevcut-key taraması yarıda kaldı (${e.message}) — hepsi upsert edilecek`); return null; }
        await new Promise((r) => setTimeout(r, 800 * (t + 1)));
      }
    }
    process.stdout.write(`  mevcut-key taraması ${Math.min(i + chunk, keys.length)}/${keys.length}\r`);
  }
  process.stdout.write('\n');
  return found;
}

function parseArgs(argv) {
  const a = { file: null, dryRun: false, bucket: null };
  for (const s of argv) {
    if (s === '--dry-run') a.dryRun = true;
    else if (s.startsWith('--bucket=')) a.bucket = s.slice(9).trim();
    else if (!s.startsWith('--')) a.file = s;
  }
  return a;
}

/** Kolon adlarından bucket tahmini. */
function detectBucket(cols) {
  const has = (c) => cols.includes(c);
  if (has('Sipariş Numarası') && has('Ürün Adı')) return 'ty5';
  if (has('Market Adı') && has('Ürün Adı')) return 'ty5';
  if (has('Sipariş No') && (has('Kabul Edilme Zamanı') || has('Restoran Adı') || has('Restoran ID'))) return 'ys';
  if (has('Sipariş No') && (has('Mağaza Adı') || has('Satıcı Hakediş') || has('Mağaza Adresi'))) return 'ty4';
  if (has('Sipariş No') && has('Siparis Tarihi') && (has('Ürün') || has('Barkod'))) return 't0';
  if (has('Sipariş No') && has('Siparis Tarihi')) return 't1';
  return null;
}

/** xlsx'i "dense" modda oku, satırları düz nesnelere çevir (sheet_to_json'dan
    çok daha hızlı/hafif — 500 bin satırlık dosyalar için gerekli). */
function readRows(file) {
  const wb = XLSX.read(fs.readFileSync(file), {
    dense: true, cellDates: true, cellFormula: false, cellHTML: false, cellNF: false, cellStyles: false
  });
  const name = wb.SheetNames[0];
  const ws = wb.Sheets[name];
  const range = XLSX.utils.decode_range(ws['!ref']);
  const rowAt = (r) => (Array.isArray(ws['!data']) ? ws['!data'][r] : ws[r]) || [];

  const header = [];
  const hrow = rowAt(range.s.r);
  for (let c = range.s.c; c <= range.e.c; c++) header.push(hrow[c] ? String(hrow[c].v) : `__col${c}`);

  const out = [];
  for (let r = range.s.r + 1; r <= range.e.r; r++) {
    const row = rowAt(r);
    const o = {};
    let empty = true;
    for (let c = range.s.c; c <= range.e.c; c++) {
      const cell = row[c];
      const v = cell == null ? null : cell.v;
      o[header[c - range.s.c]] = v == null ? null : v;
      if (v != null && v !== '') empty = false;
    }
    if (!empty) out.push(o);
  }
  return { name, header, rows: out };
}

async function main() {
  const { file, dryRun, bucket: bucketArg } = parseArgs(process.argv.slice(2));
  if (!file) throw new Error('Excel yolu verin: node scripts/import-xlsx-raw.js "<dosya.xlsx>"');
  if (!fs.existsSync(file)) throw new Error('Dosya yok: ' + file);

  const URL = process.env.SUPABASE_URL;
  const KEY = process.env.SUPABASE_SERVICE_ROLE;
  if (!dryRun && (!URL || !KEY)) throw new Error('.env: SUPABASE_URL ve SUPABASE_SERVICE_ROLE gerekli.');

  console.log('Excel okunuyor:', file);
  const t0 = Date.now();
  const { name, header, rows: src } = readRows(file);
  console.log(`  ${src.length} satır · sayfa "${name}" · ${((Date.now() - t0) / 1000).toFixed(0)}sn`);
  if (!src.length) throw new Error('Excel boş.');

  const bucket = bucketArg || detectBucket(header);
  if (!bucket || !BUCKETS[bucket]) {
    throw new Error('Bucket algılanamadı. --bucket=ys|ty5|ty4|t0|t1 ile belirtin.\nKolonlar: ' + header.join(' | '));
  }
  const cfg = BUCKETS[bucket];
  console.log(`  bucket = ${bucket}  (${cfg.source} / ${cfg.channel} / ${cfg.level})`);
  if (!header.includes(cfg.no)) {
    throw new Error(`Bu bucket "${cfg.no}" kolonunu bekliyor ama Excel'de yok. Yanlış dosya/bucket olabilir.`);
  }

  const rows = toRawRows({ [bucket]: src });
  const noNo = src.length - rows.length;
  const dupInFile = rows.filter((r) => r.key.endsWith('~')).length;
  const uniqueNos = new Set(rows.map((r) => r.order_no)).size;
  const withDate = rows.filter((r) => r.order_date).length;

  console.log(`\nHazırlanan raw satır : ${rows.length}`);
  console.log(`  benzersiz sipariş no : ${uniqueNos}`);
  if (dupInFile) console.log(`  Excel içi mükerrer key: ${dupInFile} (key'e "~" eklenerek korundu)`);
  if (noNo)      console.log(`  sipariş no boş → atlandı: ${noNo}`);
  console.log(`  tarihi çözülen        : ${withDate}/${rows.length}`);
  console.log(`  örnek key             : ${rows[0].key}`);

  if (dryRun) { console.log('\n--dry-run — Supabase\'e yazılmadı.'); return; }

  const sb = createClient(URL, KEY, { auth: { persistSession: false } });

  // ty4 (Trendyol Komisyon Listesi) İSTİSNA: amaç zaten var olan siparişlerin
  // canlı API'den 0 gelen komisyonunu gerçek değerle GÜNCELLEMEK — "eksik
  // key'leri yaz" filtresi burada tam tersini yapıp hepsini atlardı. Bu
  // bucket için her zaman tüm satırları upsert et (dosyalar küçük, sorun değil).
  let pending = rows;
  if (bucket !== 'ty4') {
    // Diğer bucket'larda: yalnızca EKSİK key'leri yaz — DB'yi gereksiz UPDATE
    // bloat'ından korur ve yarıda kalmış içe aktarımı kaldığı yerden sürdürür.
    console.log('\nMevcut kayıtlar taranıyor…');
    const exist = await existingKeys(sb, rows.map((r) => r.key));
    pending = exist ? rows.filter((r) => !exist.has(r.key)) : rows;
    if (exist) {
      console.log(`  zaten var : ${rows.length - pending.length}`);
      console.log(`  yazılacak : ${pending.length}`);
    }
  } else {
    console.log(`\nty4: mevcut siparişlerin komisyonunu güncellemek için tüm ${rows.length} satır yazılacak.`);
  }
  if (!pending.length) { console.log('\n✓ Eklenecek yeni kayıt yok — her şey zaten raw_orders\'ta.'); return; }

  let done = 0;
  try {
    const written = await pushRaw(sb, pending, { chunk: 500, onChunk: (n) => {
      done += n; process.stdout.write(`  upsert ${done}/${pending.length}\r`);
    } });
    process.stdout.write('\n');
    console.log(`\n✓ upsert tamam — ${written} yeni satır raw_orders'a eklendi (duplicate yok).`);
    console.log('Panoyu güncellemek için:  node scripts/rebuild-from-raw.js');
  } catch (e) {
    process.stdout.write('\n');
    if (e.diskFull) {
      console.error(`\n✕ SUPABASE DİSKİ DOLDU — ${e.written}/${pending.length} yeni satır yazıldıktan sonra durdu.`);
      console.error('  Duplicate OLUŞMADI. Disk açıldıktan sonra betiği aynı şekilde tekrar çalıştırın;');
      console.error('  kaldığı yerden (yalnızca eksik key\'ler) devam eder.');
    }
    throw e;
  }
}

main()
  .then(() => { process.exitCode = 0; })
  .catch((e) => { console.error('\n✕', e.message); process.exitCode = 1; })
  .finally(() => { setTimeout(() => process.exit(process.exitCode || 0), 500).unref(); });
