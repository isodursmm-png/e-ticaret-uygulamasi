/* ============================================================================
   boot.js  —  Supabase oturumu + veri yükleme, sonra panoyu (app.js) başlatır
   ----------------------------------------------------------------------------
   - config.js  window.ETA_CONFIG = { SUPABASE_URL, SUPABASE_ANON_KEY } sağlar
   - Oturum yoksa giriş kapısı (#authGate) gösterilir
   - Oturum varsa analytics_payload tablosundan tek satır çekilir:
        { data: <PAYLOAD>, geo: <compactGeo> }
     window.__PL__ / window.__GEO__ atanır ve app.js enjekte edilir
   ========================================================================== */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const cfg = window.ETA_CONFIG || {};
if (!cfg.SUPABASE_URL || !cfg.SUPABASE_ANON_KEY) {
  showFatal('config.js eksik veya doldurulmamış. config.example.js dosyasını config.js olarak kopyalayıp Supabase bilgilerini girin.');
  throw new Error('ETA_CONFIG yok');
}

const supabase = createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY, {
  auth: { persistSession: true, autoRefreshToken: true }
});
window.__SB__ = supabase;   // app.js — canlı yazılabilir bölümler (ör. "E-Ticaret Otoları") için

const gate   = document.getElementById('authGate');
const shell  = document.getElementById('appShell');
const form   = document.getElementById('authForm');
const emailI = document.getElementById('agEmail');
const passI  = document.getElementById('agPass');
const btn    = document.getElementById('agBtn');
const msg    = document.getElementById('agMsg');

function showGate(text) {
  gate.classList.add('on');
  shell.classList.remove('ready');
  if (text) { msg.textContent = text; msg.className = 'msg err'; }
}
function hideGate() { gate.classList.remove('on'); }
function showFatal(text) {
  gate.classList.add('on');
  form.innerHTML = `<h2>E‑Ticaret Analizleri</h2><p class="msg err">${text}</p>`;
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  btn.disabled = true; msg.textContent = 'Giriş yapılıyor…'; msg.className = 'msg';
  const { error } = await supabase.auth.signInWithPassword({
    email: emailI.value.trim(), password: passI.value
  });
  if (error) { msg.textContent = ceviriHata(error.message); msg.className = 'msg err'; btn.disabled = false; return; }
  // onAuthStateChange devralır
});

document.getElementById('logoutBtn')?.addEventListener('click', async () => {
  await supabase.auth.signOut();
  location.reload();
});

supabase.auth.onAuthStateChange((_event, session) => {
  if (session) { start(session); } else { showGate(); }
});

(async function init() {
  const { data: { session } } = await supabase.auth.getSession();
  if (session) start(session); else showGate();
})();

let started = false;
async function start(_session) {
  if (started) return; started = true;
  hideGate();
  msg.textContent = '';
  try {
    // 'eticaret' ana satırı ÖNCE tek başına (küçük: {__chunks:N} + geo + meta).
    // Tüm parça satırlarını TEK sorguda çekmek (eski hâl) 10+ parçada ~20 MB
    // ediyor ve Postgres statement_timeout'a takılıyordu ("canceling statement
    // due to statement timeout") — her parça artık AYRI, küçük bir sorguyla
    // (paralel) çekiliyor; hiçbiri tek başına timeout sınırına yaklaşmıyor.
    const { data: main, error } = await supabase
      .from('analytics_payload').select('data, geo').eq('id', 'eticaret').maybeSingle();
    if (error) throw error;
    if (!main || !main.data) throw new Error('analytics_payload boş — önce "npm run topla" / "rebuild-from-raw" çalıştırın');

    let pl = main.data;
    if (pl && pl.__chunks != null) {                       // parçalı: her parçayı ayrı çek → birleştir → gunzip
      const n = pl.__chunks;
      const parts = await fetchChunksLimited(n, 3);
      pl = JSON.parse(await gunzipB64(parts.join('')));
    } else if (pl && pl.__gz) {                            // tek parça gzip
      pl = JSON.parse(await gunzipB64(pl.__gz));
    }
    window.__PL__ = pl;
    window.__GEO__ = main.geo || null;

    // Aylık TÜİK TÜFE (FİNAL segmenti "Enf. %") — ayrı küçük satır, opsiyonel
    try {
      const { data: t } = await supabase
        .from('analytics_payload').select('data').eq('id', 'tufe').maybeSingle();
      window.__TUFE__ = (t && t.data) || null;
    } catch (e) { window.__TUFE__ = null; }

    shell.classList.add('ready');
    mountRefresh();
    const s = document.createElement('script');
    s.src = './app.js';
    s.onerror = () => showFatal('Pano betiği (app.js) yüklenemedi.');
    document.body.appendChild(s);
  } catch (err) {
    started = false;
    showFatal('Veri yüklenemedi: ' + (err.message || err));
  }
}

/* ---- "⟳ Yenile": api/refresh'i tetikler, analytics_payload.updated_at
       değişene kadar bekler, sonra sayfayı yeniler ---- */
async function mountRefresh() {
  const logout = document.getElementById('logoutBtn');
  if (!logout || document.getElementById('refreshBtn')) return;

  const b = document.createElement('button');
  b.type = 'button';
  b.id = 'refreshBtn';
  b.className = logout.className || 'tb-btn';
  b.title = 'Kaynaklardan canlı veriyi çek ve panoyu güncelle';
  b.textContent = '⟳ Yenile';
  logout.parentNode.insertBefore(b, logout);

  const stamp = async () => {
    const { data } = await supabase.from('analytics_payload')
      .select('updated_at').eq('id', 'eticaret').single();
    return data && data.updated_at;
  };

  b.addEventListener('click', async () => {
    if (b.disabled) return;
    const label = b.textContent;
    b.disabled = true;
    b.textContent = '⟳ Tetikleniyor…';
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Oturum bulunamadı, tekrar giriş yapın.');

      const before = await stamp();

      const r = await fetch('/api/refresh', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + session.access_token }
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || j.ok === false) throw new Error(j.error || ('HTTP ' + r.status));

      b.textContent = '⏳ Güncelleniyor…';
      const deadline = Date.now() + 240000; // ~4 dk
      while (Date.now() < deadline) {
        await new Promise((res) => setTimeout(res, 5000));
        const now = await stamp();
        if (now && now !== before) { b.textContent = '✓ Güncellendi'; location.reload(); return; }
      }
      b.textContent = '⌛ Sürüyor…';
      alert('Yenileme başlatıldı, işlem arka planda sürüyor. Birkaç dakika sonra sayfayı elle yenileyin.');
      b.disabled = false;
      setTimeout(() => { b.textContent = label; }, 4000);
    } catch (e) {
      console.error('yenile:', e);
      b.textContent = '✕ Hata';
      alert('Yenileme başarısız: ' + (e.message || e));
      setTimeout(() => { b.disabled = false; b.textContent = label; }, 2500);
    }
  });
}

/** eticaret~p0..n-1 satırlarını sınırlı eşzamanlılıkla (havuz) çeker; her
    parça ayrı, küçük bir sorgu olduğundan tek tek statement_timeout'a
    takılmaz. Tek bir parça yine de zaman aşımına uğrarsa kısa beklemeyle
    2 kez daha dener (geçici bağlantı/kuyruk baskısı olabilir). */
async function fetchChunksLimited(n, concurrency) {
  const results = new Array(n);
  let next = 0;
  async function fetchOne(i) {
    let lastErr;
    for (let t = 0; t < 3; t++) {
      const { data: p, error: pe } = await supabase
        .from('analytics_payload').select('data').eq('id', `eticaret~p${i}`).maybeSingle();
      if (!pe && p && p.data && p.data.__part) return p.data.__part;
      lastErr = pe ? new Error(`parça ${i}: ${pe.message}`) : new Error(`parça ${i} eksik`);
      if (t < 2) await new Promise((r) => setTimeout(r, 1200 * (t + 1)));
    }
    throw lastErr;
  }
  async function worker() {
    while (next < n) { const i = next++; results[i] = await fetchOne(i); }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, n) }, worker));
  return results;
}

/** base64(gzip(json)) → json metni. Modern tarayıcı DecompressionStream'i ile. */
async function gunzipB64(b64) {
  if (typeof DecompressionStream !== 'function') {
    throw new Error('Tarayıcınız sıkıştırılmış veriyi açamıyor (DecompressionStream desteği yok). Güncel bir tarayıcı kullanın.');
  }
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
  return await new Response(stream).text();
}

function ceviriHata(m) {
  if (/Invalid login credentials/i.test(m)) return 'E‑posta veya parola hatalı.';
  if (/Email not confirmed/i.test(m)) return 'E‑posta adresi henüz onaylanmamış.';
  return m;
}
