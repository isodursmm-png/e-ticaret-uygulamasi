/* Deploy sırasında ortam değişkenlerinden public/config.js üretir.
   Vercel/Netlify build komutu olarak kullanın:  node scripts/gen-config.js
   Gerekli env: SUPABASE_URL, SUPABASE_ANON_KEY  (anon anahtar herkese açık olabilir; RLS korur) */
'use strict';
const fs = require('fs');
const path = require('path');

const url = process.env.SUPABASE_URL;
const anon = process.env.SUPABASE_ANON_KEY;
if (!url || !anon) {
  console.error('HATA: SUPABASE_URL ve SUPABASE_ANON_KEY ortam değişkenleri gerekli.');
  process.exit(1);
}
const out = path.join(__dirname, '..', 'public', 'config.js');
fs.writeFileSync(out,
  `window.ETA_CONFIG = {\n  SUPABASE_URL: ${JSON.stringify(url)},\n  SUPABASE_ANON_KEY: ${JSON.stringify(anon)}\n};\n`);
console.log('yazıldı:', out);
