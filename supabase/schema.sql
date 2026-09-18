-- ============================================================================
--  E-Ticaret Analizleri — Supabase şeması
--  Supabase > SQL Editor'da çalıştırın.
--
--  Tasarım: pano tüm veriyi tek seferde belleğe alıp istemcide filtreler.
--  Bu yüzden normalize edilmiş satır tabloları yerine, hazır PAYLOAD nesnesi
--  tek bir jsonb satırında tutulur (id = 'eticaret').  "npm run import" bu
--  satırı service_role anahtarıyla günceller (RLS'i baypas eder).
-- ============================================================================

create table if not exists public.analytics_payload (
  id          text primary key,
  data        jsonb       not null,   -- buildPayload() çıktısı (meta, ordCols, ord, itmCols, itm, centroid)
  geo         jsonb,                  -- compactGeo() çıktısı (bbox, prov[])
  meta        jsonb,                  -- data.meta kopyası (hızlı erişim)
  updated_at  timestamptz not null default now()
);

alter table public.analytics_payload enable row level security;

-- Giriş yapmış her kullanıcı okuyabilir. (Daha dar yetki isterseniz using(...) koşulunu değiştirin.)
drop policy if exists "read_authenticated" on public.analytics_payload;
create policy "read_authenticated"
  on public.analytics_payload
  for select
  to authenticated
  using (true);

-- Yazma politikası YOK: insert/update yalnızca service_role ile (import betiği).

-- ----------------------------------------------------------------------------
--  Kullanıcı oluşturma (giriş için):
--    Supabase > Authentication > Users > "Add user" (e-posta + parola, "Auto confirm")
--  veya Authentication > Providers > Email'i açıp davet/kayıt akışını kullanın.
-- ----------------------------------------------------------------------------

-- ============================================================================
--  HAM SATIŞ ARŞİVİ  —  raw_orders
--  ----------------------------------------------------------------------------
--  analytics_payload her çalıştırmada tümüyle ezilir; bu tablo ise BİRİKİR.
--  scripts/topla.js her koşuda kaynaklardan gelen ham satır nesnelerini
--  (Ticimax / Yemeksepeti / Trendyol) `key` üzerinden upsert eder:
--    - yeni sipariş/kalem  -> INSERT
--    - daha önce görülen    -> UPDATE (data + updated_at tazelenir, first_seen sabit)
--  Böylece geçmiş kaybolmaz; API'lerin 60 günlük penceresi dışına düşen
--  siparişler tabloda kalmaya devam eder.
-- ============================================================================
create table if not exists public.raw_orders (
  key         text primary key,          -- "<source>:<bucket>:<sipariş no>[:<kalem sırası>]"
  source      text        not null,      -- ticimax | yemeksepeti | trendyol
  bucket      text        not null,      -- t0 | t1 | ys | ty4 | ty5
  level       text        not null,      -- order | item
  order_no    text,
  order_date  timestamptz,
  channel     text,                      -- Ticimax | Yemeksepeti | Trendyol
  data        jsonb       not null,      -- kaynağın ürettiği ham satır (kolon adları bozulmadan)
  first_seen  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists raw_orders_source_idx     on public.raw_orders (source);
create index if not exists raw_orders_order_date_idx  on public.raw_orders (order_date);
create index if not exists raw_orders_order_no_idx    on public.raw_orders (order_no);
create index if not exists raw_orders_channel_date_idx on public.raw_orders (channel, order_date);
create index if not exists raw_orders_source_date_idx  on public.raw_orders (source, order_date);
create index if not exists raw_orders_bucket_idx       on public.raw_orders (bucket);
create index if not exists raw_orders_bucket_date_idx  on public.raw_orders (bucket, order_date);

alter table public.raw_orders enable row level security;

-- Giriş yapmış kullanıcı okuyabilir; yazma yalnızca service_role (topla.js) ile.
drop policy if exists "read_authenticated" on public.raw_orders;
create policy "read_authenticated"
  on public.raw_orders
  for select
  to authenticated
  using (true);

-- ============================================================================
--  E-TİCARET OTOLARI  —  vehicle_logs
--  ----------------------------------------------------------------------------
--  Panodaki "E-Ticaret Otoları" segmenti — filo/yakıt masraf kaydı. Doğrudan
--  tarayıcıdan (anon anahtar + oturum) yazılır/okunur; import/topla.js'e
--  gerek yok. Giriş yapmış her kullanıcı ekleyebilir/görebilir/silebilir
--  (küçük, güvenilir bir ekip için yeterli — daha dar yetki isterseniz
--  aşağıdaki policy'leri daraltın, ör. yalnız kendi kaydını silebilsin).
-- ============================================================================
create table if not exists public.vehicle_logs (
  id              bigint generated always as identity primary key,
  tarih           date        not null default current_date,
  plaka           text        not null,
  lokasyon        text,
  kullanici       text,
  ucret_maliyeti  numeric,                 -- kiralama/servis vb. ücret maliyeti
  yakit_litre     numeric,                 -- yakıt (litre)
  kdvli_tutar     numeric,                 -- KDV'li tutar (₺)
  created_by      uuid        references auth.users(id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists vehicle_logs_tarih_idx on public.vehicle_logs (tarih);
create index if not exists vehicle_logs_plaka_idx on public.vehicle_logs (plaka);

alter table public.vehicle_logs enable row level security;

drop policy if exists "authenticated_all" on public.vehicle_logs;
create policy "authenticated_all"
  on public.vehicle_logs
  for all
  to authenticated
  using (true)
  with check (true);

-- ============================================================================
--  ARAÇLAR  —  filo kaydı (plaka, şube, şoför, kullanım amacı)
--  ----------------------------------------------------------------------------
--  "E-Ticaret Otoları" sayfasındaki araç listesi. api/yakit.js bu tablodaki
--  plakaları arac_takip_sistemi'nden (Petrol Ofisi) çekilen yakıt alımlarıyla
--  eşleştirmek için service_role ile okur; tarayıcı ise doğrudan (anon anahtar
--  + oturum) okur/yazar — vehicle_logs ile aynı yetki modeli.
-- ============================================================================
create table if not exists public.araclar (
  id          bigint generated always as identity primary key,
  created_at  timestamptz not null default now(),
  plaka       text        not null,
  sube        text,
  sofor       text,
  kullanim    text,
  kaynak      text,
  maas        numeric
);

-- Onceden olusturulmus tablolarda eksikse eklenir (idempotent).
alter table public.araclar add column if not exists kaynak text;
alter table public.araclar add column if not exists maas numeric;

create index if not exists araclar_plaka_idx on public.araclar (plaka);

alter table public.araclar enable row level security;

drop policy if exists "authenticated_all" on public.araclar;
create policy "authenticated_all"
  on public.araclar
  for all
  to authenticated
  using (true)
  with check (true);

-- ============================================================================
--  YAKITLAR  —  araç × ay bazlı Petrol Ofisi yakıt özeti (kalıcı kayıt)
--  ----------------------------------------------------------------------------
--  api/yakit-sync.js (Vercel Cron, günlük) tarafından yazılır: her çalıştığında
--  içinde bulunduğumuz ayın satırını o ana kadarki toplamlarla GÜNCELLER
--  (arac_id + ay tekil) — böylece ay kapanana kadar veriler günlük birikir.
--  Geçmiş aylar sabit kalır. Yazma yalnızca service_role ile; tarayıcı sadece
--  okur (canlı "Çek" ekranındaki gibi anlık API çağrısı YOK, burada kayıtlı
--  veri gösterilir).
-- ============================================================================
create table if not exists public.yakitlar (
  id          bigint generated always as identity primary key,
  arac_id     bigint      not null references public.araclar(id) on delete cascade,
  ay          date        not null,        -- ayın ilk günü, ör. 2026-08-01
  litre       numeric     not null default 0,
  tutar       numeric     not null default 0,
  islem       integer     not null default 0,
  updated_at  timestamptz not null default now(),
  unique (arac_id, ay)
);

create index if not exists yakitlar_ay_idx on public.yakitlar (ay);
create index if not exists yakitlar_arac_id_idx on public.yakitlar (arac_id);

alter table public.yakitlar enable row level security;

drop policy if exists "read_authenticated" on public.yakitlar;
create policy "read_authenticated"
  on public.yakitlar
  for select
  to authenticated
  using (true);

-- ============================================================================
--  TGO ARŞİVİ (2022-2024)  —  tgo_arsiv_2022_2024
--  ----------------------------------------------------------------------------
--  Trendyol GO (grocery) sipariş API'si (packages) eski ayları güvenilir
--  dönmüyor; bu yüzden 2022-02-02 (ilk veri) → 2024-12-31 dönemi Trendyol'un
--  finans/settlements (Cari Hesap Ekstresi) API'sinden tek seferlik olarak bu
--  AYRI arşiv tabloya çekiliyor — raw_orders/analytics_payload'a (canlı pano)
--  KARIŞMIYOR. Doldurma: scripts/tgo-arsiv-doldur.js. Yazma yalnızca
--  service_role ile; tarayıcı sadece okur.
-- ============================================================================
create table if not exists public.tgo_arsiv_2022_2024 (
  id          bigint generated always as identity primary key,
  order_no    text        not null unique,
  store_id    text,
  store_name  text,
  order_date  timestamptz,
  tutar       numeric     not null default 0,   -- "Satış" kalemlerinin credit toplamı
  komisyon    numeric     not null default 0,   -- commissionAmount toplamı
  created_at  timestamptz not null default now()
);

create index if not exists tgo_arsiv_2022_2024_order_date_idx on public.tgo_arsiv_2022_2024 (order_date);

alter table public.tgo_arsiv_2022_2024 enable row level security;

drop policy if exists "read_authenticated" on public.tgo_arsiv_2022_2024;
create policy "read_authenticated"
  on public.tgo_arsiv_2022_2024
  for select
  to authenticated
  using (true);

-- ============================================================================
--  TGO ÜRÜN ARŞİVİ (2022-2024)  —  tgo_urun_arsiv_2022_2024
--  ----------------------------------------------------------------------------
--  tgo_arsiv_2022_2024 sipariş bazında toplanmış (tutar/komisyon); ancak
--  finans/settlements API'sinin ham kayıtları aslında BARKOD bazlı (bir
--  siparişte birden çok satır olabilir). Bu tablo o ham satırları, tekilliği
--  settlements kaydının kendi `id`'siyle korunarak tutar — ürün ADI/kategori
--  YOK (yalnız barkod); onun için ayrıca barkod->ürün eşlemesi gerekir.
--  Doldurma: scripts/tgo-urun-arsiv-doldur.js. Yazma yalnızca service_role
--  ile; tarayıcı sadece okur.
-- ============================================================================
create table if not exists public.tgo_urun_arsiv_2022_2024 (
  id            bigint generated always as identity primary key,
  settlement_id text        not null unique,   -- ham settlements kaydının kendi id'si
  order_no      text,
  barcode       text,
  store_id      text,
  store_name    text,
  order_date    timestamptz,
  tutar         numeric     not null default 0,   -- credit
  komisyon      numeric     not null default 0,   -- commissionAmount
  created_at    timestamptz not null default now()
);

create index if not exists tgo_urun_arsiv_2022_2024_order_no_idx on public.tgo_urun_arsiv_2022_2024 (order_no);
create index if not exists tgo_urun_arsiv_2022_2024_barcode_idx on public.tgo_urun_arsiv_2022_2024 (barcode);
create index if not exists tgo_urun_arsiv_2022_2024_order_date_idx on public.tgo_urun_arsiv_2022_2024 (order_date);

alter table public.tgo_urun_arsiv_2022_2024 enable row level security;

drop policy if exists "read_authenticated" on public.tgo_urun_arsiv_2022_2024;
create policy "read_authenticated"
  on public.tgo_urun_arsiv_2022_2024
  for select
  to authenticated
  using (true);

-- ============================================================================
--  KÂR / ZARAR EK KAYIT  —  kar_zarar
--  ----------------------------------------------------------------------------
--  FİNAL — Kâr/Zarar sayfasının başındaki form. Otomatik hesaba dahil olmayan
--  pazaryeri × ay bazlı gider/gelir kalemleri (jeneratör, POS, telefon kasa)
--  burada elle tutulur ve Pazaryerine göre kâr/zarar tablosunda o pazaryeri +
--  ay ile birebir eşleşir. Doğrudan tarayıcıdan (anon anahtar + oturum)
--  yazılır/okunur — vehicle_logs/araclar ile aynı yetki modeli.
-- ============================================================================
create table if not exists public.kar_zarar (
  id              bigint generated always as identity primary key,
  created_at      timestamptz not null default now(),
  pazaryeri       text,            -- Ticimax | Yemeksepeti | Trendyol
  "yıl"           bigint,
  ay              bigint,
  jen_gideri      numeric,
  pos_gider       numeric,
  tel_kasa_gelir  numeric
);

-- Onceden olusturulmus tablolarda eksikse eklenir (idempotent).
alter table public.kar_zarar add column if not exists pazaryeri text;

create index if not exists kar_zarar_yil_ay_idx on public.kar_zarar ("yıl", ay);
create index if not exists kar_zarar_paz_yil_ay_idx on public.kar_zarar (pazaryeri, "yıl", ay);

alter table public.kar_zarar enable row level security;

drop policy if exists "authenticated_all" on public.kar_zarar;
create policy "authenticated_all"
  on public.kar_zarar
  for all
  to authenticated
  using (true)
  with check (true);

-- ============================================================================
--  PERSONEL  —  bordro listesi (dönem × çalışan)
--  ----------------------------------------------------------------------------
--  "E-Ticaret Otoları" grubu altındaki "Personel" sayfasında salt okunur
--  gösterilir. Kayıtlar elle/Supabase üzerinden girilir (uygulamadan
--  ekleme/düzenleme YOK); tarayıcı yalnızca okur (anon anahtar + oturum).
-- ============================================================================
create table if not exists public.personel (
  id                 bigint generated always as identity primary key,
  created_at         timestamptz not null default now(),
  yil                bigint,
  ay                 bigint,
  ad                 text,
  soyad              text,
  unvan              text,
  bolum              text,
  ise_giris_tarihi   date,
  maas               numeric,
  sgk_prim           numeric,
  g_vergi            numeric,
  d_vergi            numeric
);

create index if not exists personel_yil_ay_idx on public.personel (yil, ay);
create index if not exists personel_bolum_idx on public.personel (bolum);

alter table public.personel enable row level security;

drop policy if exists "read_authenticated" on public.personel;
create policy "read_authenticated"
  on public.personel
  for select
  to authenticated
  using (true);
