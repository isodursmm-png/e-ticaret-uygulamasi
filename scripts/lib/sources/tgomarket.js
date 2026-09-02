/* ============================================================================
   sources/tgomarket.js  —  partner.tgomarket.com (Trendyol GO / grocery)
   panelinden sipariş + komisyon raporları (Playwright).
   ----------------------------------------------------------------------------
   Çıktı: { ty4, ty5 }
     ty4 = "4-Trendyol Komisyon Listesi.xlsx" kolonları
     ty5 = "5-Trendyol Sipariş Listesi.xlsx" kolonları
   İki ayrı Excel indirilir; kolonlar normalize.js ile birebir aynı olduğundan
   indirilen sayfalar doğrudan satırlara çevrilir.

   Env:
     TGO_USER / TGO_PASS
     TGO_LOGIN_URL         (vars: https://partner.tgomarket.com/)
     TGO_ORDERS_URL        sipariş listesi sayfası      -> ty5
     TGO_COMMISSION_URL    komisyon/hakediş sayfası     -> ty4
     TGO_SEL_EMAIL / TGO_SEL_PASS / TGO_SEL_SUBMIT / TGO_SEL_LOGGEDIN
     TGO_SEL_EXPORT        "Excel'e aktar" düğmesi seçicisi

   ⚠️ Seçiciler kuruluma özgü. İlk kurulum:
        npx playwright codegen https://partner.tgomarket.com/
   ==========================================================================*/
'use strict';
const XLSX = require('xlsx');
const { runPortal, clickDownload } = require('./_portal');
const { log } = require('./_util');

const id = 'tgomarket';

function configured() {
  // API adaptörü (tgo-api) yapılandırılmışsa Playwright yolunu kullanma.
  if (process.env.TGO_SELLER_ID && (process.env.TGO_TOKEN || (process.env.TGO_API_KEY && process.env.TGO_API_SECRET))) {
    return false;
  }
  return !!(process.env.TGO_USER && process.env.TGO_PASS);
}

function sheetRows(file) {
  const wb = XLSX.readFile(file, { cellDates: true });
  return XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: null, raw: true });
}

async function fetch({ days = 30, headed = false } = {}) {
  const sel = {
    email: process.env.TGO_SEL_EMAIL || 'input[type="email"], input[name="email"], #email, #username',
    pass: process.env.TGO_SEL_PASS || 'input[type="password"], input[name="password"], #password',
    submit: process.env.TGO_SEL_SUBMIT || 'button[type="submit"]',
    loggedIn: process.env.TGO_SEL_LOGGEDIN || 'aside, nav, header, [class*="sidebar" i]'
  };
  const exportSel = process.env.TGO_SEL_EXPORT ||
    'button:has-text("Excel"), button:has-text("Dışa Aktar"), button:has-text("İndir"), a:has-text("Excel")';

  const out = await runPortal({
    name: id,
    loginUrl: process.env.TGO_LOGIN_URL || process.env.TGO_URL || 'https://partner.tgomarket.com/',
    user: process.env.TGO_USER,
    pass: process.env.TGO_PASS,
    headless: !headed,
    sel,
    async extract(page) {
      const grab = async (url, label) => {
        if (!url) {
          throw new Error(`${id}: ${label} URL'si tanımsız. TGO_ORDERS_URL / TGO_COMMISSION_URL değerlerini .env'e ekleyin.`);
        }
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
        await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
        // TODO: tarih aralığı filtresi (son ${days} gün) panele göre ayarlanır.
        const file = await clickDownload(page, exportSel);
        return sheetRows(file);
      };
      const ty5 = await grab(process.env.TGO_ORDERS_URL, 'sipariş listesi');
      const ty4 = await grab(process.env.TGO_COMMISSION_URL, 'komisyon listesi');
      return { ty4, ty5 };
    }
  });

  log(id, `${out.ty4.length} komisyon · ${out.ty5.length} sipariş satırı`);
  return out;
}

module.exports = { id, configured, fetch };
