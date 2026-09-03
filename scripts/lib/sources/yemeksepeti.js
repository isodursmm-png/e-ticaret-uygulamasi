/* ============================================================================
   sources/yemeksepeti.js  —  partner-app.yemeksepeti.com panelinden sipariş
   raporu (Playwright ile giriş → Excel indir → çözümle).
   ----------------------------------------------------------------------------
   Çıktı: { ys }  — "3-Yemeksepeti Sipariş Listesi.xlsx" ile AYNI kolonlar,
   yani indirdiğimiz Excel'i olduğu gibi satırlara çeviriyoruz (normalize.js
   zaten bu kolon adlarını okuyor).

   Env:
     YEMEKSEPETI_USER / YEMEKSEPETI_PASS
     YS_LOGIN_URL     (vars: https://partner-app.yemeksepeti.com/)
     YS_REPORT_URL    sipariş/rapor sayfası (giriş sonrası açılır)
     YS_SEL_EMAIL / YS_SEL_PASS / YS_SEL_SUBMIT / YS_SEL_LOGGEDIN / YS_SEL_EXPORT
       CSS seçicileri — panel arayüzüne göre bir kez ayarlanır.

   ⚠️ Seçiciler kuruluma özgüdür. İlk kurulumda:
        npx playwright codegen https://partner-app.yemeksepeti.com/
      ile giriş + "Dışa aktar" akışını kaydedip seçicileri .env'e yazın.
   ==========================================================================*/
'use strict';
const XLSX = require('xlsx');
const { runPortal, clickDownload } = require('./_portal');
const { log } = require('./_util');

const id = 'yemeksepeti';

function configured() {
  // Yemeksepeti API adaptörü (yemeksepeti-api) yapılandırılmışsa Playwright yolunu kullanma.
  // Vendor kimliği tek (YEMEKSEPETI_VENDOR_ID) ya da çok mağazalı (…_VENDOR_ID1..N) olabilir.
  const hasVendor = !!(process.env.YEMEKSEPETI_VENDOR_ID || process.env.YEMEKSEPETI_VENDOR_ID1);
  if (process.env.YEMEKSEPETI_CLIENT_ID && process.env.YEMEKSEPETI_CLIENT_SECRET &&
      process.env.YEMEKSEPETI_CHAIN_ID && hasVendor) {
    return false;
  }
  // Panel girişi captcha/2FA'lı; otomasyon ancak codegen ile seçiciler + rapor
  // URL'si ayarlandıktan sonra çalışır. O yüzden YS_REPORT_URL yoksa atla
  // (her topla çalıştırmasında boşa tarayıcı açmamak için).
  return !!(process.env.YEMEKSEPETI_USER && process.env.YEMEKSEPETI_PASS && process.env.YS_REPORT_URL);
}

async function fetch({ days = 30, headed = false } = {}) {
  const sel = {
    email: process.env.YS_SEL_EMAIL || 'input[type="email"], input[name="email"], #email',
    pass: process.env.YS_SEL_PASS || 'input[type="password"], input[name="password"], #password',
    submit: process.env.YS_SEL_SUBMIT || 'button[type="submit"]',
    loggedIn: process.env.YS_SEL_LOGGEDIN || '[data-testid="user-menu"], nav, header'
  };
  const exportSel = process.env.YS_SEL_EXPORT ||
    'button:has-text("Dışa aktar"), button:has-text("Excel"), a:has-text("İndir")';

  const rows = await runPortal({
    name: id,
    loginUrl: process.env.YS_LOGIN_URL || process.env.YEMEKSEPETI_URL || 'https://partner-app.yemeksepeti.com/',
    user: process.env.YEMEKSEPETI_USER,
    pass: process.env.YEMEKSEPETI_PASS,
    headless: !headed,
    sel,
    async extract(page) {
      const reportUrl = process.env.YS_REPORT_URL || process.env.YEMEKSEPETI_URL;
      if (reportUrl) {
        await page.goto(reportUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
        await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
      }
      // TODO: tarih aralığı filtresi gerekiyorsa burada ayarlanır (son ${days} gün).
      const file = await clickDownload(page, exportSel).catch((e) => {
        throw new Error(
          `${id}: Excel indirme düğmesi bulunamadı (${e.message}). ` +
          `YS_SEL_EXPORT ve YS_REPORT_URL değerlerini panele göre ayarlayın ` +
          `(npx playwright codegen ile kaydedin).`
        );
      });
      const wb = XLSX.readFile(file, { cellDates: true });
      return XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: null, raw: true });
    }
  });

  log(id, `${rows.length} satır`);
  return { ys: rows };
}

module.exports = { id, configured, fetch };
