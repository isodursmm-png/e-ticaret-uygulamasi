# E‑Ticaret Analizleri — Web (Supabase)

Masaüstündeki tek dosya pano, **webde yayınlanabilir statik uygulamaya** dönüştürüldü.
Sunucu yok: tarayıcı, giriş yaptıktan sonra veriyi doğrudan **Supabase**'ten çeker.

```
public/            → yayınlanan statik site (Vercel/Netlify kök = "public")
  index.html       ← build-web.js üretir (şablondan)
  app.js           ← build-web.js üretir (pano mantığı)
  boot.js          ← Supabase oturumu + veri yükleme (elle yazıldı)
  config.example.js→ config.js olarak kopyalayın (Supabase URL + anon anahtar)
scripts/
  build-web.js     → _kaynak/template.html  →  public/index.html + public/app.js
  import.js        → xlsx  →  Supabase (analytics_payload tek jsonb satırı)
  gen-config.js    → deploy'da env'den public/config.js üretir
  serve.js         → yerel geliştirme sunucusu (npm run dev)
  lib/normalize.js → ortak normalizasyon çekirdeği (kaynaktan kopya)
supabase/
  schema.sql       → tablo + RLS + okuma politikası
```

## Mimari
- **Statik + Supabase** (sunucusuz). Pano tüm veriyi tek seferde alıp istemcide filtreler;
  bu yüzden veri, `analytics_payload` tablosunda **tek bir `jsonb` satırı** (`id = 'eticaret'`)
  olarak tutulur. `import.js` bu satırı `service_role` anahtarıyla günceller.
- **Ham satış arşivi:** `topla.js` (canlı toplama) ayrıca `raw_orders` tablosunu besler.
  `analytics_payload` her koşuda ezilirken `raw_orders` **birikir** — her çalıştırmada yeni
  sipariş/kalem satırları `key` üzerinden upsert edilir (yeni → INSERT, görülen → UPDATE).
  Kapatmak için `RAW_ORDERS=0` ya da `--no-raw`.
- **Kimlik doğrulama:** Supabase Auth (e‑posta + parola). Oturum yoksa giriş kapısı çıkar.
- **RLS:** `analytics_payload` ve `raw_orders` yalnızca `authenticated` rolüne `select` verir.
  Yazma yalnızca `service_role` (import / topla betiği) ile.

---

## 1) Supabase kurulumu (bir kez)
1. https://supabase.com → yeni proje.
2. **SQL Editor** → `supabase/schema.sql` içeriğini çalıştır.
3. **Authentication → Users → Add user**: e‑posta + parola gir, *Auto Confirm User* işaretle.
   (Giriş yapacağın hesap bu.)
4. **Project Settings → API**’den şunları not al:
   - `Project URL`
   - `anon` `public` anahtar  → tarayıcıya iner, güvenli
   - `service_role` anahtar  → **GİZLİ**, sadece `import.js`

## 2) Veriyi yükle (her güncellemede)
```bash
npm install
copy .env.example .env       # sonra .env içini doldur (SUPABASE_URL, SUPABASE_SERVICE_ROLE, XLSX_DIR)
npm run import
```
`xlsx` dosyaları `XLSX_DIR` klasöründen okunur (varsayılan `Masaüstü/ETICARET/Eticaret`).
Dosya adları: `0-Ticimax Ürünlü Sipariş Listesi.xlsx`, `1-Ticimax Sipariş.xlsx`,
`3-Yemeksepeti Sipariş Listesi.xlsx`, `4-Trendyol Komisyon Listesi.xlsx`, `5-Trendyol Sipariş Listesi.xlsx`.

## 3) Yerelde çalıştır
```bash
copy public\config.example.js public\config.js   # içine Project URL + anon anahtar
npm run build:web        # şablondan public/index.html + app.js üretir (şablon değişince tekrarla)
npm run dev              # http://localhost:4173
```

## 4) Webde yayınla

### Vercel
- Repo’yu import et. Ayarlar (vercel.json ile otomatik gelir):
  - Build Command: `node scripts/gen-config.js`
  - Output Directory: `public`
- **Environment Variables**: `SUPABASE_URL`, `SUPABASE_ANON_KEY`
- Deploy. (`config.js` build sırasında env’den üretilir; repoya koymana gerek yok.)

### Netlify
- `netlify.toml` hazır: publish `public`, build `node scripts/gen-config.js`.
- Site env: `SUPABASE_URL`, `SUPABASE_ANON_KEY`.

### Not: Supabase Auth yönlendirme
Supabase → **Authentication → URL Configuration → Site URL** alanına yayın adresini ekle
(örn. `https://eticaret-analizleri.vercel.app`).

---

## Şablon değişince
Masaüstü panosunun kaynağı `E - TICARET ANALIZLERI/_kaynak/template.html` düzenlenince:
```bash
npm run build:web
```
`public/index.html` ve `public/app.js` yeniden üretilir. (Yol farklıysa `TEMPLATE_PATH` env ver.)

## Bilinen sınır
Pano içindeki **“Grafiği e‑posta ile gönder”** düğmesi `localhost:8788`’deki yerel servise
bağlıdır; uzak kullanıcılarda çalışmaz, “yerel servis kapalı” uyarısı verir (zararsız).
İstenirse ayrı bir sunucusuz fonksiyona taşınabilir.

---

## Canlı yenileme (xlsx yerine kaynaklardan otomatik çekim)

`scripts/topla.js`, `import.js`’in **API/otomasyon** karşılığıdır: aynı `normalize.js`
çekirdeğini ve aynı Supabase satırını (`analytics_payload / id='eticaret'`) kullanır.

### Kaynaklar
| Kaynak | Yöntem | Env |
|---|---|---|
| Ticimax (`SiparisServis.svc`) | SOAP `SelectSiparis` (canlı ✓) | `TICIMAX_API_URL` (site kökü), `TICIMAX_CODE` |
| Trendyol GO / Market (`api.tgoapis.com`) | Grocery Sipariş API (canlı ✓) | `TGO_SELLER_ID`, `TGO_API_KEY`, `TGO_API_SECRET`, `TGO_API_BASE`, `TGO_ORDER_PATH` |
| Trendyol Marketplace (`apigw.trendyol.com`) | Marketplace Sipariş API | `TRENDYOL_SELLER_ID`, `TRENDYOL_API_KEY`, `TRENDYOL_API_SECRET`, `TRENDYOL_API_BASE` |
| Yemeksepeti (`partner-app.yemeksepeti.com`) | Playwright → Excel indir | `YEMEKSEPETI_USER/PASS` + `YS_SEL_*`, `YS_REPORT_URL` |
| Trendyol GO panel (`partner.tgomarket.com`) | Playwright (yalnızca TGO API yoksa) | `TGO_USER/PASS` + `TGO_SEL_*`, `TGO_ORDERS_URL`, `TGO_COMMISSION_URL` |

Env eksik olan kaynak **atlanır** (hata vermez). `FETCH_DAYS=0` → tüm geçmiş.
Tüm değişkenler `.env.example`’da.

### Yerel önizleme (Supabase'siz)
```bash
npm run topla:local     # canlı kaynaklardan çek → public/local.html (login yok, git'e girmez)
npm run import:local    # xlsx'ten aynı önizleme
npm run dev             # http://localhost:4173/local.html
```

### Yerelde
```bash
npm install
npx playwright install chromium      # sadece Yemeksepeti / TGO için
copy .env.example .env               # doldur
npm run topla                        # tüm yapılandırılmış kaynaklar
npm run topla:dry                    # Supabase'e yazmadan özet
node scripts/topla.js --only=ticimax,trendyol
node scripts/topla.js --only=yemeksepeti --headed   # ilk giriş / 2FA — oturum scripts/.pw-state/ altına kaydolur
```

### Ham arşiv — tek seferlik geçmiş dolumu
`raw_orders` tablosunu tüm geçmişle bir kez doldurur (pano/`analytics_payload`'a
dokunmaz). Ticimax ay ay çekilip her ay hemen Supabase'e yazılır — bellekte
birikmez. Yemeksepeti/Trendyol API'leri zaten ~60 günle sınırlı.
```bash
npm run backfill                     # tüm kaynaklar, tüm geçmiş (Ticimax'te ~1 saat)
node scripts/backfill-raw.js --only=ticimax --from=2024-01
```
Sonrasında saatlik `collect` iş akışı güncel pencereyi (`TICIMAX_FETCH_DAYS`, ör.
90 gün) hem `analytics_payload`'a hem `raw_orders`'a yazmaya devam eder.

### Otomatik (GitHub Actions) — `.github/workflows/collect.yml`
- **Saatlik cron** + elle `workflow_dispatch` + panodaki düğmeden `repository_dispatch: refresh`.
- Repo **Secrets**: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE`, `TICIMAX_API_KEY`,
  `TRENDYOL_SELLER_ID`, `TRENDYOL_API_KEY`, `TRENDYOL_API_SECRET`,
  `YEMEKSEPETI_USER`, `YEMEKSEPETI_PASS`, `TGO_USER`, `TGO_PASS`.
- Repo **Variables** (gizli değil): `TICIMAX_API_URL`, `TRENDYOL_API_BASE`, `FETCH_DAYS`,
  panel seçicileri `YS_SEL_*` / `TGO_SEL_*`, `*_URL`.

### Panodaki “⟳ Yenile” → `api/refresh.js` (Vercel)
Oturumu doğrular, GitHub Actions `collect` iş akışını tetikler, `updated_at`
değişince pano kendini yeniler. Playwright Vercel’de koşamadığı için tek motor
GitHub Actions’tır.
- **Vercel env**: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `GH_DISPATCH_REPO`,
  `GH_DISPATCH_TOKEN` (fine-grained PAT — *Contents: Read and write*), ops. `CRON_SECRET`.

### Playwright seçicileri (ilk kurulum, bir kez)
Panel arayüzü siteye özgü olduğundan giriş + “Dışa aktar” akışı kaydedilip
seçiciler env’e yazılır:
```bash
npx playwright codegen https://partner-app.yemeksepeti.com/
npx playwright codegen https://partner.tgomarket.com/
```
`ticimax.js` alan adları da kuruluma göre değişebilir; panelden dönen gerçek JSON
ile `scripts/lib/sources/ticimax.js` içindeki `pick(...)` listelerini doğrulayın
(TODO işaretli).
