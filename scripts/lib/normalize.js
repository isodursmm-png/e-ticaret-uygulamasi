/* E-TİCARET ANALİZLERİ — ortak normalizasyon çekirdeği
   Girdi: xlsx sayfalarıyla AYNI kolon adlarına sahip satır nesnesi dizileri
     { t0, t1, ys, ty4, ty5 }
       t0  = Ticimax ürünlü sipariş listesi (kalem düzeyi)
       t1  = Ticimax sipariş (sipariş düzeyi)
       ys  = Yemeksepeti sipariş listesi
       ty4 = Trendyol komisyon listesi (sipariş düzeyi)
       ty5 = Trendyol sipariş listesi (kalem düzeyi)
   Çıktı: buildPayload() -> PAYLOAD (pano HTML'ine gömülen nesne)
   Not: xlsx yolu (build.js) ve API yolu (topla.js) ikisi de bunu kullanır. */

const fs = require('fs');

// ---------- sayısal / tarih ----------
const num = (v) => {
  if (v == null || v === '') return 0;
  if (typeof v === 'number') return isFinite(v) ? v : 0;
  let s = String(v).trim();
  if (s.includes(',') && s.includes('.')) s = s.replace(/\./g, '').replace(',', '.');
  else if (s.includes(',')) s = s.replace(',', '.');
  const n = parseFloat(s);
  return isNaN(n) ? 0 : n;
};
const r2 = (n) => Math.round(n * 100) / 100;
const WD = ['Pazar', 'Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi'];
const pad = (n) => (n < 10 ? '0' + n : '' + n);
const fmtDate = (d) => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());

function parseTR(v) {
  if (!v) return null;
  if (v instanceof Date) return isNaN(v) ? null : v;
  const m = String(v).match(/(\d{1,2})\.(\d{1,2})\.(\d{4})(?:[ T](\d{1,2}):(\d{2}))?/);
  if (!m) return null;
  const d = new Date(+m[3], +m[2] - 1, +m[1], m[4] ? +m[4] : 0, m[5] ? +m[5] : 0);
  return isNaN(d) ? null : d;
}
function parseAny(v) {
  if (!v) return null;
  if (v instanceof Date) return isNaN(v) ? null : v;
  let s = String(v).trim();
  if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}/.test(s)) {
    const d = new Date(s.replace(' ', 'T'));
    return isNaN(d) ? null : d;
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) { const d = new Date(s + 'T00:00:00'); return isNaN(d) ? null : d; }
  return parseTR(s);
}

// ---------- metin normalizasyonu ----------
// STORE_NAMES env: "ni1e=Güzeloba; us58=Liman; 33841=Merkez"  (kod → dostane ad)
// Ortam değişkeni boşsa repoya gömülü varsayılan eşleme kullanılır (store-names.js).
let DEFAULT_STORE_NAMES = '';
try { ({ DEFAULT_STORE_NAMES } = require('./store-names')); } catch (e) { /* tarayıcı kopyasında yok */ }
const STORE_MAP = (() => {
  const m = {};
  const envVal = (typeof process !== 'undefined' && process.env && process.env.STORE_NAMES) || '';
  String(envVal.trim() ? envVal : DEFAULT_STORE_NAMES)
    .split(/[;\n]+/).forEach((pair) => {
      const i = pair.indexOf('=');
      if (i > 0) { const k = pair.slice(0, i).trim().toLowerCase(); const v = pair.slice(i + 1).trim(); if (k && v) m[k] = v; }
    });
  return m;
})();
const normStore = (s) => {
  if (!s) return 'Bilinmiyor';
  const raw = String(s).trim();
  const lc = raw.toLowerCase();
  // env eşlemesi: ham değer bir koda birebir eşit ya da onu bir kelime olarak içeriyorsa
  const toks = lc.split(/[\s,.;·|/\\()\-]+/).filter(Boolean);
  for (const k of Object.keys(STORE_MAP)) {
    if (lc === k || toks.includes(k)) return STORE_MAP[k];
  }
  let x = raw.replace(/Tahtakale\s+(Spot\s+|Market\s+)?/gi, '').replace(/\s+Şubesi$/i, '').trim();
  if (/külliye/i.test(x)) x = 'Külliye';
  if (/e-?ticaret deposu/i.test(x)) x = 'E-Ticaret Deposu';
  return x || 'Bilinmiyor';
};
const normCity = (s) => {
  if (!s) return null;
  let x = String(s).trim().replace(/\(.*?\)/g, '').trim();
  if (/^mersin/i.test(x) || /içel/i.test(x)) x = 'Mersin';
  if (/^afyon/i.test(x)) x = 'Afyonkarahisar';
  return x || null;
};
const normStatus = (s) => {
  const x = String(s == null ? '' : s).trim().toLocaleLowerCase('tr');
  if (x.includes('teslim edildi') || x === 'delivered' || x === 'teslimedildi') return 'Teslim Edildi';
  if (x.includes('iptal') || x === 'cancelled' || x === 'canceled' || x === 'iptaledildi') return 'İptal';
  if (x.includes('iade') || x === 'returned' || x === 'iadeedildi') return 'İade';
  return 'Diğer';
};
const srcNorm = (s) => {
  const x = String(s || '').trim();
  if (/ios/i.test(x)) return 'iOS';
  if (/android/i.test(x)) return 'Android';
  if (/web/i.test(x)) return 'Web';
  return null;
};

// ---------- coğrafya ----------
const REGION = {
  'Antalya': 'Akdeniz', 'Mersin': 'Akdeniz', 'Isparta': 'Akdeniz', 'Burdur': 'Akdeniz',
  'Adana': 'Akdeniz', 'Hatay': 'Akdeniz', 'Osmaniye': 'Akdeniz', 'Kahramanmaraş': 'Akdeniz', 'Kilis': 'Akdeniz',
  'İzmir': 'Ege', 'Aydın': 'Ege', 'Muğla': 'Ege', 'Denizli': 'Ege', 'Manisa': 'Ege',
  'Afyonkarahisar': 'Ege', 'Kütahya': 'Ege', 'Uşak': 'Ege',
  'İstanbul': 'Marmara', 'Bursa': 'Marmara', 'Kocaeli': 'Marmara', 'Balıkesir': 'Marmara',
  'Çanakkale': 'Marmara', 'Tekirdağ': 'Marmara', 'Edirne': 'Marmara', 'Kırklareli': 'Marmara',
  'Yalova': 'Marmara', 'Bilecik': 'Marmara', 'Sakarya': 'Marmara',
  'Ankara': 'İç Anadolu', 'Konya': 'İç Anadolu', 'Eskişehir': 'İç Anadolu', 'Kayseri': 'İç Anadolu',
  'Sivas': 'İç Anadolu', 'Yozgat': 'İç Anadolu', 'Aksaray': 'İç Anadolu', 'Karaman': 'İç Anadolu',
  'Kırıkkale': 'İç Anadolu', 'Kırşehir': 'İç Anadolu', 'Nevşehir': 'İç Anadolu', 'Niğde': 'İç Anadolu', 'Çankırı': 'İç Anadolu',
  'Samsun': 'Karadeniz', 'Trabzon': 'Karadeniz', 'Ordu': 'Karadeniz', 'Rize': 'Karadeniz', 'Giresun': 'Karadeniz',
  'Erzurum': 'Doğu Anadolu', 'Van': 'Doğu Anadolu', 'Malatya': 'Doğu Anadolu', 'Elazığ': 'Doğu Anadolu', 'Ağrı': 'Doğu Anadolu',
  'Gaziantep': 'Güneydoğu Anadolu', 'Şanlıurfa': 'Güneydoğu Anadolu', 'Diyarbakır': 'Güneydoğu Anadolu',
  'Mardin': 'Güneydoğu Anadolu', 'Batman': 'Güneydoğu Anadolu'
};
const regionOf = (il) => REGION[il] || (il ? 'Diğer' : null);

const CENTROID = {
  'Antalya': [30.7, 36.9], 'Mersin': [34.0, 36.9], 'Isparta': [30.55, 37.77], 'Burdur': [30.1, 37.5],
  'İstanbul': [28.98, 41.02], 'Ankara': [32.85, 39.7], 'İzmir': [27.3, 38.3], 'Aydın': [27.84, 37.8],
  'Afyonkarahisar': [30.54, 38.76], 'Konya': [32.6, 37.9], 'Denizli': [29.1, 37.7], 'Muğla': [28.4, 37.1],
  'Adana': [35.32, 37.0], 'Bursa': [29.06, 40.19], 'Eskişehir': [30.9, 39.6], 'Kayseri': [35.49, 38.7],
  'Gaziantep': [37.38, 37.07], 'Manisa': [27.9, 38.7], 'Balıkesir': [27.9, 39.65], 'Kocaeli': [29.92, 40.77],
  'Hatay': [36.2, 36.3], 'Sakarya': [30.4, 40.75], 'Samsun': [36.3, 41.2], 'Trabzon': [39.7, 40.9],
  'Kütahya': [29.98, 39.42], 'Uşak': [29.4, 38.68], 'Nevşehir': [34.7, 38.6], 'Kırıkkale': [33.5, 39.85],
  'Çanakkale': [26.9, 40.0], 'Tekirdağ': [27.5, 41.0], 'Yalova': [29.28, 40.65], 'Bilecik': [30.0, 40.15],
  'Karaman': [33.2, 37.18], 'Niğde': [34.68, 37.97], 'Aksaray': [34.03, 38.37], 'Osmaniye': [36.25, 37.07],
  'Kahramanmaraş': [36.92, 37.58], 'Şanlıurfa': [38.8, 37.16], 'Diyarbakır': [40.2, 37.9], 'Van': [43.4, 38.5],
  'Erzurum': [41.28, 39.9], 'Malatya': [38.3, 38.35], 'Elazığ': [39.22, 38.68], 'Sivas': [37.0, 39.75],
  'Ordu': [37.9, 40.98], 'Giresun': [38.4, 40.9], 'Rize': [40.52, 41.02], 'Mardin': [40.74, 37.31],
  'Batman': [41.13, 37.88], 'Ağrı': [43.05, 39.72], 'Yozgat': [34.8, 39.82], 'Çankırı': [33.6, 40.6],
  'Kırşehir': [34.16, 39.15], 'Edirne': [26.56, 41.68], 'Kırklareli': [27.22, 41.73]
};

// yemeksepeti / trendyol-go mağaza -> [ilçe, il]
const YS_LOC = {
  'Erciyes': ['Kepez', 'Antalya'], 'Varsak': ['Kepez', 'Antalya'], 'Oba': ['Alanya', 'Antalya'],
  'Liman': ['Konyaaltı', 'Antalya'], 'Külliye': ['Manavgat', 'Antalya'], 'Güzeloba': ['Muratpaşa', 'Antalya'],
  'Yeşilbayır': ['Döşemealtı', 'Antalya'], 'Karaağaç': ['Kepez', 'Antalya'], 'Kumluca': ['Kumluca', 'Antalya'],
  'Manavgat': ['Manavgat', 'Antalya'], 'Alanya': ['Alanya', 'Antalya']
};

const ORD_COLS = ['id', 'ch', 'dt', 'ds', 'hr', 'wd', 'st', 'city', 'ilce', 'region', 'store', 'src', 'srcGrp', 'pay', 'ciro', 'net', 'kom', 'qty', 'cust', 'ck', 'email', 'phone', 'ms', 'isNew', 'camp', 'dds', 'slot', 'dh', 'lead', 'addr', 'cr'];
const ITM_COLS = ['ch', 'ds', 'city', 'ilce', 'store', 'src', 'st', 'cat', 'brand', 'prod', 'qty', 'amt'];

function payFromTicimax(x) {
  x = String(x || '').trim();
  if (/kapıda.*kredi/i.test(x)) return 'Kapıda Kredi Kartı';
  if (/kapıda.*nakit/i.test(x)) return 'Kapıda Nakit';
  if (/kredi/i.test(x)) return 'Kredi Kartı';
  if (/nakit/i.test(x)) return 'Nakit';
  return x || 'Bilinmiyor';
}

/* ==================== ANA ==================== */
/* opts.itmMonthly = true → kalem (ITM) satırları gün yerine AY bazında toplanır
   (tüm geçmiş payload'ı için boyutu düşürür; sipariş satırları gün kalır). */
function buildPayload({ t0 = [], t1 = [], ys = [], ty4 = [], ty5 = [] } = {}, opts = {}) {
  const itmMonthly = !!opts.itmMonthly;
  const ORD = [];
  const ITM = [];

  // Ticimax: sipariş no -> toplam adet (ürün dosyasından)
  const ticQty = new Map();
  for (const r of t0) {
    const no = r['Sipariş No'];
    ticQty.set(no, (ticQty.get(no) || 0) + num(r['Adet']));
  }

  // ---- Ticimax siparişleri ----
  for (const r of t1) {
    const d = parseTR(r['Siparis Tarihi']);
    const ms = parseTR(r['Üyelik Tarihi']);
    const city = normCity(r['Teslimat Şehir']) || 'Antalya';
    const src = srcNorm(r['Sipariş Kaynağı']) || 'Web';
    const ciro = num(r['Ödeme Tutar']);
    const kom = num(r['Komisyon Tutarı']);
    const dd = parseTR(r['Teslimat Günü']);
    let slot = String(r['Teslimat Saati'] || '').trim();
    let dh = null, lead = null;
    const sm = slot.match(/(\d{1,2})[:.]?(\d{2})?\s*-\s*(\d{1,2})/);
    if (dd && sm) {
      dh = +sm[1];
      const pdt = new Date(dd.getFullYear(), dd.getMonth(), dd.getDate(), dh, 0);
      if (d) lead = Math.round((pdt - d) / 60000);
    }
    const email = String(r['Üye Mail'] || '').trim().toLowerCase();
    const phone = String(r['Telefon'] || '').trim();
    ORD.push({
      id: 'TIC-' + r['Sipariş No'], ch: 'Ticimax',
      dt: d ? d.toISOString() : null, ds: d ? fmtDate(d) : null, hr: d ? d.getHours() : null,
      wd: d ? WD[d.getDay()] : null,
      st: normStatus(r['Siparis Durumu']), city, ilce: (String(r['Teslimat İlçe'] || '').trim()) || null,
      region: regionOf(city), store: normStore(r['Mağaza']), src, srcGrp: src, pay: payFromTicimax(r['Ödeme Tipi']),
      ciro: r2(ciro), net: r2(ciro - Math.abs(kom)), kom: r2(Math.abs(kom)),
      qty: Math.round(ticQty.get(r['Sipariş No']) || 0),
      cust: (String(r['Üye Adı'] || '').trim()) || null, ck: email || phone || null,
      email: email || null, phone: phone || null,
      ms: ms ? fmtDate(ms) : null,
      camp: (String(r['Kampanyalar'] || '').split('|')[0].trim()) || null,
      dds: dd ? fmtDate(dd) : null, slot: slot || null, dh, lead,
      addr: (String(r['Teslimat Adresi'] || '').trim()) || null, cr: null
    });
  }
  for (const r of t0) {
    const d = parseTR(r['Siparis Tarihi']);
    const city = normCity(r['Teslimat Şehir']) || 'Antalya';
    ITM.push({
      ch: 'Ticimax', ds: d ? fmtDate(d) : null, city, ilce: (String(r['Teslimat İlçe'] || '').trim()) || null,
      store: normStore(r['Mağaza']), src: srcNorm(r['Sipariş Kaynağı']) || 'Web',
      st: normStatus(r['Siparis Durumu']),
      cat: (String(r['Kategori'] || '').trim()) || 'Diğer', brand: (String(r['Marka'] || '').trim()) || 'Diğer',
      prod: String(r['Ürün Adı'] || '').trim(), qty: num(r['Adet']), amt: r2(num(r['Adetli Tutar']))
    });
  }

  // ---- Yemeksepeti ----
  for (const r of ys) {
    const d = parseAny(r['Kabul Edilme Zamanı']) || parseAny(r['Siparişin Alındığı Tarih']);
    const del = parseAny(r['Teslimat zamanı']) || parseAny(r['Sipariş Teslim Tarihi']);
    const store = normStore(r['Mağaza']);
    // Önce satırdaki gerçek şehir/ilçe (API yolu), yoksa mağaza adından tahmin.
    const cityCol = normCity(r['Teslimat Şehir']);
    const ilceCol = (String(r['Teslimat İlçe'] || '').trim()) || null;
    const loc = cityCol ? [ilceCol, cityCol] : (YS_LOC[store] || [null, 'Antalya']);
    const pay = (() => {
      const x = String(r['Ödeme Yöntemi'] || '').trim();
      if (/online/i.test(x)) return 'Online Kart';
      if (/kapıda/i.test(x)) return 'Kapıda';
      return 'Bilinmiyor';
    })();
    const ciro = num(r['Toplam']);
    const kom = num(r['Komisyon']);
    const net = num(r['Tahmini Kazanç']) || r2(ciro - Math.abs(kom));
    let lead = null;
    if (d && del) lead = Math.round((del - d) / 60000);
    let q = 0;
    const prods = [];
    String(r['Ürünler'] || '').split(/\s*,\s*/).forEach((p) => {
      const m = p.match(/^([\d.,]+)\s+(.*)$/);
      if (m) { const n = num(m[1]); q += n; prods.push([n, m[2].trim()]); }
      else if (p.trim()) { q += 1; prods.push([1, p.trim()]); }
    });
    const st = normStatus(r['Sipariş Durumu']);
    ORD.push({
      id: 'YS-' + r['Sipariş No'], ch: 'Yemeksepeti',
      dt: d ? d.toISOString() : null, ds: d ? fmtDate(d) : null, hr: d ? d.getHours() : null,
      wd: d ? WD[d.getDay()] : null,
      st, city: loc[1], ilce: loc[0], region: regionOf(loc[1]),
      store, src: 'Yemeksepeti App', srcGrp: 'Yemeksepeti', pay,
      ciro: r2(ciro), net: r2(net), kom: r2(Math.abs(kom)), qty: Math.round(q),
      cust: null, ck: null, email: null, phone: null, ms: null,
      camp: null, dds: del ? fmtDate(del) : null, slot: null,
      dh: del ? del.getHours() : null, lead, addr: null,
      cr: st === 'İptal' ? (String(r['İptal Sebebi'] || '').replace(/^İptal Sebebi:\s*/i, '').trim() || 'Belirtilmemiş') : null
    });
    for (const [n, nm] of prods) {
      ITM.push({
        ch: 'Yemeksepeti', ds: d ? fmtDate(d) : null, city: loc[1], ilce: loc[0], store,
        src: 'Yemeksepeti App', st, cat: 'Diğer', brand: 'Diğer', prod: nm, qty: n, amt: 0
      });
    }
  }

  // ---- Trendyol (Go / Marketplace) ----
  const tyOrd = new Map();
  for (const r of ty5) {
    const no = String(r['Sipariş Numarası']);
    const d = parseAny(r['Sipariş Tarihi']);
    const del = parseAny(r['Teslim Tarihi']);
    let o = tyOrd.get(no);
    if (!o) { o = { qty: 0, city: normCity(r['İl']), ilce: (String(r['İlçe'] || '').trim()) || null, store: normStore(r['Market Adı']), d, del }; tyOrd.set(no, o); }
    o.qty += num(r['Adet']);
    if (!o.d && d) o.d = d;
    if (!o.del && del) o.del = del;
    ITM.push({
      ch: 'Trendyol', ds: d ? fmtDate(d) : null, city: normCity(r['İl']), ilce: (String(r['İlçe'] || '').trim()) || null,
      store: normStore(r['Market Adı']), src: 'Trendyol App', st: normStatus(r['Sipariş Statüsü'] || 'Teslim Edildi'),
      cat: (String(r['Kategori'] || '').trim()) || 'Diğer', brand: (String(r['Marka'] || '').trim()) || 'Diğer',
      prod: String(r['Ürün Adı'] || '').trim(), qty: num(r['Adet']), amt: r2(num(r['Satış Tutarı']))
    });
  }
  for (const r of ty4) {
    const no = String(r['Sipariş No']);
    const j = tyOrd.get(no);
    let city = j ? j.city : null, ilce = j ? j.ilce : null, store = normStore(r['Mağaza Adı']);
    if (!city) {
      const am = String(r['Mağaza Adresi'] || '').match(/(\d{5})\s+([^,\/]+)\/\s*([A-Za-zÇĞİÖŞÜçğıöşü ]+)\s*$/);
      if (am) { ilce = ilce || am[2].trim(); city = normCity(am[3]); }
    }
    city = city || 'Antalya';
    // xlsx'te 'Sipariş Tarihi ve Saati' bozuk sabit -> kullanma. API yolu 'Sipariş Tarihi' verir.
    const d = j ? j.d : parseAny(r['Sipariş Tarihi']);
    const del = j ? j.del : null;
    const ciro = num(r['Tutar']);
    const kom = num(r['Komisyon']);
    const net = num(r['Satıcı Hakediş']) || r2(ciro - Math.abs(kom));
    let lead = null;
    if (d && del) lead = Math.round((del - d) / 60000);
    ORD.push({
      id: 'TY-' + no, ch: 'Trendyol',
      dt: d ? d.toISOString() : null, ds: d ? fmtDate(d) : null, hr: d ? d.getHours() : null,
      wd: d ? WD[d.getDay()] : null,
      st: normStatus(r['Statü']), city, ilce, region: regionOf(city),
      store, src: 'Trendyol App', srcGrp: 'Trendyol',
      pay: (String(r['Ödeme Yöntemi'] || '').trim() || 'Bilinmiyor'),
      ciro: r2(ciro), net: r2(net), kom: r2(Math.abs(kom)),
      qty: Math.round(j ? j.qty : 0),
      cust: (String(r['Müşteri'] || '').trim() || null), ck: null, email: null, phone: null, ms: null,
      camp: null, dds: del ? fmtDate(del) : null, slot: null,
      dh: del ? del.getHours() : null, lead, addr: null, cr: null
    });
  }

  // yeni/tekrar müşteri
  const allDs = ORD.map((o) => o.ds).filter(Boolean).sort();
  const minDs = allDs[0] || null, maxDs = allDs[allDs.length - 1] || null;
  for (const o of ORD) o.isNew = o.ms ? (minDs && o.ms >= minDs ? 1 : 0) : null;

  // itm'yi sıkıştır: aynı bağlam (kanal/gün/şehir/ilçe/mağaza/kaynak/durum/
  // kategori/marka/ürün) → qty + amt topla. Pano tüm filtre ve gruplarını bu
  // 10 alan üzerinden yaptığı için görünüm aynı; satır sayısı birkaç kat düşer.
  const AGG_N = ITM_COLS.length - 2; // qty, amt hariç ilk 10 alan
  const itmMap = new Map();
  for (const o of ITM) {
    if (itmMonthly && o.ds) o.ds = o.ds.slice(0, 7) + '-01';   // ay bazına indir
    let k = '';
    for (let i = 0; i < AGG_N; i++) k += (o[ITM_COLS[i]] == null ? '' : o[ITM_COLS[i]]) + '';
    const ex = itmMap.get(k);
    if (ex) { ex.qty += num(o.qty); ex.amt = r2(ex.amt + num(o.amt)); }
    else itmMap.set(k, Object.assign({}, o, { qty: num(o.qty), amt: r2(num(o.amt)) }));
  }

  const ordRows = ORD.map((o) => ORD_COLS.map((c) => (o[c] === undefined ? null : o[c])));
  const itmAgg = [...itmMap.values()];
  const itmRows = itmAgg.map((o) => ITM_COLS.map((c) => (o[c] === undefined ? null : o[c])));
  const CENT = {};
  for (const o of ORD) if (o.city && CENTROID[o.city]) CENT[o.city] = CENTROID[o.city];

  return {
    meta: {
      generated: new Date().toISOString(), minDate: minDs, maxDate: maxDs,
      orders: ordRows.length, items: ITM.length, itemRows: itmRows.length,
      sources: ['Ticimax', 'Yemeksepeti', 'Trendyol']
    },
    ordCols: ORD_COLS, ord: ordRows,
    itmCols: ITM_COLS, itm: itmRows,
    centroid: CENT
  };
}

const zlib = require('zlib');
/** Payload'ı Supabase satırına sığdırmak için gzip+base64 sarmalar.
    Pano (boot.js) __gz alanını görünce açar. */
function packData(P) {
  return { __gz: zlib.gzipSync(Buffer.from(JSON.stringify(P)), { level: 9 }).toString('base64') };
}

/** Büyük payload'ı gzip'leyip base64'ü ~maxChunk baytlık parçalara böler.
    → { b64full, chunks:[...], bytes, gz } ; her parça ayrı Supabase satırına yazılır
    (tek satır/istek ~5 MB sınırını aşan tüm-geçmiş payload'ı için). */
function packChunks(P, maxChunk = 3_000_000) {
  const gz = zlib.gzipSync(Buffer.from(JSON.stringify(P)), { level: 9 });
  const b64 = gz.toString('base64');
  const chunks = [];
  for (let i = 0; i < b64.length; i += maxChunk) chunks.push(b64.slice(i, i + maxChunk));
  return { chunks, bytes: Buffer.byteLength(JSON.stringify(P)), gz: gz.length, b64len: b64.length };
}

function summary(P) {
  const O = P.ord.map((r) => { const o = {}; P.ordCols.forEach((c, i) => o[c] = r[i]); return o; });
  const by = (k) => O.reduce((m, o) => (m[o[k]] = (m[o[k]] || 0) + 1, m), {});
  return {
    ORD: P.ord.length, ITM: P.itm.length, kanal: by('ch'), durum: by('st'),
    aralik: [P.meta.minDate, P.meta.maxDate],
    ciroTeslim: r2(O.filter((o) => o.st === 'Teslim Edildi').reduce((s, o) => s + (o.ciro || 0), 0)),
    tarihsiz: O.filter((o) => !o.ds).length
  };
}

function writeHtml(PAYLOAD, { templatePath, outFiles, geoPath }) {
  const tpl = fs.readFileSync(templatePath, 'utf8');
  let html = tpl.replace('/*__PAYLOAD__*/', () => JSON.stringify(PAYLOAD));
  let geo = 'null';
  if (geoPath && fs.existsSync(geoPath)) {
    try { geo = JSON.stringify(compactGeo(JSON.parse(fs.readFileSync(geoPath, 'utf8')))); }
    catch (e) { console.warn('geo okunamadı:', e.message); }
  }
  html = html.replace('/*__GEO__*/null', () => geo);
  writeAll(html, outFiles);
  return html;
}

/* Türkiye il sınırları GeoJSON -> kompakt {bbox, prov:[{n,c:[lon,lat],p:[ring,...]}]} */
function compactGeo(gj) {
  const R = (v) => Math.round(v * 1000) / 1000;
  let mnx = 999, mny = 999, mxx = -999, mxy = -999;
  const ringCentroid = (r) => {
    let a = 0, x = 0, y = 0;
    for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
      const p0 = r[j], p1 = r[i], f = p0[0] * p1[1] - p1[0] * p0[1];
      a += f; x += (p0[0] + p1[0]) * f; y += (p0[1] + p1[1]) * f;
    }
    a *= 0.5;
    if (Math.abs(a) < 1e-9) return [r.reduce((s, p) => s + p[0], 0) / r.length, r.reduce((s, p) => s + p[1], 0) / r.length];
    return [x / (6 * a), y / (6 * a)];
  };
  const prov = gj.features.map((f) => {
    let name = f.properties.name || f.properties.Name || f.properties.NAME;
    if (name === 'Afyon') name = 'Afyonkarahisar';
    const g = f.geometry;
    const polys = g.type === 'Polygon' ? [g.coordinates] : g.coordinates;
    const rings = []; let big = null;
    for (const poly of polys) {
      const ext = poly[0].map(([lo, la]) => {
        if (lo < mnx) mnx = lo; if (lo > mxx) mxx = lo; if (la < mny) mny = la; if (la > mxy) mxy = la;
        return [R(lo), R(la)];
      });
      rings.push(ext);
      if (!big || ext.length > big.length) big = ext;
    }
    const c = ringCentroid(big);
    return { n: name, c: [R(c[0]), R(c[1])], p: rings };
  });
  return { bbox: [R(mnx), R(mny), R(mxx), R(mxy)], prov };
}

function writeAll(html, outFiles) {
  for (const f of outFiles) {
    const dir = require('path').dirname(f);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(f, html);
  }
}

/* Aynı panonun yalnızca ROZETİ farklı sürümü. İçerik/başlık birebir aynı.
   opts: { badge:'★', color:'--amber', favicon:'⭐', subtitle:null, title:null } */
function badgeVariant(html, opts = {}) {
  const badge = opts.badge || '★';
  const color = opts.color || '--amber';
  const fav = opts.favicon || '⭐';
  let out = html.replace('<div class="dot">T</div>',
    `<div class="dot" style="background:var(${color})">${badge}</div>`);
  if (opts.title) out = out.replace('<title>E-Ticaret Analizleri</title>', `<title>${opts.title}</title>`);
  if (opts.subtitle) out = out.replace('Tahtakale Spot · çok kanallı satış panosu',
    `Tahtakale Spot · çok kanallı satış panosu ${opts.subtitle}`);
  const favLink = `<link rel="icon" href="data:image/svg+xml,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><text y=".9em" font-size="88">${fav}</text></svg>`)}">`;
  return out.replace(/<\/title>/, '</title>\n' + favLink);
}

module.exports = { buildPayload, summary, packData, packChunks, writeHtml, writeAll, badgeVariant, compactGeo, num, r2, parseAny, fmtDate, normStore, normCity, WD };
