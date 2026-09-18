/* ============================================================================
   ticimax-tablo-doldur.js  —  Ticimax SOAP API'sinden 2025-01-01 → bugün
   arasındaki TÜM siparişleri, API'nin döndürdüğü TAM (ham) nesneyle birlikte
   public.ticimax tablosuna doldurur.
   ----------------------------------------------------------------------------
   raw_orders/analytics_payload'a (canlı pano) DOKUNMAZ. Önce supabase/
   schema.sql'deki ticimax bloğunu Supabase SQL Editor'da çalıştırıp tabloyu
   oluşturun.

   Ticimax SOAP servisinin BaslangicIndex sayfalaması bozuk olduğundan
   (scripts/lib/sources/ticimax.js'teki notla aynı sebep), AY AY, tek istekte
   çekiliyor — dar pencere + index 0 bir ayın TAMAMINI güvenilir döndürüyor.

   Kullanım:
     node scripts/ticimax-tablo-doldur.js --run
   ========================================================================== */
'use strict';
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const { XMLParser } = require('fast-xml-parser');

const kod = (process.env.TICIMAX_CODE || process.env.TICIMAX_API_KEY || '').trim();
const rawUrl = (process.env.TICIMAX_SERVIS_URL || process.env.TICIMAX_API_URL || '').trim();
let host = 'www.tahtakalespot.com';
try { const m = rawUrl.match(/SiparisServis\.svc/i); if (!m) host = new URL(rawUrl).host || host; } catch (e) {}
const url = rawUrl && /SiparisServis\.svc/i.test(rawUrl) ? rawUrl : `https://${host}/Servis/SiparisServis.svc`;

const CALL_TIMEOUT = Number(process.env.TICIMAX_TIMEOUT_MS) || 240000;
const parser = new XMLParser({ ignoreAttributes: false, removeNSPrefix: true, parseTagValue: true });
const asArray = (x) => (x == null ? [] : Array.isArray(x) ? x : [x]);

const DURUM = {
  0: 'Siparişiniz Alındı', 1: 'Onay Bekliyor', 2: 'Onaylandı', 3: 'Ödeme Bekliyor',
  4: 'Paketleniyor', 5: 'Tedarik Ediliyor', 6: 'Kargoya Verildi', 7: 'Teslim Edildi',
  8: 'İptal Edildi', 9: 'İade Edildi', 10: 'Silinmiş', 11: 'İade Talebi Alındı',
  12: 'İade Ulaştı Ödeme Yapılacak', 13: 'İade Ödemesi Yapıldı', 14: 'Teslimat Öncesi İptal Talebi',
  15: 'İptal Talebi', 16: 'Kısmi İade Talebi', 17: 'Kısmi İade Yapıldı', 18: 'Teslim Edilemedi',
  19: 'Mağazaya Gönderildi', 20: 'Mağazaya Ulaştı', 21: 'Mağazada Teslim Bekliyor', 22: 'Cüzdana İade Yapıldı'
};

/** { '@_nil': 'true' } → null (derinlemesine) — bilgi kaybı yok, yalnızca okunabilirlik. */
function cleanNil(x) {
  if (x && typeof x === 'object') {
    if (!Array.isArray(x) && Object.keys(x).length === 1 && x['@_nil'] !== undefined) return null;
    if (Array.isArray(x)) return x.map(cleanNil);
    const out = {};
    for (const k of Object.keys(x)) out[k] = cleanNil(x[k]);
    return out;
  }
  return x;
}

function envelope(basISO, sonISO) {
  return `<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/" xmlns:tem="http://tempuri.org/" xmlns:d="http://schemas.datacontract.org/2004/07/">
<soap:Body><tem:SelectSiparis><tem:UyeKodu>${kod}</tem:UyeKodu>
<tem:f>
 <d:EntegrasyonAktarildi>-1</d:EntegrasyonAktarildi>
 <d:IptalEdilmisUrunler>false</d:IptalEdilmisUrunler>
 <d:KampanyaGetir>false</d:KampanyaGetir>
 <d:KargoFirmaID>-1</d:KargoFirmaID>
 <d:OdemeDurumu>-1</d:OdemeDurumu>
 <d:OdemeGetir>true</d:OdemeGetir>
 <d:OdemeTipi>-1</d:OdemeTipi>
 <d:PaketlemeDurumu>-1</d:PaketlemeDurumu>
 <d:PazaryeriIhracat>-1</d:PazaryeriIhracat>
 <d:SiparisDurumu>-1</d:SiparisDurumu>
 <d:SiparisID>-1</d:SiparisID>
 <d:SiparisTarihiBas>${basISO}</d:SiparisTarihiBas>
 <d:SiparisTarihiSon>${sonISO}</d:SiparisTarihiSon>
 <d:TedarikciID>-1</d:TedarikciID>
 <d:TeslimatMagazaID>-1</d:TeslimatMagazaID>
 <d:UrunGetir>true</d:UrunGetir>
 <d:UyeID>-1</d:UyeID>
</tem:f>
<tem:s><d:BaslangicIndex>0</d:BaslangicIndex><d:KayitSayisi>100000</d:KayitSayisi><d:SiralamaDegeri>SiparisTarihi</d:SiralamaDegeri><d:SiralamaYonu>DESC</d:SiralamaYonu></tem:s>
</tem:SelectSiparis></soap:Body></soap:Envelope>`;
}

async function soapCall(basISO, sonISO) {
  let lastErr;
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'text/xml; charset=utf-8', SOAPAction: '"http://tempuri.org/ISiparisServis/SelectSiparis"' },
        body: envelope(basISO, sonISO),
        signal: AbortSignal.timeout(CALL_TIMEOUT)
      });
      const text = await r.text();
      if (!r.ok) {
        const f = text.match(/<faultstring[^>]*>([^<]+)</i);
        throw new Error(`HTTP ${r.status}${f ? ' — ' + f[1] : ' — ' + text.slice(0, 200)}`);
      }
      const doc = parser.parse(text);
      const res = doc && doc.Envelope && doc.Envelope.Body &&
        doc.Envelope.Body.SelectSiparisResponse && doc.Envelope.Body.SelectSiparisResponse.SelectSiparisResult;
      return asArray(res && res.WebSiparis);
    } catch (e) {
      lastErr = e;
      if (i < 2) await new Promise((res) => setTimeout(res, 2000 * (i + 1)));
    }
  }
  throw lastErr;
}

function monthWindows(fromDate, toDate) {
  const out = [];
  let start = new Date(fromDate.getFullYear(), fromDate.getMonth(), 1);
  while (start < toDate) {
    const end = new Date(start.getFullYear(), start.getMonth() + 1, 1);
    out.push([start < fromDate ? fromDate : start, end > toDate ? toDate : end]);
    start = end;
  }
  return out;
}
const isoL = (d) => d.toISOString().slice(0, 19);

async function main() {
  if (!kod) throw new Error('.env: TICIMAX_CODE gerekli.');
  const run = process.argv.includes('--run');
  const URL_ = process.env.SUPABASE_URL, KEY = process.env.SUPABASE_SERVICE_ROLE;
  if (!URL_ || !KEY) throw new Error('.env: SUPABASE_URL ve SUPABASE_SERVICE_ROLE gerekli.');
  const sb = createClient(URL_, KEY, { auth: { persistSession: false } });

  const from = new Date('2025-01-01T00:00:00');
  const to = new Date(Date.now() + 86400e3); // yarın (bugünü dahil et)
  const windows = monthWindows(from, to);
  console.log(`Aralık: ${isoL(from).slice(0, 10)} → bugün (${windows.length} ay, ay ay tek istek)`);
  console.log(run ? '⚠ GERÇEK YAZMA MODU (--run)' : 'ÖNİZLEME — yazılmayacak (--run ile çalıştırın)');

  let totalFound = 0, totalWritten = 0;
  const seen = new Set();
  const failedWindows = [];

  for (let i = 0; i < windows.length; i++) {
    const [ws, we] = windows[i];
    const label = `${isoL(ws).slice(0, 10)}→${isoL(we).slice(0, 10)}`;
    process.stdout.write(`[${i + 1}/${windows.length}] ${label} … `);
    let list;
    try {
      list = await soapCall(isoL(ws), isoL(we));
    } catch (e) {
      console.log(`HATA: ${e.message}`);
      failedWindows.push(label);
      continue;
    }
    totalFound += list.length;
    console.log(`${list.length} sipariş`);

    if (!run || !list.length) continue;

    const rows = [];
    for (const s of list) {
      const no = String(s.SiparisNo || s.ID || s.SiparisKodu || '').trim();
      if (!no || seen.has(no)) continue;
      seen.add(no);
      const durumNum = Number(s.Durum);
      rows.push({
        siparis_no: no,
        siparis_id: Number.isFinite(Number(s.ID)) ? Number(s.ID) : null,
        order_date: s.SiparisTarihi ? new Date(s.SiparisTarihi).toISOString() : null,
        durum: DURUM[durumNum] || (s.SiparisDurumu != null ? String(s.SiparisDurumu) : 'Diğer'),
        data: cleanNil(s)
      });
    }
    try {
      for (let j = 0; j < rows.length; j += 150) {
        const part = rows.slice(j, j + 150);
        let ok = false, lastErr;
        for (let t = 0; t < 4 && !ok; t++) {
          try {
            const { error } = await sb.from('ticimax').upsert(part, { onConflict: 'siparis_no' });
            if (error) throw new Error(error.message);
            ok = true;
          } catch (e) {
            lastErr = e;
            if (t < 3) await new Promise((res) => setTimeout(res, 2000 * (t + 1)));
          }
        }
        if (!ok) throw new Error('upsert: ' + (lastErr && lastErr.message));
        totalWritten += part.length;
        process.stdout.write(`  yazılan ${totalWritten}\r`);
      }
    } catch (e) {
      console.log(`\n  ⚠ ${label} yazılırken hata: ${e.message} — bu ay atlandı, sonda listelenecek`);
      failedWindows.push(label);
    }
  }

  process.stdout.write('\n');
  console.log(`\nToplam bulunan: ${totalFound} sipariş (benzersiz: ${seen.size}).`);
  if (run) console.log(`Toplam yazılan: ${totalWritten} satır.`);
  else console.log('Gerçekten yazmak için: node scripts/ticimax-tablo-doldur.js --run');
  if (failedWindows.length) {
    console.log(`\n⚠ ${failedWindows.length} ay başarısız oldu, tekrar çalıştırıp tamamlayın (upsert idempotent):`);
    failedWindows.forEach((w) => console.log('  ', w));
  }
}

main()
  .then(() => { process.exitCode = 0; })
  .catch((e) => { console.error('\n✕', e.message || e); process.exitCode = 1; })
  .finally(() => { setTimeout(() => process.exit(process.exitCode || 0), 500).unref(); });
