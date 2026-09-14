/* ============================================================================
   purge-raw-before.js  —  public.raw_orders'tan tarihi bir eşikten ÖNCE olan
   TÜM satırları güvenli (parçalı) şekilde siler.
   ----------------------------------------------------------------------------
   • order_date < eşik  olan satırlar silinir.
   • order_date NULL olanlara DOKUNMAZ (tarihi bilinmeyen kayıt korunur).
   • analytics_payload'a DOKUNMAZ — sonrasında:  node scripts/rebuild-from-raw.js
   • Parçalı çalışır (key listesi çek → .in ile sil) — büyük tabloda WAL/timeout
     baskısını sınırlar, yarıda kesilse kaldığı yerden sürer.

   Kullanım:
     node scripts/purge-raw-before.js                 # önizleme (SİLMEZ), eşik = 2025-01-01 (TR)
     node scripts/purge-raw-before.js --date=2025-01-01
     node scripts/purge-raw-before.js --date=2025-01-01 --run      # GERÇEKTEN SİL
     node scripts/purge-raw-before.js --date=2025-01-01 --run --bucket=t0
     node scripts/purge-raw-before.js --run --batch=300 --utc

   Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE  (bkz. .env.example)
   ========================================================================== */
'use strict';
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

function parseArgs(argv) {
  const a = { date: '2025-01-01', run: false, bucket: null, batch: 500, utc: false };
  for (const s of argv) {
    if (s === '--run') a.run = true;
    else if (s === '--utc') a.utc = true;
    else if (s.startsWith('--date=')) a.date = s.slice(7).trim();
    else if (s.startsWith('--bucket=')) a.bucket = s.slice(9).trim();
    else if (s.startsWith('--batch=')) a.batch = Math.max(50, Number(s.slice(8)) || 500);
  }
  return a;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Geçici hatalarda artan beklemeyle tekrar dene. */
async function withRetry(label, fn, tries = 5) {
  let last;
  for (let i = 0; i < tries; i++) {
    try { return await fn(); }
    catch (e) {
      last = e;
      const wait = 2000 * (i + 1);
      console.warn(`  ↻ ${label}: ${String(e.message || e).slice(0, 160)} — ${wait / 1000}sn sonra tekrar (${i + 2}/${tries})`);
      await sleep(wait);
    }
  }
  throw last;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const URL = process.env.SUPABASE_URL, KEY = process.env.SUPABASE_SERVICE_ROLE;
  if (!URL || !KEY) throw new Error('.env: SUPABASE_URL ve SUPABASE_SERVICE_ROLE gerekli.');

  if (!/^\d{4}-\d{2}-\d{2}$/.test(args.date)) throw new Error('--date=YYYY-MM-DD biçiminde olmalı.');
  const cutoff = new Date(args.date + (args.utc ? 'T00:00:00Z' : 'T00:00:00+03:00'));
  if (isNaN(cutoff)) throw new Error('Geçersiz tarih: ' + args.date);
  const CUT = cutoff.toISOString();

  const sb = createClient(URL, KEY, { auth: { persistSession: false } });

  console.log(`Eşik: order_date < ${CUT}  (${args.utc ? 'UTC' : 'TR saati'} ${args.date} 00:00)`);
  if (args.bucket) console.log(`Bucket filtresi: ${args.bucket}`);
  console.log(args.run ? '⚠ GERÇEK SİLME MODU (--run)' : 'ÖNİZLEME — hiçbir şey silinmez (--run ile çalıştırın)');
  console.log('');

  const sel = () => {
    let q = sb.from('raw_orders').select('key').lt('order_date', CUT).order('order_date', { ascending: true }).limit(args.batch);
    if (args.bucket) q = q.eq('bucket', args.bucket);
    return q;
  };

  if (!args.run) {
    const { data, error } = await withRetry('önizleme', async () => {
      const r = await sel(); if (r.error) throw new Error(r.error.message || JSON.stringify(r.error)); return r;
    });
    console.log(`Eşiği geçen ilk ${data.length} kayıt örneği (ilk 5 key):`);
    data.slice(0, 5).forEach((r) => console.log('  ' + r.key));
    console.log(`\n${data.length === args.batch ? 'En az bir tam parça dolu — silinecek çok kayıt var.' : data.length + ' kayıt bulundu.'}`);
    console.log('Silmek için:  node scripts/purge-raw-before.js --date=' + args.date + ' --run');
    return;
  }

  let round = 0, deleted = 0;
  const t0 = Date.now();
  for (;;) {
    const { data, error } = await withRetry('key çekme', async () => {
      const r = await sel(); if (r.error) throw new Error(r.error.message || JSON.stringify(r.error)); return r;
    });
    if (!data.length) break;
    const keys = data.map((r) => r.key);

    await withRetry('silme', async () => {
      const { error: de } = await sb.from('raw_orders').delete().in('key', keys);
      if (de) throw new Error(de.message || JSON.stringify(de));
    });

    deleted += keys.length;
    round++;
    if (round % 10 === 0 || keys.length < args.batch) {
      const rate = (deleted / ((Date.now() - t0) / 1000)).toFixed(0);
      process.stdout.write(`  silindi: ${deleted}  (~${rate}/sn)\r`);
    }
    if (keys.length < args.batch) break;
    await sleep(150); // DB'ye nefes aldır (WAL/checkpoint)
  }
  process.stdout.write('\n');
  console.log(`\n✓ Bitti — ${deleted} satır silindi (order_date < ${CUT}${args.bucket ? ', bucket=' + args.bucket : ''}).`);
  console.log('Panoyu güncelle:  node scripts/rebuild-from-raw.js');
}

main()
  .then(() => { process.exitCode = 0; })
  .catch((e) => { console.error('\n✕', e.message || e); process.exitCode = 1; })
  .finally(() => { setTimeout(() => process.exit(process.exitCode || 0), 500).unref(); });
