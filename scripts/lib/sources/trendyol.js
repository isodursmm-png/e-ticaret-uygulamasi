/* ============================================================================
   sources/trendyol.js  —  Trendyol Sipariş API'sinden canlı veri
   ----------------------------------------------------------------------------
   Çıktı: { ty4, ty5 }  (4-Trendyol Komisyon Listesi / 5-Trendyol Sipariş
   Listesi xlsx sayfalarıyla AYNI kolon adları — bkz. normalize.js)

   Kimlik:  Satıcı Paneli > Hesap Bilgilerim > Entegrasyon Bilgileri
     TRENDYOL_SELLER_ID, TRENDYOL_API_KEY, TRENDYOL_API_SECRET
     TRENDYOL_API_BASE  (Marketplace: https://apigw.trendyol.com,
                         Trendyol GO : panelin verdiği taban adres)

   NOT: Sipariş API'si komisyonu satır bazında vermez. "Komisyon" / "Satıcı
   Hakediş" alanları için Finans/Settlements API'si ayrıca bağlanmalı
   (aşağıda TODO). Şimdilik 0 bırakılır; normalize.js ciro-komisyon ile net
   hesaplıyor, yani komisyon 0 iken net = ciro olur.
   ==========================================================================*/
'use strict';
const { pick, daysAgo, log, jget } = require('./_util');

const id = 'trendyol';

function cfg() {
  return {
    sellerId: process.env.TRENDYOL_SELLER_ID,
    key: process.env.TRENDYOL_API_KEY,
    secret: process.env.TRENDYOL_API_SECRET,
    base: (process.env.TRENDYOL_API_BASE || 'https://apigw.trendyol.com').replace(/\/+$/, '')
  };
}
function configured() {
  const c = cfg();
  return !!(c.sellerId && c.key && c.secret);
}

const STATUS_TR = {
  Created: 'Yeni', Picking: 'Hazırlanıyor', Invoiced: 'Faturalandı',
  Shipped: 'Kargoda', AtCollectionPoint: 'Kargoda', Cancelled: 'İptal',
  UnDelivered: 'Teslim Edilemedi', Delivered: 'Teslim Edildi',
  UnPacked: 'Bölündü', Returned: 'İade', Repack: 'Yeniden Paketlendi'
};

async function fetchOrders({ days = 30 } = {}) {
  const c = cfg();
  const token = Buffer.from(`${c.key}:${c.secret}`).toString('base64');
  const headers = {
    Authorization: `Basic ${token}`,
    'User-Agent': `${c.sellerId} - SelfIntegration`,
    'Content-Type': 'application/json'
  };
  const startDate = daysAgo(days).getTime();
  const endDate = Date.now();

  const all = [];
  let page = 0;
  let totalPages = 1;
  const size = 200;
  // Marketplace uç noktası; GO için TRENDYOL_API_BASE + aynı yol genelde çalışır.
  const path = `/integration/order/sellers/${c.sellerId}/orders`;

  while (page < totalPages && page < 500) {
    const qs = new URLSearchParams({
      startDate: String(startDate), endDate: String(endDate),
      page: String(page), size: String(size),
      orderByField: 'PackageLastModifiedDate', orderByDirection: 'DESC'
    });
    const body = await jget(`${c.base}${path}?${qs}`, { headers });
    const content = body.content || body.orders || [];
    totalPages = body.totalPages || 1;
    all.push(...content);
    log(id, `sayfa ${page + 1}/${totalPages} — ${content.length} paket (toplam ${all.length})`);
    if (!content.length) break;
    page++;
  }
  return all;
}

/** Trendyol paket nesnesi -> ty4 (sipariş) + ty5 (kalem) satırları */
function toRows(pkgs) {
  const ty4 = [];
  const ty5 = [];

  for (const p of pkgs) {
    const orderNo = pick(p, 'orderNumber', 'orderId', 'id');
    const shipment = p.shipmentAddress || p.invoiceAddress || {};
    const il = pick(shipment, 'city', 'cityName');
    const ilce = pick(shipment, 'district', 'districtName');
    const store = pick(p, 'warehouseName', 'storeName', 'supplierName') || 'E-Ticaret Deposu';
    const dCreate = p.orderDate ? new Date(Number(p.orderDate) || p.orderDate) : null;
    const dDeliver = p.estimatedDeliveryEndDate
      ? new Date(Number(p.estimatedDeliveryEndDate) || p.estimatedDeliveryEndDate) : null;
    const statTr = STATUS_TR[p.shipmentPackageStatus || p.status] || (p.shipmentPackageStatus || p.status || 'Teslim Edildi');

    let ciro = 0;
    for (const ln of (p.lines || [])) {
      const qty = Number(pick(ln, 'quantity', 'amount')) || 0;
      const amount = Number(pick(ln, 'price', 'amount', 'totalPrice')) || 0;
      ciro += amount;
      ty5.push({
        'Sipariş Numarası': orderNo,
        'Sipariş Tarihi': dCreate ? dCreate.toISOString() : null,
        'Teslim Tarihi': dDeliver ? dDeliver.toISOString() : null,
        'İl': il || null,
        'İlçe': ilce || null,
        'Market Adı': store,
        'Sipariş Statüsü': STATUS_TR[ln.orderLineItemStatusName] || ln.orderLineItemStatusName || statTr,
        'Kategori': pick(ln, 'productCategoryName', 'categoryName') || 'Diğer',
        'Marka': pick(ln, 'brand', 'brandName') || 'Diğer',
        'Ürün Adı': pick(ln, 'productName', 'productTitle', 'name') || '',
        'Adet': qty,
        'Satış Tutarı': amount
      });
    }

    ty4.push({
      'Sipariş No': orderNo,
      'Mağaza Adı': store,
      'Mağaza Adresi': [shipment.address1, shipment.address2, ilce, il].filter(Boolean).join(' '),
      'Sipariş Tarihi': dCreate ? dCreate.toISOString() : null,
      'Tutar': ciro || Number(pick(p, 'totalPrice', 'grossAmount')) || 0,
      // TODO(finans): Settlements/Finance API bağlanınca gerçek değerlerle doldur
      'Komisyon': 0,
      'Satıcı Hakediş': 0,
      'Statü': statTr,
      'Ödeme Yöntemi': pick(p, 'paymentType', 'paymentTypeName') || 'Online',
      'Müşteri': [p.customerFirstName, p.customerLastName].filter(Boolean).join(' ') || null
    });
  }
  return { ty4, ty5 };
}

async function fetch(opts) {
  const pkgs = await fetchOrders(opts);
  const rows = toRows(pkgs);
  log(id, `${rows.ty4.length} sipariş · ${rows.ty5.length} kalem`);
  return rows;
}

module.exports = { id, configured, fetch };
