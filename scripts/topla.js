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
     node scripts/topla.js --no-raw            # raw_orders (ham arşiv) yazımını atla
     node scripts/topla.js --only=yemeksepeti --headed   # ilk kurulum / 2FA

   Not: normal koşuda analytics_payload (tek satır, ezilir) + raw_orders
   (ham satış arşivi, birikir) güncellenir. raw_orders için supabase/schema.sql
   çalıştırılmış olmalı.

   Env: bkz. .env.example  (SUPABASE_URL, SUPABASE_SERVICE_ROLE + kaynak env'leri)
   ========================================================================== */
'use strict';
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');
const { buildPayload, summary, compactGeo, packData } = require('./lib/normalize');
const { writeLocal } = require('./lib/local-preview');
const { toRawRows, pushRaw } = require('./lib/raw-store');
const { publishFromRaw, publishTufe } = require('./lib/publish-payload');

const SOURCES = [
  require('./lib/sources/ticimax'),
  require('./lib/sources/trendyol'),
  require('./lib/sources/tgo-api'),
  require('./lib/sources/yemeksepeti-api'),
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

/** Geçici hatalarda (5xx / Cloudflare 520 / ağ / timeout) artan beklemeyle tekrar dene. */
async function withRetry(label, fn, tries = 4) {
  let last;
  for (let i = 0; i < tries; i++) {
    try { return await fn(); }
    catch (e) {
      last = e;
      const m = String((e && e.message) || e);
      const transient = /\b5\d\d\b|timeout|ETIMEDOUT|ECONNRESET|EAI_AGAIN|fetch failed|socket hang up|network|cloudflare|unknown error/i.test(m);
      if (i < tries - 1 && transient) {
        const wait = 4000 * (i + 1);
        console.warn(`  ↻ ${label}: ${m.slice(0, 140)} — ${wait / 1000}sn sonra tekrar (${i + 2}/${tries})`);
        await new Promise((r) => setTimeout(r, wait));
      } else break;
    }
  }
  throw last;
}

/** RAW_ORDERS=0 (env) veya --no-raw (CLI) ile ham arşiv yazımı kapatılır. */
function rawEnabled(raw) {
  if (raw === false) return false;
  return String(process.env.RAW_ORDERS || '').trim() !== '0';
}

/** Çek + Supabase'e yaz. api/refresh.js ve CLI buradan geçer. */
async function buildAndPush({ only = null, days, headed = false, dryRun = false, local = false, raw = true } = {}) {
  const URL = process.env.SUPABASE_URL;
  const KEY = process.env.SUPABASE_SERVICE_ROLE;
  if (!dryRun && !local && (!URL || !KEY)) throw new Error('SUPABASE_URL ve SUPABASE_SERVICE_ROLE gerekli.');

  const { merged, ran, skipped, errors } = await collectAll({ only, days, headed });

  if (!ran.length) {
    return { ok: false, ran, skipped, errors, error: 'Hiçbir kaynaktan veri alınamadı.' };
  }

  const P = buildPayload(merged);
  const sum = summary(P);
  console.log('\nözet (bu koşu):', JSON.stringify(sum, null, 1));

  const rawRows = rawEnabled(raw) ? toRawRows(merged) : [];

  if (dryRun) {
    console.log(`ham arşiv: ${rawRows.length} satır hazırlandı (raw_orders'a yazılmadı — dry-run)`);
    return { ok: true, dryRun: true, meta: P.meta, summary: sum, rawRows: rawRows.length, ran, skipped, errors };
  }

  if (local) {
    writeLocal(P, loadGeo());
    return { ok: true, local: true, meta: P.meta, summary: sum, ran, skipped, errors };
  }

  const sb = createClient(URL, KEY, { auth: { persistSession: false } });

  // 1) Ham arşivi bu koşunun taze verisiyle güncelle (yeni sipariş/kalem eklenir).
  let rawWritten = 0;
  if (rawRows.length) {
    try {
      rawWritten = await withRetry('raw_orders upsert', () => pushRaw(sb, rawRows));
      console.log(`✓ raw_orders — ${rawWritten} ham satır yazıldı/güncellendi`);
    } catch (e) {
      const hint = /relation .*raw_orders.* does not exist|Could not find the table/i.test(e.message)
        ? ' — supabase/schema.sql çalıştırılmamış olabilir' : '';
      console.warn(`⚠ raw_orders atlandı: ${e.message}${hint}`);
      errors.push(`raw_orders: ${e.message}`);
    }
  }

  // 2) Panoyu ham arşivden kur — varsayılan son PAYLOAD_DAYS gün (365 = ~12 ay).
  //    Tüm geçmiş büyüdükçe payload (gzip'li, tarayıcıda açılan) da büyüyüp
  //    açılış süresini uzatıyordu; pano varsayılanı son 12 aya sabitlendi.
  //    Eski veri raw_orders'ta durmaya devam eder, yalnızca varsayılan pano
  //    görünümünden çıkar. PAYLOAD_DAYS=0 tüm geçmişe döner.
  const PAYLOAD_DAYS = Number(process.env.PAYLOAD_DAYS || 365);
  const payloadSinceISO = PAYLOAD_DAYS > 0 ? new Date(Date.now() - PAYLOAD_DAYS * 86400e3).toISOString() : null;

  let pub;
  try {
    pub = await withRetry('analytics_payload publish', () =>
      publishFromRaw(sb, { geo: loadGeo(), sinceISO: payloadSinceISO, fallbackP: P, log: (m) => console.log('  ' + m) }));
    console.log(`\n✓ analytics_payload — ${pub.meta.orders} sipariş · ${pub.meta.minDate} – ${pub.meta.maxDate} · ${pub.chunks} parça${pub.fallback ? ' (fallback: canlı)' : ''}`);
  } catch (e) {
    console.warn(`⚠ tüm-geçmiş kurulum başarısız (${e.message}) — canlı payload tek satır yazılıyor`);
    errors.push(`publish: ${e.message}`);
    await withRetry('analytics_payload fallback', async () => {
      const { error } = await sb.from('analytics_payload').upsert({
        id: 'eticaret', data: packData(P), geo: loadGeo(), meta: P.meta, updated_at: new Date().toISOString()
      });
      if (error) throw new Error(error.message);
    });
    pub = { meta: P.meta, chunks: 1, fallback: true };
  }

  // 3) Aylık TÜİK TÜFE (FİNAL segmenti "Enf. %") — ayrı satır, hata yutulur.
  await publishTufe(sb, (m) => console.log('  ' + m));

  return { ok: true, meta: pub.meta, summary: sum, rawWritten, chunks: pub.chunks, ran, skipped, errors };
}

/* ---------------- CLI ---------------- */
function parseArgs(argv) {
  const a = { only: null, days: undefined, dryRun: false, headed: false, local: false, raw: true };
  for (const s of argv) {
    if (s === '--dry-run') a.dryRun = true;
    else if (s === '--local') a.local = true;
    else if (s === '--all') a.days = 0;
    else if (s === '--no-raw') a.raw = false;
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
