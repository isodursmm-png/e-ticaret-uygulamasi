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

alter table public.raw_orders enable row level security;

-- Giriş yapmış kullanıcı okuyabilir; yazma yalnızca service_role (topla.js) ile.
drop policy if exists "read_authenticated" on public.raw_orders;
create policy "read_authenticated"
  on public.raw_orders
  for select
  to authenticated
  using (true);
