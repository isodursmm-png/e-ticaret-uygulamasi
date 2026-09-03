/* ============================================================================
   sources/ticimax.js  —  Ticimax Entegrasyon Web Servisi (SOAP) canlı sipariş
   ----------------------------------------------------------------------------
   Çıktı: { t0, t1 }
     t0 = kalem düzeyi  (0-Ticimax Ürünlü Sipariş Listesi.xlsx kolonları)
     t1 = sipariş düzeyi (1-Ticimax Sipariş.xlsx kolonları)
   Kolon adları normalize.js ile birebir aynı.

   Uç nokta:  https://<site>/Servis/SiparisServis.svc   (SOAP 1.1)
     - SOAPAction: http://tempuri.org/ISiparisServis/SelectSiparis
     - Kimlik    : <UyeKodu> = entegrasyon yetki kodu (panel: Ayarlar > Entegrasyon)
   .env:
     TICIMAX_API_URL   .svc adresi ya da site kökü / herhangi bir site linki
                       (host'tan /Servis/SiparisServis.svc türetilir)
     TICIMAX_CODE      (veya TICIMAX_API_KEY) — UyeKodu

   NOT: WebSiparisFiltre'deki sayısal enum alanları nillable DEĞİL; gönderilmezse
   0'a düşüp her şeyi eler. Bu yüzden filtrede hepsini -1 ("tümü") veriyoruz.
   ==========================================================================*/
'use strict';
const { fmtTR, daysAgo, log } = require('./_util');
const { XMLParser } = require('fast-xml-parser');

const id = 'ticimax';

function apiKey() {
  for (const v of [process.env.TICIMAX_CODE, process.env.TICIMAX_API_KEY, process.env.TKALE_CODE, process.env.TICIMAX_UYE_KODU]) {
    const s = (v || '').trim();
    if (s && !/^<.*>$/.test(s)) return s;
  }
  return '';
}

/** Verilen herhangi bir site URL'sinden SOAP .svc adresini türet. */
function endpoint() {
  const raw = (process.env.TICIMAX_SERVIS_URL || process.env.TICIMAX_API_URL || '').trim();
  let host = 'www.tahtakalespot.com';
  if (raw) {
    const m = raw.match(/SiparisServis\.svc/i);
    if (m) return raw.slice(0, raw.toLowerCase().indexOf('siparisservis.svc') + 'siparisservis.svc'.length);
    try { host = new URL(raw).host || host; } catch { /* yoksay */ }
  }
  return `https://${host}/Servis/SiparisServis.svc`;
}

function configured() {
  return !!apiKey();
}

// SelectSiparisDurumlari canlı enum'undan (2026-09):
const DURUM = {
  0: 'Siparişiniz Alındı', 1: 'Onay Bekliyor', 2: 'Onaylandı', 3: 'Ödeme Bekliyor',
  4: 'Paketleniyor', 5: 'Tedarik Ediliyor', 6: 'Kargoya Verildi', 7: 'Teslim Edildi',
  8: 'İptal Edildi', 9: 'İade Edildi', 10: 'Silinmiş', 11: 'İade Talebi Alındı',
  12: 'İade Ulaştı Ödeme Yapılacak', 13: 'İade Ödemesi Yapıldı', 14: 'Teslimat Öncesi İptal Talebi',
  15: 'İptal Talebi', 16: 'Kısmi İade Talebi', 17: 'Kısmi İade Yapıldı', 18: 'Teslim Edilemedi',
  19: 'Mağazaya Gönderildi', 20: 'Mağazaya Ulaştı', 21: 'Mağazada Teslim Bekliyor', 22: 'Cüzdana İade Yapıldı'
};
const ODEME_TIPI = {
  0: 'Kredi Kartı', 1: 'Havale/EFT', 2: 'Kapıda Ödeme', 3: 'Kredi Kartı',
  4: 'Hediye Çeki', 5: 'Kapıda Kredi Kartı', 6: 'Kapıda Nakit', 7: 'Mail Order', 10: 'Cüzdan'
};

const parser = new XMLParser({ ignoreAttributes: false, removeNSPrefix: true, parseTagValue: true });

/** fast-xml-parser: nillable-nil alan  { '@_nil':'true' }  → undefined */
const v = (x) => (x && typeof x === 'object' && x['@_nil'] !== undefined) ? undefined : x;
const asArray = (x) => (x == null ? [] : Array.isArray(x) ? x : [x]);
const num = (x) => { const n = Number(v(x)); return isFinite(n) ? n : 0; };
const str = (x) => { const s = v(x); return (s == null) ? '' : String(s).trim(); };

function envelope(kod, basISO, sonISO, index, adet) {
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
<tem:s><d:BaslangicIndex>${index}</d:BaslangicIndex><d:KayitSayisi>${adet}</d:KayitSayisi><d:SiralamaDegeri>SiparisTarihi</d:SiralamaDegeri><d:SiralamaYonu>DESC</d:SiralamaYonu></tem:s>
</tem:SelectSiparis></soap:Body></soap:Envelope>`;
}

// Yoğun bir ay (binlerce sipariş + ürün satırları) tek istekte büyük yanıt döndürür.
const CALL_TIMEOUT = Number(process.env.TICIMAX_TIMEOUT_MS) || 240000;

async function soapCall(url, xml) {
  let lastErr;
  for (let i = 0; i < 3; i++) {
    try {
      // NOT: bu modül 'fetch' adlı bir fonksiyon export ediyor; global fetch'i
      // açıkça globalThis üzerinden çağır (aksi halde kendini çağırır → recursion).
      const r = await globalThis.fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'text/xml; charset=utf-8',
          SOAPAction: '"http://tempuri.org/ISiparisServis/SelectSiparis"'
        },
        body: xml,
        signal: AbortSignal.timeout(CALL_TIMEOUT)
      });
      const text = await r.text();
      if (!r.ok) {
        const f = text.match(/<faultstring[^>]*>([^<]+)</i);
        throw new Error(`HTTP ${r.status}${f ? ' — ' + f[1] : ' — ' + text.slice(0, 200)}`);
      }
      return parser.parse(text);
    } catch (e) {
      lastErr = e;
      if (/Hatalı Kullanıcı Kodu/i.test(e.message)) throw new Error('TICIMAX_CODE geçersiz (Hatalı Kullanıcı Kodu).');
      if (i < 2) await new Promise((res) => setTimeout(res, 1500 * (i + 1)));
    }
  }
  throw lastErr;
}

function soapPage(doc) {
  const res = doc && doc.Envelope && doc.Envelope.Body &&
    doc.Envelope.Body.SelectSiparisResponse && doc.Envelope.Body.SelectSiparisResponse.SelectSiparisResult;
  return asArray(res && res.WebSiparis);
}

/** Ticimax SOAP `BaslangicIndex` (sayfalama) BOZUK: index>0 verildiğinde servis
    1 kayıt döndürüyor; geniş tarih aralığında ise sıralı olmayan ~800'lük bir
    kırpılmış küme veriyor. Ama DAR tarih penceresi + index 0 ile o pencerenin
    TAMAMINI tek istekte veriyor (ör. 2026-08 → 4035 sipariş). Bu yüzden:
    index kullanmıyoruz; AY AY geriye gidip her ayı tek istekte çekiyoruz.
    Sipariş No ile tekilleştiriyoruz (pencere sınırındaki olası çakışmalar için). */
/** Aylık pencerelerle Ticimax siparişlerini çeker.
    - onBatch verilmezse: hepsini biriktirip { t0, t1 } döndürür (normal topla akışı)
    - onBatch verilirse: her ayın satırlarını { t0, t1, label } ile callback'e verir,
      biriktirmez (backfill: doğrudan Supabase'e akıt). */
async function fetchRows({ days = 30, onBatch = null } = {}) {
  const url = endpoint();
  const kod = apiKey();
  const fullHistory = !days || days <= 0;
  const floor = fullHistory ? new Date('2015-01-01T00:00:00') : daysAgo(days);
  const now = new Date();
  const isoL = (d) => d.toISOString().slice(0, 19); // WCF yerel dateTime (Z'siz)

  log(id, `uç nokta: ${url}`);
  log(id, `aralık: ${isoL(floor).slice(0, 10)} → ${isoL(now).slice(0, 10)} (ay ay, tek istek/ay)`);

  const KAYIT = 100000;          // bir ayı tek istekte alacak kadar yüksek
  const BOS_AY_DUR = 6;          // 6 ardışık boş ay → geçmişin başına inilmiş say
  // Bellek: ham SOAP nesnelerini biriktirmiyoruz (uzun geçmişte OOM). Her
  // pencerenin yanıtını hemen düz t0/t1 satırına çevirip ham veriyi bırakıyoruz.
  const t0 = [], t1 = [];
  const seen = new Set();
  let bosAy = 0;

  // ilk pencere [bu ayın 1'i, yarın); sonra her adımda bir ay geriye
  let winEnd = new Date(now.getTime() + 86400e3);
  let winStart = new Date(now.getFullYear(), now.getMonth(), 1);

  while (winEnd > floor) {
    if (winStart < floor) winStart = new Date(floor);
    const label = `${isoL(winStart).slice(0, 10)}→${isoL(winEnd).slice(0, 10)}`;

    let doc = await soapCall(url, envelope(kod, isoL(winStart), isoL(winEnd), 0, KAYIT));
    let list = soapPage(doc);
    doc = null;
    const winLen = list.length;

    let fresh = [];
    for (const x of list) {
      const no = str(x.SiparisNo) || str(x.ID) || str(x.SiparisKodu);
      if (no && seen.has(no)) continue;
      if (no) seen.add(no);
      fresh.push(x);
    }
    list = null;

    let yeni;
    if (onBatch) {
      const wt0 = [], wt1 = [];
      toRowsInto(fresh, wt0, wt1);
      yeni = wt1.length;
      fresh = null;
      await onBatch({ t0: wt0, t1: wt1, label });
    } else {
      toRowsInto(fresh, t0, t1);   // ham → düz satır, ardından fresh çöpe
      yeni = fresh.length;
      fresh = null;
    }

    log(id, `[${label}] ${winLen} kayıt / +${yeni} yeni${onBatch ? '' : ` (sipariş ${t1.length} · kalem ${t0.length})`}`);
    if (winLen >= KAYIT) log(id, `⚠ ${isoL(winStart).slice(0, 7)} penceresi ${KAYIT} sınırına dayandı — bölünmesi gerekebilir`);

    // Servis, boş pencerede 0 yerine 1 "hayalet" kayıt döndürebiliyor → <=1 boş say.
    bosAy = winLen <= 1 ? bosAy + 1 : 0;
    if (fullHistory && bosAy >= BOS_AY_DUR) { log(id, `${BOS_AY_DUR} ardışık boş ay — durduruldu`); break; }

    winEnd = winStart;
    winStart = new Date(winStart.getFullYear(), winStart.getMonth() - 1, 1);
  }
  return { t0, t1 };
}

function magazaAdi(...cands) {
  for (const c of cands) {
    const s = str(c);
    if (s && !/^\d+$/.test(s)) return s;
  }
  return 'E-Ticaret Deposu';
}

function toRowsInto(orders, t0, t1) {
  for (const s of orders) {
    const no = str(s.SiparisNo) || str(s.ID) || str(s.SiparisKodu);
    const dSip = str(s.SiparisTarihi);
    const tesl = v(s.TeslimatAdresi) || {};
    const fatur = v(s.FaturaAdresi) || {};
    const sehir = str(tesl.Il) || str(fatur.Il) || null;
    const ilce = str(tesl.Ilce) || str(fatur.Ilce) || null;
    const adres = str(tesl.Adres) || str(tesl.AdresTarifi) || '';
    const kaynak = str(s.SiparisKaynagi) || str(s.Kaynak) || 'Web';
    const durum = DURUM[num(s.Durum)] || str(s.SiparisDurumu) || 'Diğer';
    const ciro = num(s.ToplamTutar) || num(s.OdenenTutar) || num(s.SiparisToplamTutari);
    const kom = num(s.PazaryeriKomisyonTutari) || num(s.KomisyonTutari);
    const teslimGun = str(s.TeslimatGunu);
    const teslimSaat = str(s.TeslimatSaati);
    const mail = str(s.Mail);
    const tel = str(tesl.AliciTelefon) || str(fatur.AliciTelefon);
    const adSoyad = str(s.AdiSoyadi) || [str(s.UyeAdi), str(s.UyeSoyadi)].filter(Boolean).join(' ');
    const magaza = magazaAdi(s.TeslimMagazaKodu, s.MagazaTeslimKodu);
    const odeme = asArray(v(s.Odemeler) && v(s.Odemeler).WebSiparisOdeme)[0] || {};
    const odemeTipi = ODEME_TIPI[num(odeme.OdemeTipi != null ? odeme.OdemeTipi : s.OdemeTipi)] || '';
    const kampanya = asArray(v(s.Kampanyalar) && (v(s.Kampanyalar).WebSiparisKampanya || v(s.Kampanyalar)))
      .map((k) => str(k && (k.Ad || k.Adi || k.KampanyaAdi || k))).filter(Boolean).join(' | ');

    t1.push({
      'Sipariş No': no,
      'Siparis Tarihi': dSip ? fmtTR(dSip) : null,
      'Üyelik Tarihi': null,
      'Teslimat Şehir': sehir,
      'Teslimat İlçe': ilce,
      'Sipariş Kaynağı': kaynak,
      'Ödeme Tutar': ciro,
      'Komisyon Tutarı': kom,
      'Teslimat Günü': teslimGun ? fmtTR(teslimGun) : null,
      'Teslimat Saati': teslimSaat,
      'Üye Mail': mail,
      'Telefon': tel,
      'Siparis Durumu': durum,
      'Mağaza': magaza,
      'Ödeme Tipi': odemeTipi,
      'Üye Adı': adSoyad,
      'Kampanyalar': kampanya,
      'Teslimat Adresi': adres
    });

    for (const u of asArray(v(s.Urunler) && v(s.Urunler).WebSiparisUrun)) {
      const adet = num(u.Adet);
      const birim = num(u.SatisAniIndirimliFiyat) || num(u.SatisAniSatisFiyat) || num(u.Tutar);
      t0.push({
        'Sipariş No': no,
        'Adet': adet,
        'Siparis Tarihi': dSip ? fmtTR(dSip) : null,
        'Teslimat Şehir': sehir,
        'Teslimat İlçe': ilce,
        'Mağaza': magazaAdi(u.MagazaKodu, s.TeslimMagazaKodu),
        'Sipariş Kaynağı': kaynak,
        'Siparis Durumu': durum,
        'Kategori': str(u.KategoriAdi) || 'Diğer',
        'Marka': str(u.MarkaAdi) || 'Diğer',
        'Ürün Adı': str(u.UrunAdi),
        'Adetli Tutar': Math.round(adet * birim * 100) / 100
      });
    }
  }
}

async function fetch(opts) {
  // TICIMAX_FETCH_DAYS: yalnız Ticimax için gün sınırını ezer (0/boş = tüm geçmiş).
  // Tüm geçmişi bir kez çekip sonrası için hızlı tutmak isteyince kullanışlı.
  const ov = process.env.TICIMAX_FETCH_DAYS;
  const days = (ov != null && String(ov).trim() !== '') ? Number(ov) : (opts && opts.days);
  const rows = await fetchRows({ days });
  log(id, `${rows.t1.length} sipariş · ${rows.t0.length} kalem`);
  return rows;
}

module.exports = { id, configured, fetch, fetchRows };
