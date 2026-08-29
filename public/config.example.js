/* Bu dosyayı  config.js  adıyla kopyalayın ve Supabase bilgilerinizi girin.
   config.js git'e EKLENMEZ (.gitignore).  Deploy'da (Vercel/Netlify) config.js'i
   ya repoya ekleyin ya da build sırasında bu içerikle oluşturun.

   Değerler:  Supabase > Project Settings > API
     - Project URL       -> SUPABASE_URL
     - Project API keys > anon public  -> SUPABASE_ANON_KEY   (tarayıcıya iner; RLS korur)
*/
window.ETA_CONFIG = {
  SUPABASE_URL: 'https://XXXXXXXXXXXX.supabase.co',
  SUPABASE_ANON_KEY: 'eyJhbGciOi...ANON_PUBLIC_KEY...'
};
