/* ============================================================================
   sources/_util.js  —  canlı kaynak adaptörleri için ortak yardımcılar
   ==========================================================================*/
'use strict';

/** Birden çok olası alan adından ilk dolu olanı döndür. */
function pick(obj, ...keys) {
  for (const k of keys) {
    if (obj == null) return undefined;
    const v = obj[k];
    if (v !== undefined && v !== null && v !== '') return v;
  }
  return undefined;
}

/** ISO / Date -> "GG.AA.YYYY SS:dd"  (normalize.js parseTR bu biçimi bekler) */
function fmtTR(d) {
  const x = (d instanceof Date) ? d : new Date(d);
  if (isNaN(x)) return null;
  const p = (n) => (n < 10 ? '0' + n : '' + n);
  return `${p(x.getDate())}.${p(x.getMonth() + 1)}.${x.getFullYear()} ${p(x.getHours())}:${p(x.getMinutes())}`;
}

/** N gün öncesinin 00:00'ı (yerel). */
function daysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - Number(n || 30));
  d.setHours(0, 0, 0, 0);
  return d;
}

const log = (tag, ...a) => console.log(`  [${tag}]`, ...a);

/** Basit yeniden-deneymeli fetch (JSON). */
async function jget(url, opts = {}, tries = 3) {
  let lastErr;
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, opts);
      const txt = await r.text();
      let body;
      try { body = txt ? JSON.parse(txt) : null; } catch { body = txt; }
      if (!r.ok) throw new Error(`HTTP ${r.status} — ${typeof body === 'string' ? body.slice(0, 300) : JSON.stringify(body).slice(0, 300)}`);
      return body;
    } catch (e) {
      lastErr = e;
      if (i < tries - 1) await new Promise((res) => setTimeout(res, 1500 * (i + 1)));
    }
  }
  throw lastErr;
}

module.exports = { pick, fmtTR, daysAgo, log, jget };
