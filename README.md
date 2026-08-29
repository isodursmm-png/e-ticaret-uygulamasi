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
- **Kimlik doğrulama:** Supabase Auth (e‑posta + parola). Oturum yoksa giriş kapısı çıkar.
- **RLS:** `analytics_payload` yalnızca `authenticated` rolüne `select` verir. Yazma yalnızca
  `service_role` (import betiği) ile.

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
