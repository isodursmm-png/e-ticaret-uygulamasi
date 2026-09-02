/* ============================================================================
   topla.js  —  CANLI kaynaklardan veri çek → buildPayload() → Supabase
   ----------------------------------------------------------------------------
   "import.js" xlsx yolunun API/otomasyon karşılığı. Aynı normalize.js
   çekirdeğini ve aynı Supabase satırını (analytics_payload / id='eticaret')
   kullanır.

   Kullanım:
     node scripts/topla.js                     # tüm yapılandırılmış kaynaklar
     node scripts/topla.js --only=ticimax,trendyol
     node scripts/topla.js --days=60
     node scripts/topla.js --all               # gün sınırı yok — tüm geçmiş
     node scripts/topla.js --dry-run           # Supabase'e yazma, özet bas
     node scripts/topla.js --local             # Supabase'e yazma; public/data.local.js
                                               # + public/local.html üret (login'siz önizleme)
     node scripts/topla.js --only=yemeksepeti --headed   # ilk kurulum / 2FA

   Env: bkz. .env.example  (SUPABASE_URL, SUPABASE_SERVICE_ROLE + kaynak env'leri)
   ========================================================================== */
'use strict';
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');
const { buildPayload, summary, compactGeo } = require('./lib/normalize');
const { writeLocal } = require('./lib/local-preview');

const SOURCES = [
  require('./lib/sources/ticimax'),
  require('./lib/sources/trendyol'),
  require('./lib/sources/tgo-api'),
  require('./lib/sources/yemeksepeti'),
  require('./lib/sources/tgomarket')
];

const EMPTY = () => ({ t0: [], t1: [], ys: [], ty4: [], ty5: [] });

/** FETCH_DAYS: "0" / "" / "all" / "hepsi" → 0 (tüm geçmiş); pozitif sayı → son N gün. */
function envDays() {
  const e = String(process.env.FETCH_DAYS == null ? '' : process.env.FETCH_DAYS).trim().toLowerCase();
  if (e === '' || e === '0' || e === 'all' || e === 'hepsi' || e === 'tum' || e === 'tüm') return 0;
  const n = Number(e);
  return Number.isFinite(n) && n > 0 ? n : 30;
}

/** Tüm (veya seçili) kaynaklardan çek, tek payload girdisinde birleştir.
    days === 0  →  gün sınırı yok (kaynak tüm geçmişi çeker). */
async function collectAll({ only = null, days = envDays(), headed = false } = {}) {
  const merged = EMPTY();
  const ran = [], skipped = [], errors = [];

  for (const src of SOURCES) {
    if (only && !only.includes(src.id)) { skipped.push(src.id + ' (--only dışı)'); continue; }
    if (!src.configured()) { skipped.push(src.id + ' (env eksik)'); continue; }
    console.log(`\n▶ ${src.id}`);
    try {
      const part = await src.fetch({ days, headed });
      for (const k of Object.keys(merged)) {
        if (Array.isArray(part[k])) merged[k] = merged[k].concat(part[k]);
      }
      ran.push(src.id);
    } catch (e) {
      console.error(`  ✕ ${src.id}: ${e.message}`);
      errors.push(`${src.id}: ${e.message}`);
    }
  }

  dedupeTrendyol(merged);
  return { merged, ran, skipped, errors };
}

/** trendyol.js (API) + tgomarket.js (panel) aynı siparişi verebilir — tekilleştir. */
function dedupeTrendyol(m) {
  const seen4 = new Set();
  m.ty4 = m.ty4.filter((r) => {
    const k = String(r['Sipariş No']);
    if (seen4.has(k)) return false; seen4.add(k); return true;
  });
  const seen5 = new Set();
  m.ty5 = m.ty5.filter((r) => {
    const k = String(r['Sipariş Numarası']) + '¦' + String(r['Ürün Adı']) + '¦' + String(r['Adet']);
    if (seen5.has(k)) return false; seen5.add(k); return true;
  });
}

function loadGeo() {
  const p = path.join(__dirname, 'tr-cities.json');
  try { return compactGeo(JSON.parse(fs.readFileSync(p, 'utf8'))); }
  catch (e) { console.warn('geo okunamadı, atlanıyor:', e.message); return null; }
}

/** Çek + Supabase'e yaz. api/refresh.js ve CLI buradan geçer. */
async function buildAndPush({ only = null, days, headed = false, dryRun = false, local = false } = {}) {
  const URL = process.env.SUPABASE_URL;
  const KEY = process.env.SUPABASE_SERVICE_ROLE;
  if (!dryRun && !local && (!URL || !KEY)) throw new Error('SUPABASE_URL ve SUPABASE_SERVICE_ROLE gerekli.');

  const { merged, ran, skipped, errors } = await collectAll({ only, days, headed });

  if (!ran.length) {
    return { ok: false, ran, skipped, errors, error: 'Hiçbir kaynaktan veri alınamadı.' };
  }

  const P = buildPayload(merged);
  const sum = summary(P);
  console.log('\nözet:', JSON.stringify(sum, null, 1));

  if (dryRun) return { ok: true, dryRun: true, meta: P.meta, summary: sum, ran, skipped, errors };

  if (local) {
    writeLocal(P, loadGeo());
    return { ok: true, local: true, meta: P.meta, summary: sum, ran, skipped, errors };
  }

  const sb = createClient(URL, KEY, { auth: { persistSession: false } });
  const { error } = await sb.from('analytics_payload').upsert({
    id: 'eticaret',
    data: P,
    geo: loadGeo(),
    meta: P.meta,
    updated_at: new Date().toISOString()
  });
  if (error) throw new Error('Supabase upsert: ' + error.message);

  console.log(`\n✓ Supabase güncellendi — ${P.meta.orders} sipariş · ${P.meta.items} kalem · ${P.meta.minDate} – ${P.meta.maxDate}`);
  return { ok: true, meta: P.meta, summary: sum, ran, skipped, errors };
}

/* ---------------- CLI ---------------- */
function parseArgs(argv) {
  const a = { only: null, days: undefined, dryRun: false, headed: false, local: false };
  for (const s of argv) {
    if (s === '--dry-run') a.dryRun = true;
    else if (s === '--local') a.local = true;
    else if (s === '--all') a.days = 0;
    else if (s === '--headed') a.headed = true;
    else if (s.startsWith('--only=')) a.only = s.slice(7).split(',').map((x) => x.trim()).filter(Boolean);
    else if (s.startsWith('--days=')) a.days = Number(s.slice(7));
  }
  return a;
}

if (require.main === module) {
  buildAndPush(parseArgs(process.argv.slice(2)))
    .then((r) => {
      if (r.errors && r.errors.length) console.warn('\n⚠ hatalar:\n  ' + r.errors.join('\n  '));
      if (r.skipped && r.skipped.length) console.log('atlanan:', r.skipped.join(', '));
      if (!r.ok && r.error) console.error('\n✕ ' + r.error);
      process.exitCode = r.ok ? 0 : 1;
    })
    .catch((e) => { console.error(e); process.exitCode = 1; })
    // undici keep-alive soketleri açık kalıp Windows'ta process.exit() ile
    // "UV_HANDLE_CLOSING" abort'una yol açabiliyor; olay döngüsü doğal boşalsın,
    // takılırsa kısa gecikmeyle zorla kapat.
    .finally(() => { setTimeout(() => process.exit(process.exitCode || 0), 500).unref(); });
}

module.exports = { collectAll, buildAndPush };
