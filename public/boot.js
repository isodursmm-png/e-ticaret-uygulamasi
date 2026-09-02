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
    const { data, error } = await supabase
      .from('analytics_payload')
      .select('data, geo')
      .eq('id', 'eticaret')
      .single();
    if (error) throw error;
    if (!data || !data.data) throw new Error('analytics_payload boş — önce "npm run import" çalıştırın');

    window.__PL__ = data.data;
    window.__GEO__ = data.geo || null;

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

function ceviriHata(m) {
  if (/Invalid login credentials/i.test(m)) return 'E‑posta veya parola hatalı.';
  if (/Email not confirmed/i.test(m)) return 'E‑posta adresi henüz onaylanmamış.';
  return m;
}
