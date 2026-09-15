/* ============================================================================
   mail-service.js — "Grafiği gönder" için yerel e-posta köprüsü
   ----------------------------------------------------------------------------
   Pano (public/app.js > mailBar) bir grafiği PNG'ye çevirip
   http://localhost:8788/gonder adresine POST eder. Bu betik o isteği alıp
   Gmail SMTP üzerinden (nodemailer) e-postayı gönderir.

   Çalıştırma (proje kökünden):   node _kaynak/mail-service.js
   Gerekli .env değişkenleri:
     MAIL_USER          gönderici Gmail adresi (örn. secenbordro@gmail.com)
     MAIL_APP_PASSWORD  o hesabın Google "Uygulama Şifresi" (16 haneli)
   ========================================================================== */
require('dotenv').config();

const http = require('http');
const nodemailer = require('nodemailer');

const PORT = 8788;
const MAIL_USER = process.env.MAIL_USER;
const MAIL_APP_PASSWORD = process.env.MAIL_APP_PASSWORD;
const MAX_BODY = 8 * 1024 * 1024; // 8 MB — grafik PNG'si için yeterli üst sınır

const transporter = (MAIL_USER && MAIL_APP_PASSWORD)
  ? nodemailer.createTransport({ service: 'gmail', auth: { user: MAIL_USER, pass: MAIL_APP_PASSWORD } })
  : null;

function withCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}
function sendJSON(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(body);
}
function esc(s) { return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

const server = http.createServer((req, res) => {
  withCors(res);
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
  if (req.method !== 'POST' || req.url !== '/gonder') { sendJSON(res, 404, { ok: false, hata: 'bulunamadı' }); return; }

  let size = 0;
  const chunks = [];
  req.on('data', (c) => {
    size += c.length;
    if (size > MAX_BODY) { req.destroy(); }
    else chunks.push(c);
  });
  req.on('end', async () => {
    if (size > MAX_BODY) { sendJSON(res, 413, { ok: false, hata: 'grafik çok büyük' }); return; }
    let body;
    try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
    catch (e) { sendJSON(res, 400, { ok: false, hata: 'geçersiz istek gövdesi' }); return; }

    const { to, konu, png, ozet } = body || {};
    if (!to || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) { sendJSON(res, 400, { ok: false, hata: 'geçersiz e-posta' }); return; }
    if (!png || !/^data:image\/png;base64,/.test(png)) { sendJSON(res, 400, { ok: false, hata: 'grafik verisi eksik' }); return; }
    if (!transporter) { sendJSON(res, 500, { ok: false, hata: 'MAIL_USER / MAIL_APP_PASSWORD tanımlı değil (.env)' }); return; }

    const base64 = png.slice(png.indexOf(',') + 1);
    const html = '<p>' + esc(ozet || konu || 'E-Ticaret Analizleri grafiği') + '</p>' +
      '<img src="cid:grafik" alt="grafik" style="max-width:100%">';

    try {
      await transporter.sendMail({
        from: 'E-Ticaret Analizleri <' + MAIL_USER + '>',
        to,
        subject: konu || 'E-Ticaret Analizleri',
        html,
        attachments: [{ filename: 'grafik.png', content: Buffer.from(base64, 'base64'), cid: 'grafik' }]
      });
      sendJSON(res, 200, { ok: true });
    } catch (e) {
      sendJSON(res, 502, { ok: false, hata: 'Gönderim başarısız: ' + e.message });
    }
  });
});

server.listen(PORT, () => {
  console.log('mail-service: http://localhost:' + PORT + ' (POST /gonder)');
  if (!transporter) console.warn('UYARI: MAIL_USER / MAIL_APP_PASSWORD .env içinde tanımlı değil — gönderim başarısız olacak.');
  else console.log('Gönderici: ' + MAIL_USER);
});
