/* ============================================================================
   rebuild-from-raw.js  —  raw_orders (TÜM geçmiş) → analytics_payload (parçalı)
   ----------------------------------------------------------------------------
   Pano ~90 günle sınırlı canlı çekimden değil, ham arşivin TAMAMINDAN kurulur.
   Kalem satırları ay bazında toplanır; gzip payload ~3 MB'lık parçalara bölünüp
   analytics_payload'a birden çok satır olarak yazılır.

     node scripts/rebuild-from-raw.js            # kur + yaz
     node scripts/rebuild-from-raw.js --dry-run  # sadece boyutları ölç
     node scripts/rebuild-from-raw.js --days=400 # arşivi son N günle sınırla
   ==========================================================================*/
'use strict';
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');
const { buildPayload, summary, compactGeo, packChunks } = require('./lib/normalize');
const { fetchMergedFromRaw } = require('./lib/from-raw');
const { publishFromRaw } = require('./lib/publish-payload');

function loadGeo() {
  try { return compactGeo(JSON.parse(fs.readFileSync(path.join(__dirname, 'tr-cities.json'), 'utf8'))); }
  catch (e) { console.warn('geo okunamadı:', e.message); return null; }
}

async function main() {
  const URL = process.env.SUPABASE_URL, KEY = process.env.SUPABASE_SERVICE_ROLE;
  if (!URL || !KEY) throw new Error('SUPABASE_URL ve SUPABASE_SERVICE_ROLE gerekli.');
  const args = process.argv.slice(2);
  const dry = args.includes('--dry-run');
  const daysArg = (args.find((a) => a.startsWith('--days=')) || '').slice(7);
  const days = daysArg ? Number(daysArg) : 0;
  const sinceISO = days > 0 ? new Date(Date.now() - days * 86400e3).toISOString() : null;

  const sb = createClient(URL, KEY, { auth: { persistSession: false } });

  if (dry) {
    console.log(`▶ raw_orders okunuyor${sinceISO ? ' (son ' + days + ' gün)' : ' (tüm geçmiş)'} …`);
    const t0 = Date.now();
    const { merged, total, byBucket } = await fetchMergedFromRaw(sb, {
      sinceISO, onProgress: (n) => { if (n % 40000 === 0) process.stdout.write(`  ${n}\r`); }
    });
    console.log(`  ${total} satır (${((Date.now() - t0) / 1000).toFixed(0)}sn) — ` +
      Object.entries(byBucket).map(([k, v]) => `${k}:${v}`).join(' '));
    const P = buildPayload(merged, { itmMonthly: true });
    console.log('özet:', JSON.stringify(summary(P), null, 1));
    const pk = packChunks(P);
    console.log(`payload: ${(pk.bytes / 1048576).toFixed(1)} MB → gzip ${(pk.gz / 1048576).toFixed(2)} MB → ${pk.chunks.length} parça`);
    console.log('dry-run — yazılmadı.');
    return;
  }

  const r = await publishFromRaw(sb, { geo: loadGeo(), sinceISO, log: (m) => console.log('  ' + m) });
  console.log(`\n✓ analytics_payload kuruldu — ${r.meta.orders} sipariş · ${r.meta.itemRows} kalem satırı · ` +
    `${r.meta.minDate} – ${r.meta.maxDate} · ${r.chunks} parça`);
}

main().then(() => { process.exitCode = 0; })
  .catch((e) => { console.error('\n✕', e.message); process.exitCode = 1; })
  .finally(() => { setTimeout(() => process.exit(process.exitCode || 0), 500).unref(); });
