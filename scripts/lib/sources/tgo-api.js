/* ============================================================================
   sources/tgo-api.js  —  Trendyol GO (hızlı market / grocery) Sipariş API'si
   ----------------------------------------------------------------------------
   Çıktı: { ty4, ty5 }  (4-Trendyol Komisyon Listesi / 5-Trendyol Sipariş
   Listesi xlsx sayfalarıyla AYNI kolon adları — bkz. normalize.js)

   Kimlik (partner.tgomarket.com → Entegrasyon Bilgileri):
     TGO_SELLER_ID    Satıcı / Supplier ID
     TGO_API_KEY, TGO_API_SECRET
     TGO_API_BASE     taban adres (vars: https://apigw.trendyol.com;
                      alternatif: https://api.tgoapis.com)
     TGO_TOKEN        (ops.) hazır base64(key:secret) — verilirse key/secret
                      yerine bu kullanılır
     TGO_ORDER_PATH   (ops.) uç nokta şablonu, {supplierId} yer tutucusuyla.
                      Verilmezse bilinen kombinasyonlar sırayla denenir.

   Gerçek komisyon: Sipariş API'si komisyonu vermez ama Trendyol'un "Cari
   Hesap Ekstresi" (finans/settlements) API'si sipariş bazında gerçek
   komisyonu veriyor — bkz. fetchCommissions(). Sabit host: apigw.trendyol.com
   (TGO_API_BASE'den bağımsız), aynı TGO_SELLER_ID / TGO_TOKEN ile çalışıyor
   (canlı sorguyla doğrulandı — 2026-09).
     TGO_KOMISYON_DAYS  (ops.) yalnız son N gün için çekilir (varsayılan 60) —
                        tüm geçmişi her koşuda taramak çok pahalı olur; daha
                        eski siparişler için: scripts/backfill-tgo-commission.js
   ==========================================================================*/
'use strict';
const { pick, log, jget } = require('./_util');

const id = 'tgo-api';

function cfg() {
  const key = (process.env.TGO_API_KEY || '').trim();
  const secret = (process.env.TGO_API_SECRET || '').trim();
  let token = (process.env.TGO_TOKEN || '').trim();
  if (!token && key && secret) token = Buffer.from(`${key}:${secret}`).toString('base64');
  return {
    sellerId: (process.env.TGO_SELLER_ID || '').trim(),
    token,
    base: (process.env.TGO_API_BASE || 'https://apigw.trendyol.com').replace(/\/+$/, '')
  };
}
function configured() {
  const c = cfg();
  return !!(c.sellerId && c.token);
}

const STATUS_TR = {
  Created: 'Yeni', Picking: 'Hazırlanıyor', Invoiced: 'Faturalandı',
  Shipped: 'Kargoda', AtCollectionPoint: 'Kargoda', Cancelled: 'İptal',
  UnDelivered: 'Teslim Edilemedi', Delivered: 'Teslim Edildi',
  UnPacked: 'Bölündü', Returned: 'İade', Repack: 'Yeniden Paketlendi',
  Preparing: 'Hazırlanıyor', Handover: 'Kuryeye Verildi'
};

// Trendyol GO adres alanları maskeli ("TGO Hızlı Market") gelir; gerçek konum
// yalnızca plaka kodundadır (shipmentAddress.cityCode = 1..81).
const PLATE = {
  1: 'Adana', 2: 'Adıyaman', 3: 'Afyonkarahisar', 4: 'Ağrı', 5: 'Amasya', 6: 'Ankara',
  7: 'Antalya', 8: 'Artvin', 9: 'Aydın', 10: 'Balıkesir', 11: 'Bilecik', 12: 'Bingöl',
  13: 'Bitlis', 14: 'Bolu', 15: 'Burdur', 16: 'Bursa', 17: 'Çanakkale', 18: 'Çankırı',
  19: 'Çorum', 20: 'Denizli', 21: 'Diyarbakır', 22: 'Edirne', 23: 'Elazığ', 24: 'Erzincan',
  25: 'Erzurum', 26: 'Eskişehir', 27: 'Gaziantep', 28: 'Giresun', 29: 'Gümüşhane', 30: 'Hakkari',
  31: 'Hatay', 32: 'Isparta', 33: 'Mersin', 34: 'İstanbul', 35: 'İzmir', 36: 'Kars',
  37: 'Kastamonu', 38: 'Kayseri', 39: 'Kırklareli', 40: 'Kırşehir', 41: 'Kocaeli', 42: 'Konya',
  43: 'Kütahya', 44: 'Malatya', 45: 'Manisa', 46: 'Kahramanmaraş', 47: 'Mardin', 48: 'Muğla',
  49: 'Muş', 50: 'Nevşehir', 51: 'Niğde', 52: 'Ordu', 53: 'Rize', 54: 'Sakarya', 55: 'Samsun',
  56: 'Siirt', 57: 'Sinop', 58: 'Sivas', 59: 'Tekirdağ', 60: 'Tokat', 61: 'Trabzon', 62: 'Tunceli',
  63: 'Şanlıurfa', 64: 'Uşak', 65: 'Van', 66: 'Yozgat', 67: 'Zonguldak', 68: 'Aksaray', 69: 'Bayburt',
  70: 'Karaman', 71: 'Kırıkkale', 72: 'Batman', 73: 'Şırnak', 74: 'Bartın', 75: 'Ardahan',
  76: 'Iğdır', 77: 'Yalova', 78: 'Karabük', 79: 'Kilis', 80: 'Osmaniye', 81: 'Düzce'
};
const isMasked = (v) => v == null || v === '' || /TGO Hızlı Market/i.test(String(v));
const cityFromAddr = (a) => {
  if (!a) return null;
  const c = PLATE[Number(a.cityCode)] || null;
  if (c) return c;
  return isMasked(a.city) ? null : String(a.city).trim();
};

/** Denenecek taban+yol kombinasyonları (ilk 200 döneni kullanılır). */
function candidatePaths(sellerId) {
  if (process.env.TGO_ORDER_PATH) {
    return [process.env.TGO_ORDER_PATH.replace('{supplierId}', sellerId)];
  }
  const bases = [
    (process.env.TGO_API_BASE || '').replace(/\/+$/, ''),
    'https://apigw.trendyol.com',
    'https://api.tgoapis.com'
  ].filter((b, i, a) => b && a.indexOf(b) === i);

  const rels = [
    `/integrator/order/grocery/suppliers/${sellerId}/packages`,
    `/integration/order/grocery/suppliers/${sellerId}/packages`,
    `/integrator/order/tgo/suppliers/${sellerId}/packages`,
    `/integration/oms/grocery/suppliers/${sellerId}/packages`
  ];
  const out = [];
  for (const b of bases) for (const r of rels) out.push(b + r);
  return out;
}

const DAY = 86400e3;
const readPage = (body) => body.content || body.orders || body.packages ||
  (Array.isArray(body) ? body : []);

function mkQs(start, end, page) {
  return new URLSearchParams({
    packageModificationStartDate: String(start),
    packageModificationEndDate: String(end),
    startDate: String(start), endDate: String(end),
    page: String(page), size: '200',
    orderByField: 'PackageLastModifiedDate', orderByDirection: 'DESC'
  });
}

async function fetchPackages({ days = 30 } = {}) {
  const c = cfg();
  const headers = {
    Authorization: `Basic ${c.token}`,
    'User-Agent': `${c.sellerId} - SelfIntegration`,
    'x-agentname': `${c.sellerId} - SelfIntegration`,
    'Content-Type': 'application/json'
  };
  const now = Date.now();
  const ALL = !days || days <= 0;
  const WIN = (Number(process.env.TGO_WINDOW_DAYS) || 14) * DAY;   // pencere genişliği
  // "tüm geçmiş" güvenlik tavanı; ardışık boş pencerelerde zaten daha erken durur
  const FLOOR = now - (Number(process.env.TGO_MAX_DAYS) || 1460) * DAY;
  const HARD_MIN = ALL ? FLOOR : now - days * DAY;

  // 1) çalışan uç noktayı bul (son 7 günlük küçük pencereyle)
  let endpoint = null, lastErr = null;
  const probeQs = mkQs(now - 7 * DAY, now, 0);
  for (const url of candidatePaths(c.sellerId)) {
    try {
      const b = await jget(`${url}?${probeQs}`, { headers }, 1);
      endpoint = url;
      log(id, `uç nokta: ${url}`);
      if (process.env.TGO_DEBUG && readPage(b)[0]) {
        require('fs').writeFileSync(process.env.TGO_DEBUG, JSON.stringify(readPage(b)[0], null, 2));
        log(id, `ilk paket şeması -> ${process.env.TGO_DEBUG}`);
      }
      break;
    } catch (e) {
      lastErr = e;
      if (/HTTP 401|HTTP 403/.test(e.message)) {
        throw new Error(
          `yetki reddedildi (${e.message}). TGO_API_KEY / TGO_API_SECRET (veya TGO_TOKEN) ve ` +
          `TGO_SELLER_ID değerlerini partner.tgomarket.com → Entegrasyon Bilgileri ile doğrulayın.`
        );
      }
    }
  }
  if (!endpoint) {
    throw new Error(`bilinen uç noktaların hiçbiri yanıt vermedi (son: ${lastErr && lastErr.message}). ` +
      `Doğru yolu TGO_ORDER_PATH ile verin (örn. .../suppliers/{supplierId}/packages).`);
  }

  // 2) pencereleri geriye doğru gez (modifikasyon tarihine göre). ALL modunda
  //    ardışık 2 boş pencerede dur; aksi halde days penceresini tara.
  const seen = new Set();
  const all = [];
  let winEnd = now;
  let emptyStreak = 0;
  let w = 0;
  log(id, ALL ? 'mod: tüm geçmiş (gün sınırı yok)' : `mod: son ${days} gün`);

  while (winEnd > HARD_MIN && w < 400) {
    const winStart = Math.max(winEnd - WIN, HARD_MIN);
    let page = 0, totalPages = 1, winCount = 0;
    while (page < totalPages && page < 500) {
      const body = await jget(`${endpoint}?${mkQs(winStart, winEnd, page)}`, { headers });
      const list = readPage(body);
      totalPages = body.totalPages || totalPages;
      for (const p of list) {
        const k = String(p.id || p.orderNumber || p.orderId);
        if (seen.has(k)) continue;
        seen.add(k); all.push(p); winCount++;
      }
      if (!list.length) break;
      page++;
    }
    w++;
    const iso = (t) => new Date(t).toISOString().slice(0, 10);
    log(id, `pencere ${w} [${iso(winStart)} → ${iso(winEnd)}] — +${winCount} (toplam ${all.length})`);
    if (winCount === 0) { if (++emptyStreak >= 2 && ALL) break; }
    else emptyStreak = 0;
    winEnd = winStart;
    if (winStart <= HARD_MIN) break;
  }
  return all;
}

const toISO = (raw) => {
  if (raw == null || raw === '') return null;
  const d = new Date(Number(raw) || raw);
  return isNaN(d) ? null : d.toISOString();
};

function toRows(pkgs) {
  const ty4 = [];
  const ty5 = [];

  for (const p of pkgs) {
    const orderNo = pick(p, 'orderNumber', 'orderCode', 'orderId', 'id');
    const addr = p.shipmentAddress || p.invoiceAddress || {};
    const il = cityFromAddr(addr);
    const ilce = isMasked(addr.district) ? null : String(addr.district).trim();
    // önce gerçek mağaza adı; yoksa "TGO <id>" (normalize STORE_NAMES ile adlandırılabilir)
    const store = pick(p, 'storeName', 'warehouseName') || (p.store && p.store.name) ||
      ('TGO ' + (pick(p, 'storeId', 'warehouseId') || 'Market'));
    const dCreateISO = toISO(pick(p, 'orderDate', 'packageCreationDate', 'createdDate'));
    const dDeliverISO = toISO(pick(p, 'estimatedDeliveryEndDate', 'deliveredDate', 'agreedDeliveryDate'));
    const rawStatus = pick(p, 'packageStatus', 'shipmentPackageStatus', 'status');
    const statTr = STATUS_TR[rawStatus] || rawStatus || 'Teslim Edildi';

    let ciro = 0;
    const lines = p.lines || p.orderLines || [];
    for (const ln of lines) {
      const prod = ln.product || ln;
      // adet = iptal olmayan alt kalem sayısı; yoksa quantity alanı; yoksa 1
      const items = Array.isArray(ln.items) ? ln.items : [];
      let qty = items.length ? items.filter((it) => !it.isCancelled).length : 0;
      if (!qty) qty = Number(pick(ln, 'quantity', 'count')) || (items.length ? items.length : 1);
      const unit = Number(pick(ln, 'price', 'amount', 'unitPrice')) || 0;
      const lineTotal = unit * qty;
      ciro += lineTotal;
      ty5.push({
        'Sipariş Numarası': orderNo,
        'Sipariş Tarihi': dCreateISO,
        'Teslim Tarihi': dDeliverISO,
        'İl': il || null,
        'İlçe': ilce || null,
        'Market Adı': store,
        'Sipariş Statüsü': statTr,
        'Kategori': pick(prod, 'categoryName', 'productCategoryName', 'category') || 'Diğer',
        'Marka': pick(prod, 'brandName', 'brand') || 'Diğer',
        'Ürün Adı': pick(prod, 'productSaleName', 'name', 'productName') || '',
        'Adet': qty,
        'Satış Tutarı': lineTotal
      });
    }

    ty4.push({
      'Sipariş No': orderNo,
      'Mağaza Adı': store,
      'Mağaza Adresi': [il, ilce].filter(Boolean).join(' / '),
      'Sipariş Tarihi': dCreateISO,
      'Tutar': Number(pick(p, 'totalPrice', 'grossAmount', 'sellerInvoiceAmount')) || ciro,
      'Komisyon': 0,
      'Satıcı Hakediş': 0,
      'Statü': statTr,
      'Ödeme Yöntemi': pick(p, 'paymentType', 'paymentTypeName') || 'Online',
      'Müşteri': p.customer
        ? [p.customer.firstName, p.customer.lastName].filter(Boolean).join(' ') || null
        : null
    });
  }
  return { ty4, ty5 };
}

/* ---- Gerçek komisyon: Trendyol "Cari Hesap Ekstresi" (finans) API'si ---- */
const CHE_BASE = 'https://apigw.trendyol.com/integration/finance/che';
const CHE_WIN = 14 * DAY;   // sorgu başına azami 15 gün — 14 ile güvenli payda kal

/** orderNumber -> toplam commissionAmount (aynı siparişin kalemleri toplanır).
    [from,to) epoch-ms aralığını 14 günlük pencerelerle, sayfalayarak tarar.
    Hata/yetkisizlikte sessizce boş Map döner (çağıran Komisyon=0 ile devam eder). */
async function fetchCommissions({ from, to }) {
  const c = cfg();
  if (!c.sellerId || !c.token || !(to > from)) return new Map();
  const headers = { Authorization: `Basic ${c.token}`, Accept: 'application/json' };
  const out = new Map();
  const iso = (t) => new Date(t).toISOString().slice(0, 10);
  let winEnd = to, guard = 0;

  while (winEnd > from && guard < 500) {
    const winStart = Math.max(winEnd - CHE_WIN, from);
    let page = 0, totalPages = 1, winCount = 0;
    while (page < totalPages && page < 200) {
      const qs = new URLSearchParams({
        startDate: String(winStart), endDate: String(winEnd),
        transactionType: 'Sale', page: String(page), size: '1000'
      });
      let body;
      try {
        body = await jget(`${CHE_BASE}/sellers/${c.sellerId}/settlements?${qs}`, { headers });
      } catch (e) {
        log(id, `⚠ komisyon (finans) [${iso(winStart)}→${iso(winEnd)}] alınamadı: ${e.message}`);
        break;
      }
      const list = Array.isArray(body && body.content) ? body.content : [];
      totalPages = (body && body.totalPages) || 1;
      for (const t of list) {
        const no = String(t.orderNumber || '').trim();
        if (!no) continue;
        out.set(no, (out.get(no) || 0) + (Number(t.commissionAmount) || 0));
      }
      winCount += list.length;
      if (!list.length) break;
      page++;
    }
    guard++;
    log(id, `komisyon penceresi [${iso(winStart)}→${iso(winEnd)}] — +${winCount} kayıt (${out.size} sipariş)`);
    winEnd = winStart;
    if (winStart <= from) break;
  }
  return out;
}

async function fetch(opts) {
  const pkgs = await fetchPackages(opts);
  const rows = toRows(pkgs);
  log(id, `${rows.ty4.length} sipariş · ${rows.ty5.length} kalem`);

  // Gerçek komisyonu üzerine yaz — yalnız son TGO_KOMISYON_DAYS gün (varsayılan
  // 60): tüm geçmişi her koşuda finans API'sinden taramak çok pahalı olur.
  // Daha eski siparişler Komisyon=0 kalır; tek seferlik doldurma için:
  // scripts/backfill-tgo-commission.js
  try {
    const days = Number(process.env.TGO_KOMISYON_DAYS) || 60;
    const to = Date.now(), from = to - days * DAY;
    const kom = await fetchCommissions({ from, to });
    if (kom.size) {
      let n = 0;
      for (const r of rows.ty4) {
        const v = kom.get(String(r['Sipariş No']));
        if (v != null) { r['Komisyon'] = Math.round(v * 100) / 100; n++; }
      }
      log(id, `komisyon (finans API): ${n}/${rows.ty4.length} siparişe uygulandı (son ${days} gün)`);
    }
  } catch (e) {
    log(id, `⚠ komisyon adımı atlandı: ${e.message}`);
  }

  return rows;
}

module.exports = { id, configured, fetch, fetchCommissions };
