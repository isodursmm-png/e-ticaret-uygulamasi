/* ============================================================================
   sources/yemeksepeti-api.js  —  Yemeksepeti / Delivery Hero "Partner API"
   ----------------------------------------------------------------------------
   Çıktı: { ys }  — "3-Yemeksepeti Sipariş Listesi.xlsx" ile aynı kolon adları
   (normalize.js bu adları okur).

   Uç noktalar (https://yemeksepeti.partner.deliveryhero.io):
     POST /v2/oauth/token                                   (OAuth2 client_credentials)
     GET  /v2/chains/{chain_id}/vendors/{vendor_id}/orders  (getOrders — sipariş geçmişi)
        query: start_time, end_time (ISO 8601, en fazla 60 gün geri), page, page_size

   .env:
     YEMEKSEPETI_CLIENT_ID       (DH tarafından verilen)
     YEMEKSEPETI_CLIENT_SECRET
     YEMEKSEPETI_CHAIN_ID        (DH platform kimliği)
     YEMEKSEPETI_VENDOR_ID       (mağaza kimliği)
     YEMEKSEPETI_API_BASE        (vars: https://yemeksepeti.partner.deliveryhero.io)
   ==========================================================================*/
'use strict';
const { log } = require('./_util');

const id = 'yemeksepeti-api';
const httpFetch = globalThis.fetch;
const DAY = 86400e3;

/** YEMEKSEPETI_VENDOR_ID (tek/virgüllü) + YEMEKSEPETI_VENDOR_ID1..N → benzersiz liste */
function vendorIds() {
  const out = [];
  const add = (s) => String(s || '').split(/[,\s]+/).map((x) => x.trim()).filter(Boolean).forEach((v) => out.push(v));
  add(process.env.YEMEKSEPETI_VENDOR_ID);
  for (let i = 1; i <= 50; i++) add(process.env[`YEMEKSEPETI_VENDOR_ID${i}`]);
  return [...new Set(out)];
}

function cfg() {
  return {
    clientId: (process.env.YEMEKSEPETI_CLIENT_ID || '').trim(),
    clientSecret: (process.env.YEMEKSEPETI_CLIENT_SECRET || '').trim(),
    chainId: (process.env.YEMEKSEPETI_CHAIN_ID || '').trim(),
    vendorIds: vendorIds(),
    base: (process.env.YEMEKSEPETI_API_BASE || 'https://yemeksepeti.partner.deliveryhero.io').replace(/\/+$/, '')
  };
}
function configured() {
  const c = cfg();
  return !!(c.clientId && c.clientSecret && c.chainId && c.vendorIds.length);
}

const STATUS_TR = {
  RECEIVED: 'Alındı', READY_FOR_PICKUP: 'Hazır', DISPATCHED: 'Yolda',
  CANCELLED: 'İptal Edildi', DELIVERED: 'Teslim Edildi'
};

const CANCEL_TR = {
  ITEM_UNAVAILABLE: 'Ürün stokta yok', ITEM_NOT_AVAILABLE: 'Ürün stokta yok',
  FRAUD_PRANK: 'Sahte / şaka sipariş', FRAUD: 'Sahte sipariş',
  UNABLE_TO_PAY: 'Ödeme yapılamadı', PAYMENT_FAILED: 'Ödeme başarısız',
  CLOSED: 'Mağaza kapalı', VENDOR_CLOSED: 'Mağaza kapalı', RESTAURANT_CLOSED: 'Mağaza kapalı',
  TOO_BUSY: 'Yoğunluk', VENDOR_BUSY: 'Yoğunluk',
  UNABLE_TO_FIND: 'Adres bulunamadı', ADDRESS_NOT_FOUND: 'Adres bulunamadı', ADDRESS_INCOMPLETE: 'Adres eksik',
  WRONG_ORDER_ITEMS_DELIVERED: 'Yanlış ürün teslim edildi', WRONG_ITEMS: 'Yanlış ürün',
  MISTAKE_ERROR: 'Hatalı sipariş', ORDER_ERROR: 'Sipariş hatası',
  NEVER_DELIVERED: 'Teslim edilemedi', DELIVERY_FAILED: 'Teslim edilemedi', LATE_DELIVERY: 'Geç teslimat',
  ORDER_MODIFICATION_NOT_POSSIBLE: 'Sipariş değişikliği yapılamadı',
  CUSTOMER_CALLED_TO_CANCEL: 'Müşteri iptal etti', CUSTOMER_CANCELLED: 'Müşteri iptal etti',
  CUSTOMER_UNREACHABLE: 'Müşteriye ulaşılamadı', CUSTOMER_NOT_AVAILABLE: 'Müşteri adreste yok',
  DUPLICATE_ORDER: 'Mükerrer sipariş', TECHNICAL_PROBLEM: 'Teknik sorun',
  OUT_OF_DELIVERY_AREA: 'Teslimat bölgesi dışı', NO_COURIER_AVAILABLE: 'Kurye bulunamadı', NO_COURIER: 'Kurye bulunamadı',
  PRICE_MISMATCH: 'Fiyat uyuşmazlığı', WRONG_PRICE: 'Fiyat hatası', OTHER: 'Diğer', UNKNOWN: 'Bilinmiyor'
};
function cancelTR(s) {
  if (s == null || s === '') return '';
  const k = String(s).trim();
  if (CANCEL_TR[k.toUpperCase()]) return CANCEL_TR[k.toUpperCase()];
  if (/^[A-Z0-9_]+$/.test(k)) return k.toLowerCase().replace(/_/g, ' ').replace(/(^|\s)\S/g, (c) => c.toUpperCase());
  return k;
}

async function jfetch(url, opts, tries = 3) {
  let last;
  for (let i = 0; i < tries; i++) {
    try {
      const r = await httpFetch(url, { ...opts, signal: AbortSignal.timeout(60000) });
      const txt = await r.text();
      let body; try { body = txt ? JSON.parse(txt) : null; } catch { body = txt; }
      if (!r.ok) throw new Error(`HTTP ${r.status} — ${typeof body === 'string' ? body.slice(0, 200) : JSON.stringify(body).slice(0, 200)}`);
      return body;
    } catch (e) {
      last = e;
      if (i < tries - 1) await new Promise((res) => setTimeout(res, 1500 * (i + 1)));
    }
  }
  throw last;
}

async function token(c) {
  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: c.clientId,
    client_secret: c.clientSecret
  });
  const j = await jfetch(`${c.base}/v2/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body
  });
  if (!j || !j.access_token) throw new Error('token alınamadı: ' + JSON.stringify(j).slice(0, 200));
  return j.access_token;
}

async function fetchOrders() {
  const c = cfg();
  const tok = await token(c);
  const headers = { Authorization: `Bearer ${tok}`, Accept: 'application/json' };
  const now = Date.now();
  // DH Partner API, start_time'ı 60 günden eski kabul etmiyor ("start date is older
  // than 60 days" → 400). Bu yüzden gün sınırına bakmadan API'nin verdiği azami
  // aralığı (güvenli tarafta kalmak için son 59 gün) her zaman çekiyoruz.
  const from = now - 59 * DAY;
  log(id, 'not: DH Partner API en fazla son 60 günü verir — tüm bu aralık çekiliyor');

  const iso = (t) => new Date(t).toISOString();
  const WIN = 7 * DAY;
  const all = [];
  const seen = new Set();

  log(id, `${c.vendorIds.length} mağaza: ${c.vendorIds.join(', ')}`);

  for (const vendorId of c.vendorIds) {
    const base = `${c.base}/v2/chains/${encodeURIComponent(c.chainId)}/vendors/${encodeURIComponent(vendorId)}/orders`;
    let vAdded = 0;
    for (let winEnd = now; winEnd > from; winEnd -= WIN) {
      const winStart = Math.max(winEnd - WIN, from);
      let page = 1, totalPages = 1;
      do {
        const qs = new URLSearchParams({
          start_time: iso(winStart), end_time: iso(winEnd),
          page: String(page), page_size: '100'
        });
        const j = await jfetch(`${base}?${qs}`, { headers });
        const list = (j && j.orders) || [];
        totalPages = (j && j.total_pages) || 1;
        let added = 0;
        for (const o of list) {
          const k = o.order_id || o.order_code || o.external_order_id;
          if (k && seen.has(k)) continue;
          if (k) seen.add(k);
          o._vendorId = vendorId;   // mağaza kimliği (normalize STORE_NAMES ile adlandırır)
          all.push(o); added++; vAdded++;
        }
        log(id, `${vendorId} [${iso(winStart).slice(0, 10)}→${iso(winEnd).slice(0, 10)}] sayfa ${page}/${totalPages} — +${added} (toplam ${all.length})`);
        page++;
      } while (page <= totalPages && page < 200);
    }
    log(id, `${vendorId}: ${vAdded} sipariş`);
  }
  return all;
}

function toRows(orders) {
  const ys = [];
  for (const o of orders) {
    const pay = o.payment || {};
    const sys = o.sys || {};
    const cust = o.customer || {};
    const addr = cust.delivery_address || {};
    const items = Array.isArray(o.items) ? o.items : [];

    const urunler = items.map((it) => {
      const q = (it.pricing && it.pricing.quantity) || (it.original_pricing && it.original_pricing.quantity) || 1;
      return `${q} ${String(it.name || '').trim()}`;
    }).join(', ');

    const odeme = (Number(pay.collect_at_pickup) > 0 || /cash|kapıda|delivery/i.test(String(pay.type || '')))
      ? 'Kapıda Ödeme' : 'Online Kart';

    ys.push({
      'Sipariş No': o.order_code || o.external_order_id || o.order_id,
      'Kabul Edilme Zamanı': sys.created_at || null,
      'Siparişin Alındığı Tarih': sys.created_at || null,
      'Teslimat zamanı': o.promised_for || o.accepted_for || null,
      'Sipariş Teslim Tarihi': o.status === 'DELIVERED' ? (sys.updated_at || o.promised_for || null) : null,
      'Mağaza': String(o._vendorId || (o.vendor && o.vendor.name) || 'Yemeksepeti'),
      'Teslimat Şehir': addr.city || null,
      'Teslimat İlçe': addr.suburb || addr.street || null,
      'Ödeme Yöntemi': odeme,
      'Toplam': Number(pay.order_total) || Number(pay.sub_total) || 0,
      'Komisyon': 0,
      'Tahmini Kazanç': 0,
      'Ürünler': urunler,
      'Sipariş Durumu': STATUS_TR[o.status] || o.status || 'Diğer',
      'İptal Sebebi': cancelTR(o.cancellation && o.cancellation.reason)
    });
  }
  return { ys };
}

async function fetch() {
  const orders = await fetchOrders();
  const rows = toRows(orders);
  log(id, `${rows.ys.length} sipariş`);
  return rows;
}

module.exports = { id, configured, fetch };
