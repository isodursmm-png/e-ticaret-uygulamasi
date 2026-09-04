'use strict';
/* ============================================================================
   store-names.js — Mağaza kodu → şube adı varsayılan eşlemesi.
   ----------------------------------------------------------------------------
   normalize.js `STORE_MAP`, önce process.env.STORE_NAMES'e bakar; boşsa bunu
   kullanır. Böylece GitHub Actions / Vercel'de ayrı bir "STORE_NAMES" değişkeni
   tanımlamaya gerek kalmaz. Ortam değişkeni verilirse o kazanır (override).

   Biçim: "kod=Ad; kod=Ad; ..."  (Trendyol GO storeId + Yemeksepeti vendor kodları)
   ========================================================================== */

const DEFAULT_STORE_NAMES = [
  // --- Trendyol GO storeId ---
  '33833=Ahatlı', '33832=Akdeniz Konutları', '319387=Alanya', '33829=Altınova',
  '304406=Ayanoğlu', '33781=Cumartesi Pazarı', '33821=Çağlayan', '33780=Doğu Garajı',
  '304067=Düden', '33841=Erciyes', '33779=Eski Sanayi', '33793=Fakülte',
  '365188=Fethiye', '205623=Gazi', '306501=Göçerler', '33827=Gülveren',
  '33840=Güneş', '33837=Güzeloba', '437227=Karaağaç', '306503=Karatay',
  '306504=Kepez Hastane', '306502=Kızılarık', '33838=Konuksever', '441859=Kundu',
  '375686=Külliye', '368885=Kütükçü', '33800=Liman', '284908=Masadağı',
  '33836=Meydankavağı', '319385=Oba', '33816=Sütçüler', '164837=Şarampol',
  '33797=Şirinyalı', '33789=Uluç', '339266=Varsak', '375684=Yeni Hal',
  // --- Yemeksepeti / Delivery Hero vendor kodları (market + restoran) ---
  'ni1e=Erciyes', 'nie1=Erciyes', 'ze1h=Anamur', 'ovp6=Fethiye',
  'l8nx=Güzeloba', 'lbnx=Güzeloba', 'xz0k=Karaağaç', 'mkv5=Kumluca',
  'hczf=Külliye', 'cphl=Kütükçü', 'woyx=Liman', 'us58=Oba',
  'jpqo=Şarampol', 'cz8u=Şirinyalı', 'j3fg=Uluç', 'fpr4=Uncalı',
  'oci8=Varsak', 'w8bn=Yeni Hal', 'timr=Yeşilbayır', 'r9f2=Ahatlı',
  'bpr8=Gazi', 'dd72=Liman', 'jtbb=Uluç'
].join('; ');

module.exports = { DEFAULT_STORE_NAMES };
