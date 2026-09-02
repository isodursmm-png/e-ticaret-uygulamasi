/* ============================================================================
   lib/local-preview.js  —  Supabase'siz yerel önizleme üretir
   ----------------------------------------------------------------------------
   buildPayload() çıktısını public/data.local.js'e yazar ve public/index.html'i
   login/Supabase katmanından arındırıp public/local.html olarak kaydeder.
   Hem topla.js (--local) hem import.js (--local) buradan geçer.
   Üretilen iki dosya da .gitignore'dadır.
   ========================================================================== */
'use strict';
const fs = require('fs');
const path = require('path');

const PUB = path.join(__dirname, '..', '..', 'public');

function writeLocal(P, geo) {
  if (!fs.existsSync(PUB)) fs.mkdirSync(PUB, { recursive: true });

  const dataFile = path.join(PUB, 'data.local.js');
  fs.writeFileSync(dataFile,
    '/* --local ile üretildi — anlık veri. git\'e girmez (.gitignore).\n' +
    '   public/local.html bunu okur. */\n' +
    'window.__PL__  = ' + JSON.stringify(P) + ';\n' +
    'window.__GEO__ = ' + JSON.stringify(geo || null) + ';\n' +
    'window.__LOCAL_PREVIEW__ = true;\n');

  const htmlFile = path.join(PUB, 'local.html');
  const idx = path.join(PUB, 'index.html');
  if (fs.existsSync(idx)) {
    let html = fs.readFileSync(idx, 'utf8');
    // oturum kapısını ve Supabase boot akışını çıkar; veriyi doğrudan yükle.
    html = html
      .replace('<script src="./config.js"></script>', '')
      .replace('<script type="module" src="./boot.js"></script>',
        '<script src="./data.local.js"></script>\n<script src="./app.js"></script>')
      .replace(/<div id="authGate">[\s\S]*?<\/form>\s*<\/div>/, '')
      .replace('id="appShell"', 'id="appShell" class="ready"');
    fs.writeFileSync(htmlFile, html);
  } else {
    fs.writeFileSync(htmlFile,
      '<!doctype html><meta charset="utf-8"><title>Yerel önizleme</title>\n' +
      '<p style="font:14px system-ui;padding:24px">Önce <code>npm run build:web</code> ile ' +
      '<code>public/index.html</code> üretin, sonra önizleme komutunu tekrar çalıştırın.</p>\n' +
      '<script src="./data.local.js"></script>');
  }

  console.log(`\n✓ yerel önizleme yazıldı:\n  ${dataFile}\n  ${htmlFile}`);
  console.log('  → npm run dev   ·   http://localhost:4173/local.html');
}

module.exports = { writeLocal };
