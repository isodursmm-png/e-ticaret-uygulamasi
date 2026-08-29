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
