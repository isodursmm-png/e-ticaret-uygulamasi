/* ============================================================================
   backfill-raw.js  —  TÜM geçmişi Supabase public.raw_orders'a doldurur
   ----------------------------------------------------------------------------
   analytics_payload'a DOKUNMAZ (pano bozulmaz). Sadece ham satış arşivini
   geriye doğru doldurur. Bir kez çalıştırılır; sonrasında saatlik
   `topla.js` güncel pencereyi raw_orders'a eklemeye devam eder.

   Ticimax ay ay çekilip her ay HEMEN Supabase'e yazılır (bellekte birikmez).
   Yemeksepeti / Trendyol API'leri zaten son ~60 günle sınırlı → tek seferde.

   Kullanım:
     node scripts/backfill-raw.js                 # tüm kaynaklar, tüm geçmiş
     node scripts/backfill-raw.js --only=ticimax
     node scripts/backfill-raw.js --days=365      # Ticimax'i son N günle sınırla
     node scripts/backfill-raw.js --from=2024-01  # Ticimax'i bu aydan itibaren

   Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE + kaynak env'leri (bkz. .env.example)
   ========================================================================== */
'use strict';
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const { toRawRows, pushRaw } = require('./lib/raw-store');

const ticimax = require('./lib/sources/ticimax');
const WINDOWED = [
  require('./lib/sources/yemeksepeti-api'),
  require('./lib/sources/tgo-api'),
  require('./lib/sources/trendyol')
];

function parseArgs(argv) {
  const a = { only: null, days: 0, from: null };
  for (const s of argv) {
    if (s.startsWith('--only=')) a.only = s.slice(7).split(',').map((x) => x.trim()).filter(Boolean);
    else if (s.startsWith('--days=')) a.days = Number(s.slice(7)) || 0;
    else if (s.startsWith('--from=')) a.from = s.slice(7).trim(); // YYYY-MM
  }
  return a;
}

/** --from=YYYY-MM verildiyse o ayın 1'inden bugüne kaç gün olduğunu döndür. */
function daysFrom(ym) {
  const m = /^(\d{4})-(\d{2})$/.exec(ym || '');
  if (!m) return 0;
  const start = new Date(+m[1], +m[2] - 1, 1);
  return Math.ceil((Date.now() - start) / 86400e3);
}

async function main() {
  const URL = process.env.SUPABASE_URL;
  const KEY = process.env.SUPABASE_SERVICE_ROLE;
  if (!URL || !KEY) throw new Error('SUPABASE_URL ve SUPABASE_SERVICE_ROLE gerekli.');
  const args = parseArgs(process.argv.slice(2));
  const want = (id) => !args.only || args.only.includes(id);

  const sb = createClient(URL, KEY, { auth: { persistSession: false } });
  const grand = {};

  // ---- Ticimax: ay ay akıt ----
  if (want('ticimax') && ticimax.configured()) {
    const days = args.from ? daysFrom(args.from) : args.days;
    console.log(`\n▶ ticimax  (${days ? 'son ' + days + ' gün' : 'tüm geçmiş'})`);
    let n = 0;
    await ticimax.fetchRows({
      days,
      async onBatch({ t0, t1, label }) {
        const rows = toRawRows({ t0, t1 });
        if (!rows.length) return;
        const w = await pushRaw(sb, rows);
        n += w;
        console.log(`  ${label}: +${w} raw satır (ticimax toplam ${n})`);
      }
    });
    grand.ticimax = n;
    console.log(`✓ ticimax: ${n} raw satır`);
  } else if (want('ticimax')) {
    console.log('atla: ticimax (env eksik)');
  }

  // ---- Yemeksepeti / Trendyol: tek seferde (API zaten ~60 günle sınırlı) ----
  for (const src of WINDOWED) {
    if (!want(src.id)) continue;
    if (!src.configured()) { console.log(`atla: ${src.id} (env eksik)`); continue; }
    console.log(`\n▶ ${src.id}`);
    try {
      const part = await src.fetch({ days: 0 });
      const rows = toRawRows(part);
      const w = rows.length ? await pushRaw(sb, rows) : 0;
      grand[src.id] = w;
      console.log(`✓ ${src.id}: ${w} raw satır`);
    } catch (e) {
      console.error(`✕ ${src.id}: ${e.message}`);
    }
  }

  console.log('\n=== özet ===');
  for (const [k, v] of Object.entries(grand)) console.log(`  ${k}: ${v}`);
  const total = Object.values(grand).reduce((s, x) => s + x, 0);
  console.log(`  TOPLAM: ${total} raw satır → public.raw_orders`);
}

main()
  .then(() => { process.exitCode = 0; })
  .catch((e) => { console.error('\n✕', e.message); process.exitCode = 1; })
  .finally(() => { setTimeout(() => process.exit(process.exitCode || 0), 500).unref(); });
