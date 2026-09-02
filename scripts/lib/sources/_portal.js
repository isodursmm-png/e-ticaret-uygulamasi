/* ============================================================================
   sources/_portal.js  —  Playwright ile panele giriş + veri çıkarma çekirdeği
   ----------------------------------------------------------------------------
   Yemeksepeti ve Trendyol GO (tgomarket) panellerinin resmî self-servis API'si
   yok; bu yüzden gerçek bir tarayıcı ile giriş yapıp raporu indiriyoruz.

   storageState  scripts/.pw-state/<ad>.json  altında saklanır; oturum
   geçerliyse tekrar giriş yapılmaz (2FA'yı azaltır).

   playwright bağımlılığı yalnızca çalışma anında yüklenir (require içeride) —
   böylece bu modülü import etmek, playwright kurulu olmayan ortamda (Vercel
   fonksiyonu) hata vermez.
   ==========================================================================*/
'use strict';
const fs = require('fs');
const path = require('path');
const { log } = require('./_util');

const STATE_DIR = path.join(__dirname, '..', '..', '.pw-state');

function statePath(name) { return path.join(STATE_DIR, `${name}.json`); }

function freshState(name, maxHours = 8) {
  try {
    const st = fs.statSync(statePath(name));
    return (Date.now() - st.mtimeMs) < maxHours * 3600e3;
  } catch { return false; }
}

/**
 * @param {object} o
 * @param {string} o.name        kaynak adı (state dosyası)
 * @param {string} o.loginUrl    giriş sayfası
 * @param {string} o.user
 * @param {string} o.pass
 * @param {object} o.sel         { email, pass, submit, loggedIn } CSS seçicileri
 * @param {(page)=>Promise<any>} o.extract  giriş sonrası veriyi döndüren fonksiyon
 * @param {boolean} [o.headless=true]
 */
async function runPortal(o) {
  const { chromium } = require('playwright');
  if (!fs.existsSync(STATE_DIR)) fs.mkdirSync(STATE_DIR, { recursive: true });

  const browser = await chromium.launch({ headless: o.headless !== false });
  const useState = freshState(o.name) ? { storageState: statePath(o.name) } : {};
  const ctx = await browser.newContext({
    acceptDownloads: true,
    locale: 'tr-TR',
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
    ...useState
  });
  const page = await ctx.newPage();

  try {
    await page.goto(o.loginUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });

    const loggedInSel = o.sel.loggedIn;
    let already = false;
    if (loggedInSel) {
      already = await page.locator(loggedInSel).first().isVisible({ timeout: 4000 }).catch(() => false);
    }

    if (!already) {
      log(o.name, 'giriş yapılıyor…');
      await page.fill(o.sel.email, o.user, { timeout: 30000 });
      await page.fill(o.sel.pass, o.pass, { timeout: 30000 });
      await Promise.all([
        page.waitForLoadState('networkidle', { timeout: 60000 }).catch(() => {}),
        page.click(o.sel.submit, { timeout: 30000 })
      ]);

      // 2FA / OTP ekranı kontrolü
      const otp = await page.locator('input[autocomplete="one-time-code"], input[name*="otp" i], input[name*="code" i]')
        .first().isVisible({ timeout: 3000 }).catch(() => false);
      if (otp) {
        throw new Error(
          `${o.name}: giriş sonrası tek kullanımlık kod (2FA) isteniyor. ` +
          `Otomasyon için: yerelde "node scripts/topla.js --only=${o.name} --headed" ile bir kez elle giriş yapın; ` +
          `oturum scripts/.pw-state/${o.name}.json içine kaydedilir ve sonraki çalıştırmalarda kullanılır.`
        );
      }

      if (loggedInSel) {
        await page.locator(loggedInSel).first().waitFor({ state: 'visible', timeout: 30000 });
      }
      await ctx.storageState({ path: statePath(o.name) });
      log(o.name, 'oturum kaydedildi');
    } else {
      log(o.name, 'mevcut oturum kullanılıyor');
    }

    const data = await o.extract(page);
    return data;
  } finally {
    await ctx.storageState({ path: statePath(o.name) }).catch(() => {});
    await browser.close().catch(() => {});
  }
}

/** Bir "dışa aktar / indir" düğmesine tıklayıp inen dosyayı geçici yola yazar. */
async function clickDownload(page, triggerSel, timeout = 90000) {
  const [dl] = await Promise.all([
    page.waitForEvent('download', { timeout }),
    page.click(triggerSel, { timeout: 30000 })
  ]);
  const tmp = path.join(require('os').tmpdir(), `eta-${Date.now()}-${dl.suggestedFilename() || 'rapor.xlsx'}`);
  await dl.saveAs(tmp);
  return tmp;
}

module.exports = { runPortal, clickDownload, statePath };
