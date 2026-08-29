/* ============================================================================
   import.js  —  xlsx dosyalarını Supabase'e aktarır (tek jsonb satırı)
   ----------------------------------------------------------------------------
   Kullanım:
     1) .env dosyasını doldurun (bkz. .env.example)
     2) npm install
     3) npm run import
   ========================================================================== */
'use strict';
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');
const { createClient } = require('@supabase/supabase-js');
const { buildPayload, summary, compactGeo } = require('./lib/normalize');

const SRC = process.env.XLSX_DIR || 'C:/Users/İshak DURMUŞ/Desktop/ETICARET/Eticaret';
const URL = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE;

if (!URL || !KEY) {
  console.error('HATA: .env içinde SUPABASE_URL ve SUPABASE_SERVICE_ROLE gerekli.');
  process.exit(1);
}

const rd = (f) => {
  const full = path.join(SRC, f);
  if (!fs.existsSync(full)) { console.warn('  (yok, atlandı):', f); return []; }
  const wb = XLSX.readFile(full, { cellDates: true });
  return XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: null, raw: true });
};

(async () => {
  console.log('xlsx okunuyor:', SRC);
  const P = buildPayload({
    t0:  rd('0-Ticimax Ürünlü Sipariş Listesi.xlsx'),
    t1:  rd('1-Ticimax Sipariş.xlsx'),
    ys:  rd('3-Yemeksepeti Sipariş Listesi.xlsx'),
    ty4: rd('4-Trendyol Komisyon Listesi.xlsx'),
    ty5: rd('5-Trendyol Sipariş Listesi.xlsx')
  });
  console.log('özet:', JSON.stringify(summary(P), null, 1));

  let geo = null;
  const geoPath = path.join(__dirname, 'tr-cities.json');
  try { geo = compactGeo(JSON.parse(fs.readFileSync(geoPath, 'utf8'))); }
  catch (e) { console.warn('geo okunamadı, atlanıyor:', e.message); }

  const sb = createClient(URL, KEY, { auth: { persistSession: false } });
  const { error } = await sb.from('analytics_payload').upsert({
    id: 'eticaret',
    data: P,
    geo,
    meta: P.meta,
    updated_at: new Date().toISOString()
  });
  if (error) { console.error('Supabase upsert hatası:', error.message); process.exit(1); }

  const kb = (JSON.stringify(P).length / 1024).toFixed(0);
  console.log(`\n✓ Supabase güncellendi  (analytics_payload / id=eticaret, ~${kb} KB)`);
  console.log(`  ${P.meta.orders} sipariş · ${P.meta.items} kalem · ${P.meta.minDate} – ${P.meta.maxDate}`);
})().catch((e) => { console.error(e); process.exit(1); });
