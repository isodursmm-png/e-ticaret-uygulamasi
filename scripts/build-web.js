/* ============================================================================
   build-web.js  —  _kaynak/template.html  ->  public/index.html + public/app.js
   ----------------------------------------------------------------------------
   Masaüstündeki tek dosya panoyu, Supabase'ten veri çeken web uygulamasına
   dönüştürür. Şablon değiştikçe bu betiği tekrar çalıştırın:  npm run build:web
   ========================================================================== */
'use strict';
const fs = require('fs');
const path = require('path');

const TPL = process.env.TEMPLATE_PATH ||
  'C:/Users/İshak DURMUŞ/Desktop/E - TICARET ANALIZLERI/_kaynak/template.html';
const OUT = path.join(__dirname, '..', 'public');

const LEAFLET_JS  = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';

const tpl = fs.readFileSync(TPL, 'utf8');

/* ---- 1) büyük satır içi <script> gövdesini ayıkla ---- */
const bigMark = '<script>\n"use strict";';
const bigStart = tpl.indexOf(bigMark);
if (bigStart < 0) throw new Error('şablonda ana <script> bulunamadı');
const bigEnd = tpl.indexOf('</script>', bigStart);
let appJs = tpl.slice(bigStart + '<script>'.length, bigEnd); // "\n\"use strict\";\n..."

appJs = appJs
  .replace(
    "const PL = JSON.parse(document.getElementById('payload').textContent);",
    'const PL = window.__PL__;')
  .replace(
    'const GEO = /*__GEO__*/null;',
    'const GEO = window.__GEO__ || null;')
  .replace('"use strict";',
    '"use strict";\nif(!window.__PL__){ throw new Error("Veri hazır değil (boot.js önce çalışmalı)"); }');

fs.writeFileSync(path.join(OUT, 'app.js'), appJs.replace(/^\s+/, ''), 'utf8');

/* ---- 2) baş kısım (<title> + <link> + <style>) ---- */
const styleEnd = tpl.indexOf('</style>');
if (styleEnd < 0) throw new Error('şablonda </style> yok');
let headPart = tpl.slice(0, styleEnd);

const GATE_CSS = `
/* ---- oturum kapısı ---- */
#authGate{position:fixed; inset:0; z-index:99999; display:none; align-items:center; justify-content:center;
  background:var(--page); padding:24px}
#authGate.on{display:flex}
#authGate .card{width:340px; max-width:100%; background:var(--panel); border:1px solid var(--panel-line);
  border-radius:14px; padding:26px 24px; box-shadow:var(--shadow)}
#authGate h2{font-size:17px; margin-bottom:4px}
#authGate p{font-size:12px; color:var(--ink-2); margin-bottom:16px}
#authGate label{display:block; font-size:11px; font-weight:700; letter-spacing:.06em; text-transform:uppercase;
  color:var(--muted); margin:10px 0 4px}
#authGate input{width:100%; padding:9px 11px; font:inherit; font-size:13px; border:1px solid var(--hair-strong);
  border-radius:9px; background:var(--surface-2); color:var(--ink)}
#authGate button{width:100%; margin-top:16px; padding:10px; border:0; border-radius:9px; font:inherit;
  font-weight:700; color:#fff; background:var(--brand-grad); cursor:pointer}
#authGate button:disabled{opacity:.6; cursor:default}
#authGate .msg{margin-top:12px; font-size:12px; min-height:16px}
#authGate .msg.err{color:var(--warn)}
#appShell{display:none}
#appShell.ready{display:block}
`;
headPart = headPart + GATE_CSS;

/* ---- 3) gövde (markup) ---- */
let body = tpl.slice(styleEnd + '</style>'.length, tpl.indexOf('<script id="payload"'));

// çıkış düğmesi
body = body.replace(
  '<button class="tb-btn" id="fsBtn">⛶ Tam ekran</button>',
  '<button class="tb-btn" id="fsBtn">⛶ Tam ekran</button>\n        <button class="tb-btn" id="logoutBtn" title="Oturumu kapat">⎋ Çıkış</button>');

// tüm uygulamayı #appShell içine sar (oturum açılana kadar gizli)
body = body.replace('<div class="app">', '<div id="appShell"><div class="app">');
body = body.replace('<div id="tip"></div>', '</div><div id="tip"></div>');

const GATE_HTML = `
<div id="authGate">
  <form class="card" id="authForm">
    <h2>E‑Ticaret Analizleri</h2>
    <p>Devam etmek için giriş yapın.</p>
    <label for="agEmail">E‑posta</label>
    <input id="agEmail" type="email" autocomplete="email" required>
    <label for="agPass">Parola</label>
    <input id="agPass" type="password" autocomplete="current-password" required>
    <button type="submit" id="agBtn">Giriş yap</button>
    <div class="msg" id="agMsg"></div>
  </form>
</div>`;

body = body + GATE_HTML;

/* ---- 4) birleştir ---- */
const html =
`<!doctype html>
<html lang="tr">
<head>
<meta charset="utf-8">
<link rel="icon" href="data:,">
${headPart.replace(/^\uFEFF/, '')}
</style>
</head>
<body>
${body.trim()}
<script src="${LEAFLET_JS}" crossorigin=""></script>
<script src="./config.js"></script>
<script type="module" src="./boot.js"></script>
</body>
</html>
`;

fs.writeFileSync(path.join(OUT, 'index.html'), html, 'utf8');

console.log('yazıldı:', path.join(OUT, 'index.html'), '(' + (html.length / 1024).toFixed(0) + ' KB)');
console.log('yazıldı:', path.join(OUT, 'app.js'),     '(' + (appJs.length / 1024).toFixed(0) + ' KB)');
