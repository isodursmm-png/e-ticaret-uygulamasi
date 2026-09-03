"use strict";
if(!window.__PL__){ throw new Error("Veri hazır değil (boot.js önce çalışmalı)"); }
const PL = window.__PL__;
const GEO = window.__GEO__ || null;

/* ---------- veri ---------- */
const ORD = PL.ord.map(r => { const o = {}; PL.ordCols.forEach((c,i)=>o[c]=r[i]); o.mon = o.ds ? o.ds.slice(0,7) : null; return o; });
const ITM = PL.itm.map(r => { const o = {}; PL.itmCols.forEach((c,i)=>o[c]=r[i]); o.mon = o.ds ? o.ds.slice(0,7) : null; return o; });
const CH = ['Ticimax','Yemeksepeti','Trendyol'];
const CH_COL = { Ticimax:'--s1', Yemeksepeti:'--s2', Trendyol:'--s3' };
const MONTHS_TR = {'01':'Oca','02':'Şub','03':'Mar','04':'Nis','05':'May','06':'Haz','07':'Tem','08':'Ağu','09':'Eyl','10':'Eki','11':'Kas','12':'Ara'};
const WEEK = ['Pazartesi','Salı','Çarşamba','Perşembe','Cuma','Cumartesi','Pazar'];

/* Yemeksepeti / Delivery Hero iptal sebebi kodları → Türkçe */
const CANCEL_TR = {
  ITEM_UNAVAILABLE:'Ürün stokta yok', ITEM_NOT_AVAILABLE:'Ürün stokta yok',
  FRAUD_PRANK:'Sahte / şaka sipariş', FRAUD:'Sahte sipariş',
  UNABLE_TO_PAY:'Ödeme yapılamadı', PAYMENT_FAILED:'Ödeme başarısız',
  CLOSED:'Mağaza kapalı', VENDOR_CLOSED:'Mağaza kapalı', RESTAURANT_CLOSED:'Mağaza kapalı',
  TOO_BUSY:'Yoğunluk', VENDOR_BUSY:'Yoğunluk',
  UNABLE_TO_FIND:'Adres bulunamadı', ADDRESS_NOT_FOUND:'Adres bulunamadı', ADDRESS_INCOMPLETE:'Adres eksik',
  WRONG_ORDER_ITEMS_DELIVERED:'Yanlış ürün teslim edildi', WRONG_ITEMS:'Yanlış ürün',
  MISTAKE_ERROR:'Hatalı sipariş', ORDER_ERROR:'Sipariş hatası',
  NEVER_DELIVERED:'Teslim edilemedi', DELIVERY_FAILED:'Teslim edilemedi', LATE_DELIVERY:'Geç teslimat',
  ORDER_MODIFICATION_NOT_POSSIBLE:'Sipariş değişikliği yapılamadı',
  CUSTOMER_CALLED_TO_CANCEL:'Müşteri iptal etti', CUSTOMER_CANCELLED:'Müşteri iptal etti',
  CUSTOMER_UNREACHABLE:'Müşteriye ulaşılamadı', CUSTOMER_NOT_AVAILABLE:'Müşteri adreste yok',
  DUPLICATE_ORDER:'Mükerrer sipariş', TECHNICAL_PROBLEM:'Teknik sorun',
  OUT_OF_DELIVERY_AREA:'Teslimat bölgesi dışı', NO_COURIER_AVAILABLE:'Kurye bulunamadı',
  NO_COURIER:'Kurye bulunamadı', PRICE_MISMATCH:'Fiyat uyuşmazlığı', WRONG_PRICE:'Fiyat hatası',
  OTHER:'Diğer', UNKNOWN:'Bilinmiyor'
};
const crTR = s => {
  if(s==null || s==='') return 'Belirtilmemiş';
  const k=String(s).trim();
  if(CANCEL_TR[k.toUpperCase()]) return CANCEL_TR[k.toUpperCase()];
  if(/^[A-Z0-9_]+$/.test(k)) return k.toLowerCase().replace(/_/g,' ').replace(/(^|\s)\S/g,c=>c.toUpperCase());
  return k;
};

/* ---------- biçimlendirme ---------- */
const nf = new Intl.NumberFormat('tr-TR');
const F = {
  tl: n => '₺' + nf.format(Math.round(n||0)),
  tlk: n => { n=n||0; const a=Math.abs(n);
    if(a>=1e6) return '₺'+(n/1e6).toLocaleString('tr-TR',{maximumFractionDigits:2})+' Mn';
    if(a>=1e3) return '₺'+(n/1e3).toLocaleString('tr-TR',{maximumFractionDigits:1})+' B';
    return '₺'+nf.format(Math.round(n)); },
  n: n => nf.format(Math.round(n||0)),
  n1: n => (n||0).toLocaleString('tr-TR',{maximumFractionDigits:1}),
  pct: n => (n||0).toLocaleString('tr-TR',{maximumFractionDigits:1}) + '%',
  d: s => { if(!s) return '—'; const p=String(s).split('-'); return p[2]+' '+(MONTHS_TR[p[1]]||p[1]); },
  mon: s => { if(!s) return '—'; const p=String(s).split('-'); return (MONTHS_TR[p[1]]||p[1])+' '+p[0]; }
};
const CV = v => getComputedStyle(document.body).getPropertyValue(v).trim() || '#888';
let PAL = {};
function refreshPal(){ ['--s1','--s2','--s3','--s4','--s5','--s6','--s7','--s8','--accent','--amber','--muted','--ink','--ink-2','--hair','--hair-strong','--good','--warn','--crit','--surface','--surface-2','--panel','--page','--heat-0','--heat-1'].forEach(k=>PAL[k]=CV(k)); }
const SER = () => [PAL['--s1'],PAL['--s2'],PAL['--s3'],PAL['--s4'],PAL['--s5'],PAL['--s6'],PAL['--s7'],PAL['--s8']];
function mix(a,b,t){ const p=x=>{x=x.replace('#','').trim();return x.length===3?x.split('').map(c=>parseInt(c+c,16)):[0,2,4].map(i=>parseInt(x.slice(i,i+2),16));};
  const A=p(a),B=p(b); return 'rgb('+A.map((v,i)=>Math.round(v+(B[i]-v)*t)).join(',')+')'; }

/* ---------- durum ---------- */
const S = {
  ch:new Set(CH), from:PL.meta.minDate, to:PL.meta.maxDate,
  city:new Set(), ilce:new Set(), store:new Set(), st:new Set(), src:new Set(), pay:new Set(), q:''
};
const uniqSort = (arr) => [...new Set(arr.filter(Boolean))].sort((a,b)=>String(a).localeCompare(String(b),'tr'));
const DIMS = {
  city:uniqSort(ORD.map(o=>o.city)),
  ilce:uniqSort(ORD.map(o=>o.ilce)),
  store:uniqSort(ORD.map(o=>o.store)),
  st:['Teslim Edildi','İptal','İade','Diğer'],
  src:uniqSort(ORD.map(o=>o.srcGrp)),
  pay:uniqSort(ORD.map(o=>o.pay))
};
const fullRange = () => S.from===PL.meta.minDate && S.to===PL.meta.maxDate;
const _addDays = (s,n) => { const d=new Date(s+'T00:00:00'); d.setDate(d.getDate()+n);
  return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); };
const _clampD = s => s<PL.meta.minDate ? PL.meta.minDate : (s>PL.meta.maxDate ? PL.meta.maxDate : s);
const _lastDom = ym => { const [y,m]=ym.split('-').map(Number); return ym+'-'+String(new Date(y,m,0).getDate()).padStart(2,'0'); };

function fO(){
  return ORD.filter(o=>{
    if(!S.ch.has(o.ch)) return false;
    if(o.ds){ if(o.ds<S.from||o.ds>S.to) return false; } else if(!fullRange()) return false;
    if(S.city.size && !S.city.has(o.city)) return false;
    if(S.ilce.size && !S.ilce.has(o.ilce)) return false;
    if(S.store.size && !S.store.has(o.store)) return false;
    if(S.st.size && !S.st.has(o.st)) return false;
    if(S.src.size && !S.src.has(o.srcGrp)) return false;
    if(S.pay.size && !S.pay.has(o.pay)) return false;
    if(S.q){ const q=S.q.toLocaleLowerCase('tr');
      if(!((o.cust||'')+' '+(o.email||'')+' '+(o.id||'')+' '+(o.addr||'')+' '+(o.ilce||'')).toLocaleLowerCase('tr').includes(q)) return false; }
    return true;
  });
}
function fI(){
  return ITM.filter(o=>{
    if(!S.ch.has(o.ch)) return false;
    if(o.ds){ if(o.ds<S.from||o.ds>S.to) return false; } else if(!fullRange()) return false;
    if(S.city.size && !S.city.has(o.city)) return false;
    if(S.ilce.size && !S.ilce.has(o.ilce)) return false;
    if(S.store.size && !S.store.has(o.store)) return false;
    if(S.st.size && !S.st.has(o.st)) return false;
    if(S.src.size && !S.src.has(o.src) && !S.src.has(o.ch)) return false;
    return true;
  });
}
const deliv = o => o.st==='Teslim Edildi';

/* ---------- agregasyon ---------- */
function groupSum(arr, keyFn, valFn){ const m=new Map(); for(const x of arr){ const k=keyFn(x); if(k==null||k==='') continue; m.set(k,(m.get(k)||0)+(valFn?valFn(x):1)); } return m; }
function topEntries(map, n){ return [...map.entries()].sort((a,b)=>b[1]-a[1]).slice(0,n); }
const sum = (arr,f)=>arr.reduce((s,x)=>s+(f?f(x):x),0);
const range=(a,b)=>{ const r=[]; for(let i=a;i<=b;i++) r.push(i); return r; };

/* ---------- TIP ---------- */
const tip = document.getElementById('tip');
function showTip(html, e){ tip.innerHTML=html; tip.style.opacity=1;
  const r=tip.getBoundingClientRect();
  let x=e.clientX+14, y=e.clientY+14;
  if(x+r.width>innerWidth-8) x=e.clientX-r.width-14;
  if(y+r.height>innerHeight-8) y=e.clientY-r.height-14;
  tip.style.left=x+'px'; tip.style.top=y+'px';
}
function hideTip(){ tip.style.opacity=0; }

/* ============ ÇİZİM (SVG) ============ */
const esc = s => String(s==null?'':s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
function elFromSvg(svg){ const w=document.createElement('div'); w.className='chartwrap'; w.innerHTML=svg; return w; }
function miss(){ const d=document.createElement('div'); d.className='miss'; d.textContent='Bu filtre için veri yok'; return d; }
function bindRows(w){ w.querySelectorAll('.rowh').forEach(g=>{
  g.addEventListener('mousemove',e=>{ const p=g.dataset.t.split('||'); showTip(`<b>${esc(p[0])}</b><br>${esc(p[1])}${p[2]?'<br>'+esc(p[2]):''}`,e); });
  g.addEventListener('mouseleave',hideTip);
}); return w; }
function bindHtml(w){ w.querySelectorAll('[data-html]').forEach(g=>{
  g.addEventListener('mousemove',e=>showTip(g.dataset.html,e));
  g.addEventListener('mouseleave',hideTip);
}); return w; }

function barH(items, {fmt=F.n, maxV=null, unit=''}={}){
  if(!items.length) return miss();
  const W=780, rh=30, padT=6, padB=6;
  const lblW=Math.min(250, 96+Math.max(...items.map(d=>d.label.length))*6.2);
  const H=padT+padB+items.length*rh;
  const max=maxV||Math.max(...items.map(d=>d.value),1);
  const bw=W-lblW-100;
  let s=`<svg viewBox="0 0 ${W} ${H}" role="img">`;
  items.forEach((d,i)=>{
    const y=padT+i*rh, w=Math.max(0, d.value/max*bw), col=d.color||PAL['--accent'];
    s+=`<g class="rowh" data-t="${esc(d.label)}||${esc(fmt(d.value))}${unit}${d.note?'||'+esc(d.note):''}">`;
    s+=`<rect x="0" y="${y}" width="${W}" height="${rh}" fill="transparent"/>`;
    s+=`<text x="${lblW-10}" y="${y+rh/2+4}" text-anchor="end" font-size="12.5" fill="${PAL['--ink-2']}">${esc(d.label.length>34?d.label.slice(0,33)+'…':d.label)}</text>`;
    s+=`<rect x="${lblW}" y="${y+5}" width="${w}" height="${rh-14}" rx="4" fill="${col}"/>`;
    s+=`<text x="${lblW+w+8}" y="${y+rh/2+4}" font-size="12" font-weight="600" fill="${PAL['--ink']}" style="font-variant-numeric:tabular-nums">${esc(fmt(d.value))}${unit}</text>`;
    s+=`</g>`;
  });
  s+=`</svg>`;
  return bindRows(elFromSvg(s));
}

/* Sipariş durumu × kanal — yığılı çubuk + altında anlaşılır değer tablosu */
function statusByChannel(O){
  const sts=['Teslim Edildi','İptal','İade','Diğer'];
  const col={'Teslim Edildi':PAL['--good'],'İptal':PAL['--crit'],'İade':PAL['--warn'],'Diğer':PAL['--muted']};
  const chs=CH.filter(c=>S.ch.has(c));
  const cnt=(c,st)=>O.filter(o=>o.ch===c && o.st===st).length;
  const box=document.createElement('div');
  box.appendChild(barV(chs, sts.map(st=>({name:st,color:col[st],values:chs.map(c=>cnt(c,st))})),{fmt:F.n}));
  let h=`<table class="st-sum"><thead><tr><th>Kanal</th>`+
    sts.map(st=>`<th><span class="d" style="background:${col[st]}"></span>${esc(st)}</th>`).join('')+
    `<th>Toplam</th></tr></thead><tbody>`;
  chs.forEach(c=>{ h+=`<tr><td>${esc(c)}</td>`+
    sts.map(st=>`<td>${F.n(cnt(c,st))}</td>`).join('')+
    `<td class="tt">${F.n(O.filter(o=>o.ch===c).length)}</td></tr>`; });
  h+=`<tr class="tot"><td>Tümü</td>`+
    sts.map(st=>`<td>${F.n(O.filter(o=>o.st===st).length)}</td>`).join('')+
    `<td class="tt">${F.n(O.length)}</td></tr></tbody></table>`;
  box.insertAdjacentHTML('beforeend',h);
  return box;
}

function barV(cats, series, {fmt=F.n, stacked=true, catFmt=(x=>x), note=null, values=false}={}){
  if(!cats.length || !series.length) return miss();
  const W=780, H=290, padL=58, padR=12, padT=14, padB=40;
  const iw=W-padL-padR, ih=H-padT-padB;
  const totals=cats.map((_,ci)=> stacked ? sum(series,se=>se.values[ci]||0) : Math.max(...series.map(se=>se.values[ci]||0),0));
  const max=Math.max(...totals,1);
  const bw=Math.min(46, iw/cats.length*0.7), step=iw/cats.length;
  const yT=v=>padT+ih-(v/max)*ih;
  let s=`<svg viewBox="0 0 ${W} ${H}" role="img">`;
  for(let g=0; g<=4; g++){ const v=max*g/4, y=yT(v);
    s+=`<line x1="${padL}" x2="${W-padR}" y1="${y}" y2="${y}" stroke="${PAL['--hair']}"/>`;
    s+=`<text x="${padL-8}" y="${y+4}" text-anchor="end" font-size="11" fill="${PAL['--ink-2']}">${esc(fmt(v))}</text>`; }
  cats.forEach((c,ci)=>{
    const cx=padL+step*ci+step/2; let acc=0;
    if(stacked){
      series.forEach(se=>{ const v=se.values[ci]||0; if(v<=0) return; const h=(v/max)*ih, y=yT(acc+v); acc+=v;
        s+=`<rect x="${cx-bw/2}" y="${y}" width="${bw}" height="${Math.max(0,h-1.5)}" fill="${se.color}" rx="2"/>`;
        if(values===true && h>=13) s+=`<text x="${cx}" y="${y+h/2+3.5}" text-anchor="middle" font-size="9" font-weight="700" fill="#fff">${esc(fmt(v))}</text>`; });
      if(values==='v' && acc>0){
        const bh=(acc/max)*ih, inside=bh>=64;
        const ty=inside ? yT(acc)+7 : yT(acc)-7;
        s+=`<text x="${cx}" y="${ty}" text-anchor="${inside?'start':'end'}" transform="rotate(-90 ${cx} ${ty})" `+
           `font-size="10.5" font-weight="800" fill="${inside?'#fff':PAL['--ink']}" `+
           `paint-order="stroke" stroke="${inside?'rgba(0,0,0,.4)':PAL['--surface']}" stroke-width="${inside?2.6:3}">${esc(fmt(acc))}</text>`;
      } else if(values===true && acc>0) s+=`<text x="${cx}" y="${yT(acc)-4}" text-anchor="middle" font-size="9.5" font-weight="700" fill="${PAL['--ink']}">${esc(fmt(acc))}</text>`;
    } else {
      const n=series.length, sw=bw/n;
      series.forEach((se,si)=>{ const v=se.values[ci]||0, h=(v/max)*ih, y=yT(v), bx2=cx-bw/2+sw*si;
        s+=`<rect x="${bx2}" y="${y}" width="${Math.max(0,sw-1.5)}" height="${Math.max(0,h)}" fill="${se.color}" rx="2"/>`;
        if(values && v>0) s+=`<text x="${bx2+(sw-1.5)/2}" y="${y-3}" text-anchor="middle" font-size="9" font-weight="700" fill="${PAL['--ink']}">${esc(fmt(v))}</text>`; });
    }
    const tot=stacked?acc:Math.max(...series.map(se=>se.values[ci]||0),0);
    const rows=series.map(se=>`<div><span class='sw' style='background:${se.color}'></span>${esc(se.name)}: <b>${esc(fmt(se.values[ci]||0))}</b></div>`).join('');
    s+=`<rect class="hb" x="${padL+step*ci}" y="${padT}" width="${step}" height="${ih}" fill="transparent" data-html="<b>${esc(catFmt(c))}</b>${series.length>1?'<br>Toplam: <b>'+esc(fmt(tot))+'</b>':''}<br>${rows.replace(/"/g,'&quot;')}"/>`;
    s+=`<text x="${cx}" y="${H-padB+16}" text-anchor="middle" font-size="11.5" font-weight="600" fill="${PAL['--ink-2']}">${esc(catFmt(c))}</text>`;
  });
  s+=`<line x1="${padL}" x2="${W-padR}" y1="${padT+ih}" y2="${padT+ih}" stroke="${PAL['--hair-strong']}"/>`;
  if(note && note.rows && note.rows.length){
    const L=[note.title||'', ...note.rows.map(r=>r.t)];
    const tw=Math.min(iw-8, Math.max(150, Math.max(...L.map(t=>String(t).length))*6.7+18));
    const lh=17, bh=L.length*lh+14, bx=W-padR-tw, by=padT+2;
    s+=`<g>`;
    s+=`<rect x="${bx}" y="${by}" width="${tw}" height="${bh}" rx="7" fill="${PAL['--page']}" stroke="${PAL['--accent']}" stroke-width="1.6" opacity="0.97"/>`;
    if(note.title) s+=`<text x="${bx+9}" y="${by+18}" font-size="12" font-weight="700" fill="${PAL['--muted']}">${esc(note.title)}</text>`;
    note.rows.forEach((r,i)=>{ s+=`<text x="${bx+9}" y="${by+18+(i+(note.title?1:0))*lh}" font-size="12.5" font-weight="700" fill="${r.c||PAL['--ink']}">${esc(r.t)}</text>`; });
    s+=`</g>`;
  }
  s+=`</svg>`;
  const w=bindHtml(elFromSvg(s));
  if(series.length>1){ const l=document.createElement('div'); l.className='legend';
    series.forEach(se=>l.insertAdjacentHTML('beforeend',`<div><i style="background:${se.color}"></i>${esc(se.name)}</div>`)); w.appendChild(l); }
  return w;
}

function lineC(cats, series, {fmt=F.n, catFmt=(x=>x), area=false}={}){
  if(!cats.length) return miss();
  const W=780, H=290, padL=64, padR=16, padT=16, padB=38;
  const iw=W-padL-padR, ih=H-padT-padB;
  const max=Math.max(...series.flatMap(se=>se.values),1)*1.08;
  const xAt=i=>padL+(cats.length===1?iw/2:iw*i/(cats.length-1));
  const yAt=v=>padT+ih-(v/max)*ih;
  let s=`<svg viewBox="0 0 ${W} ${H}" role="img">`;
  for(let g=0; g<=4; g++){ const v=max*g/4, y=yAt(v);
    s+=`<line x1="${padL}" x2="${W-padR}" y1="${y}" y2="${y}" stroke="${PAL['--hair']}"/>`;
    s+=`<text x="${padL-8}" y="${y+4}" text-anchor="end" font-size="11" fill="${PAL['--ink-2']}">${esc(fmt(v))}</text>`; }
  // x ekseni: çok sayıda gün varsa yalnızca ay başlarını "Ay YYYY" olarak etiketle
  const dayLike = cats.length>0 && /^\d{4}-\d{2}-\d{2}$/.test(String(cats[0]));
  const monthMode = dayLike && cats.length>24;
  const tickIdx = monthMode
    ? cats.map((c,i)=> (i===0 || String(c).slice(0,7)!==String(cats[i-1]).slice(0,7)) ? i : -1).filter(i=>i>=0)
    : cats.map((_,i)=>i);
  const tickFmt = monthMode ? (c=>F.mon(c)) : catFmt;
  tickIdx.forEach(i=> s+=`<text x="${xAt(i)}" y="${H-padB+16}" text-anchor="${monthMode?'start':'middle'}" font-size="10.5" fill="${PAL['--muted']}">${esc(tickFmt(cats[i]))}</text>`);
  if(monthMode) tickIdx.forEach(i=> s+=`<line x1="${xAt(i)}" x2="${xAt(i)}" y1="${padT}" y2="${padT+ih}" stroke="${PAL['--hair']}" opacity=".6"/>`);
  series.forEach(se=>{
    const pts=se.values.map((v,i)=>[xAt(i),yAt(v)]);
    if(area && series.length===1)
      s+=`<path d="M${pts.map(p=>p.join(',')).join(' L')} L${xAt(cats.length-1)},${yAt(0)} L${xAt(0)},${yAt(0)} Z" fill="${se.color}" opacity=".12"/>`;
    s+=`<path d="M${pts.map(p=>p.join(',')).join(' L')}" fill="none" stroke="${se.color}" stroke-width="2.2" stroke-linejoin="round"/>`;
    const last=pts[pts.length-1];
    s+=`<circle cx="${last[0]}" cy="${last[1]}" r="4" fill="${se.color}" stroke="${PAL['--surface']}" stroke-width="1.5"/>`;
    s+=`<text x="${last[0]-9}" y="${last[1]-11}" text-anchor="end" font-size="11" font-weight="700" fill="${se.color}" paint-order="stroke" stroke="${PAL['--page']}" stroke-width="3.5">${esc(fmt(se.values[se.values.length-1]))}</text>`;
  });
  // ay başlarındaki gerçek (kısaltmasız) kümülatif değer — çizgiden ayrı, ok/kılavuz çizgisiyle
  if(monthMode && series.length===1){
    const se=series[0];
    tickIdx.forEach(i=>{
      if(i===0 || i > cats.length-8) return;                // 0 ve grafik sonu (uç etiket) hariç
      const v=se.values[i]; if(!(v>0)) return;
      const x=xAt(i), y=yAt(v);
      const ly=Math.max(padT+11, y-28);                     // etiket noktayı ~28px üstünde
      s+=`<line x1="${x}" y1="${y-3}" x2="${x}" y2="${ly+3}" stroke="${se.color}" stroke-width="1.2" opacity=".65"/>`;
      s+=`<circle cx="${x}" cy="${y}" r="3" fill="${se.color}" stroke="${PAL['--surface']}" stroke-width="1"/>`;
      s+=`<text x="${x}" y="${ly}" text-anchor="middle" font-size="10.5" font-weight="700" fill="${se.color}" paint-order="stroke" stroke="${PAL['--page']}" stroke-width="3.5">${esc(fmt(v))}</text>`;
    });
  }
  s+=`<line id="xh" x1="0" x2="0" y1="${padT}" y2="${padT+ih}" stroke="${PAL['--hair-strong']}" opacity="0"/>`;
  cats.forEach((c,i)=>{
    const rows=series.map(se=>`<div><span class='sw' style='background:${se.color}'></span>${esc(se.name)}: <b>${esc(fmt(se.values[i]))}</b></div>`).join('');
    s+=`<rect class="hx" x="${xAt(i)-iw/cats.length/2}" y="${padT}" width="${iw/cats.length}" height="${ih}" fill="transparent" data-x="${xAt(i)}" data-html="<b>${esc(catFmt(c))}</b><br>${rows.replace(/"/g,'&quot;')}"/>`;
  });
  s+=`</svg>`;
  const w=elFromSvg(s);
  const xh=w.querySelector('#xh');
  w.querySelectorAll('.hx').forEach(r=>{
    r.addEventListener('mousemove',e=>{ xh.setAttribute('x1',r.dataset.x); xh.setAttribute('x2',r.dataset.x); xh.setAttribute('opacity','1'); showTip(r.dataset.html,e); });
    r.addEventListener('mouseleave',()=>{ xh.setAttribute('opacity','0'); hideTip(); });
  });
  if(series.length>1){ const l=document.createElement('div'); l.className='legend';
    series.forEach(se=>l.insertAdjacentHTML('beforeend',`<div><i style="background:${se.color}"></i>${esc(se.name)}</div>`)); w.appendChild(l); }
  return w;
}

function donut(items, {fmt=F.n, unitTotal=null}={}){
  items=items.filter(d=>d.value>0);
  if(!items.length) return miss();
  const tot=sum(items,d=>d.value), R=82, r=52, cx=100, cy=100;
  let a=-Math.PI/2, s=`<svg viewBox="0 0 200 200" role="img" style="max-width:210px">`;
  items.forEach(d=>{
    const frac=d.value/tot, a2=a+frac*Math.PI*2, big=frac>0.5?1:0;
    const x1=cx+R*Math.cos(a), y1=cy+R*Math.sin(a), x2=cx+R*Math.cos(a2), y2=cy+R*Math.sin(a2);
    const xi1=cx+r*Math.cos(a2), yi1=cy+r*Math.sin(a2), xi2=cx+r*Math.cos(a), yi2=cy+r*Math.sin(a);
    s+=`<path d="M${x1},${y1} A${R},${R} 0 ${big} 1 ${x2},${y2} L${xi1},${yi1} A${r},${r} 0 ${big} 0 ${xi2},${yi2} Z" fill="${d.color}" stroke="${PAL['--surface']}" stroke-width="1.5" class="rowh" data-t="${esc(d.label)}||${esc(fmt(d.value))} · ${F.pct(frac*100)}"/>`;
    a=a2;
  });
  s+=`<text x="100" y="96" text-anchor="middle" font-size="12" fill="${PAL['--muted']}">Toplam</text>`;
  s+=`<text x="100" y="118" text-anchor="middle" font-size="16" font-weight="700" font-family="Archivo" fill="${PAL['--ink']}">${esc(unitTotal!=null?unitTotal:fmt(tot))}</text>`;
  s+=`</svg>`;
  const wrap=document.createElement('div');
  wrap.style.cssText='display:flex; gap:18px; align-items:center; flex-wrap:wrap; margin-top:10px';
  wrap.appendChild(bindRows(elFromSvg(s)));
  const leg=document.createElement('div'); leg.className='legend'; leg.style.cssText='flex-direction:column; gap:7px; margin:0';
  items.forEach(d=> leg.insertAdjacentHTML('beforeend',`<div><i style="background:${d.color}"></i>${esc(d.label)} · <b style="color:var(--ink)">${esc(fmt(d.value))}</b> <span style="color:var(--muted)">(${F.pct(d.value/tot*100)})</span></div>`));
  wrap.appendChild(leg);
  return wrap;
}

function heat(rowLabels, colLabels, matrix, {fmt=F.n, colFmt=(x=>x)}={}){
  if(!rowLabels.length || !colLabels.length) return miss();
  const cw=Math.max(28, Math.min(54, 620/colLabels.length)), rhh=26;
  const lblW=Math.min(160, 56+Math.max(...rowLabels.map(l=>String(l).length))*6.4);
  const W=lblW+colLabels.length*cw+12, H=34+rowLabels.length*rhh+6;
  const max=Math.max(...matrix.flat(),1);
  let s=`<svg viewBox="0 0 ${W} ${H}" role="img">`;
  colLabels.forEach((c,ci)=> s+=`<text x="${lblW+ci*cw+cw/2}" y="24" text-anchor="middle" font-size="10" fill="${PAL['--muted']}">${esc(colFmt(c))}</text>`);
  rowLabels.forEach((rl,ri)=>{
    s+=`<text x="${lblW-8}" y="${34+ri*rhh+rhh/2+4}" text-anchor="end" font-size="11" fill="${PAL['--ink-2']}">${esc(rl)}</text>`;
    colLabels.forEach((cl,ci)=>{
      const v=matrix[ri][ci]||0, t=v/max;
      s+=`<rect x="${lblW+ci*cw}" y="${34+ri*rhh}" width="${cw-2}" height="${rhh-2}" rx="2" fill="${v?mix(PAL['--heat-0'],PAL['--heat-1'],0.12+t*0.88):PAL['--surface-2']}" class="rowh" data-t="${esc(rl)} · ${esc(colFmt(cl))}||${esc(fmt(v))}"/>`;
      if(t>0.16) s+=`<text x="${lblW+ci*cw+cw/2-1}" y="${34+ri*rhh+rhh/2+4}" text-anchor="middle" font-size="9.5" fill="${t>0.55?'#fff':PAL['--ink-2']}" style="font-variant-numeric:tabular-nums">${esc(fmt(v))}</text>`;
    });
  });
  s+=`</svg>`;
  return bindRows(elFromSvg(s));
}

/* ---------- panel & tablo ---------- */
function panel(title, sub, node, opts){
  const p=document.createElement('div'); p.className='panel';
  p.innerHTML=`<h3>${esc(title)}</h3>`+(sub?`<div class="sub">${esc(sub)}</div>`:'');
  if(node) p.appendChild(node);
  if(opts && opts.mail) p.appendChild(mailBar(p, title));
  return p;
}

/* ---------- grafiği e-posta ile gönder (yerel servis: _kaynak/mail-service.js) ---------- */
const MAIL_SVC='http://localhost:8788';
function panelSvgToPng(panelEl){
  return new Promise((resolve,reject)=>{
    const svg=panelEl.querySelector('svg');
    if(!svg){ reject(new Error('grafik (svg) bulunamadı')); return; }
    const vb=(svg.getAttribute('viewBox')||'').split(/[\s,]+/).map(Number);
    const w=Math.round(vb[2]||svg.clientWidth||800), h=Math.round(vb[3]||svg.clientHeight||400);
    const clone=svg.cloneNode(true);
    clone.setAttribute('xmlns','http://www.w3.org/2000/svg');
    clone.setAttribute('width',w); clone.setAttribute('height',h);
    clone.setAttribute('font-family','"IBM Plex Sans",system-ui,sans-serif');
    const xml=new XMLSerializer().serializeToString(clone);
    const bg=getComputedStyle(panelEl).backgroundColor||'#ffffff';
    const img=new Image();
    img.onload=()=>{
      const sc=2, c=document.createElement('canvas'); c.width=w*sc; c.height=h*sc;
      const ctx=c.getContext('2d'); ctx.scale(sc,sc);
      ctx.fillStyle=bg; ctx.fillRect(0,0,w,h);
      ctx.drawImage(img,0,0,w,h);
      try{ resolve(c.toDataURL('image/png')); }catch(e){ reject(e); }
    };
    img.onerror=()=>reject(new Error('grafik görsele çevrilemedi'));
    img.src='data:image/svg+xml;charset=utf-8,'+encodeURIComponent(xml);
  });
}
function mailBar(panelEl, title){
  const bar=document.createElement('div'); bar.className='pmail';
  bar.innerHTML=`<span class="pmail-ic">📧</span>`+
    `<input type="email" class="pmail-in" placeholder="e-posta adresi" autocomplete="email" spellcheck="false">`+
    `<button type="button" class="pmail-btn">Grafiği gönder</button>`+
    `<span class="pmail-msg"></span>`;
  const inp=bar.querySelector('.pmail-in'), btn=bar.querySelector('.pmail-btn'), msg=bar.querySelector('.pmail-msg');
  const setMsg=(t,cls)=>{ msg.textContent=t; msg.className='pmail-msg'+(cls?' '+cls:''); };
  btn.onclick=async()=>{
    const to=(inp.value||'').trim();
    if(!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)){ setMsg('Geçerli bir e-posta girin','err'); inp.focus(); return; }
    setMsg('Hazırlanıyor…'); btn.disabled=true;
    try{
      const png=await panelSvgToPng(panelEl);
      const extra=(panelEl.querySelector('.heat-note')||panelEl.querySelector('.sub'));
      const ozet=title+(extra?' — '+extra.textContent.replace(/\s+/g,' ').trim():'')+
        (fullRange()?' · tüm veri':' · '+F.d(S.from)+' – '+F.d(S.to));
      const r=await fetch(MAIL_SVC+'/gonder',{method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({to,konu:'E-Ticaret Analizleri — '+title,png,ozet})});
      const j=await r.json().catch(()=>({ok:false,hata:'yanıt okunamadı'}));
      if(j.ok) setMsg('Gönderildi ✓','ok'); else setMsg(j.hata||'Gönderilemedi','err');
    }catch(e){
      setMsg('Yerel servis kapalı — çalıştırın: node _kaynak/mail-service.js','err');
    }finally{ btn.disabled=false; }
  };
  inp.addEventListener('keydown',e=>{ if(e.key==='Enter') btn.click(); });
  return bar;
}
function dataTable(cols, rows, {sortDir=-1, per=12, foot=null, shade=null}={}){
  const wrap=document.createElement('div');
  let st=cols.findIndex(c=>c.def); if(st<0) st=1; let sd=sortDir, pg=0;
  function render(){
    const sorted=[...rows].sort((a,b)=>{ const va=a[cols[st].key], vb=b[cols[st].key];
      if(typeof va==='number'&&typeof vb==='number') return (va-vb)*sd;
      return String(va==null?'':va).localeCompare(String(vb==null?'':vb),'tr')*sd; });
    const pages=Math.max(1,Math.ceil(sorted.length/per)); if(pg>=pages) pg=pages-1;
    const slice=sorted.slice(pg*per,pg*per+per);
    const mx={}; if(shade) shade.forEach(k=> mx[k]=Math.max(...rows.map(r=>+r[k]||0),1));
    let h=`<div class="tbl-scroll"><table class="dt"><thead><tr>`;
    cols.forEach((c,i)=> h+=`<th data-i="${i}">${esc(c.label)}${i===st?(sd<0?' ▾':' ▴'):''}</th>`);
    h+=`</tr></thead><tbody>`;
    slice.forEach(r=>{
      h+=`<tr>`;
      cols.forEach(c=>{
        const raw=r[c.key];
        const val=c.fmt?c.fmt(raw,r):esc(raw==null?'—':raw);
        const sh=shade&&shade.includes(c.key)&&+raw>0 ? ` style="background:${mix(PAL['--surface'],PAL['--accent'], (+raw/mx[c.key])*0.5)}"` : '';
        h+=`<td class="${typeof raw==='number'?'num':''}"${sh}>${val}</td>`;
      });
      h+=`</tr>`;
    });
    h+=`</tbody>`;
    if(foot) h+=`<tfoot><tr>`+cols.map(c=>`<td class="${typeof foot[c.key]==='number'?'num':''}">${foot[c.key]==null?'':(c.fmt?c.fmt(foot[c.key],foot):esc(foot[c.key]))}</td>`).join('')+`</tr></tfoot>`;
    h+=`</table></div><div class="pgr"><span>${sorted.length} kayıt</span><button data-p="prev" ${pg===0?'disabled':''}>‹</button><span>${pg+1}/${pages}</span><button data-p="next" ${pg>=pages-1?'disabled':''}>›</button></div>`;
    wrap.innerHTML=h;
    wrap.querySelectorAll('th').forEach(th=>th.onclick=()=>{ const i=+th.dataset.i; if(i===st) sd=-sd; else{ st=i; sd=-1; } pg=0; render(); });
    wrap.querySelector('[data-p="prev"]').onclick=()=>{ pg--; render(); };
    wrap.querySelector('[data-p="next"]').onclick=()=>{ pg++; render(); };
  }
  render();
  return wrap;
}

/* pivot / matris (sipariş bazlı) */
function pivot(O, {rowKey, colKey, metric, rowTop=26, colTop=18, rowFmt=(x=>x), colFmt=(x=>x), fmt=null}){
  const mfn = {
    ciro:{v:o=>deliv(o)?o.ciro:0, f:F.tlk}, sip:{v:()=>1, f:F.n}, adet:{v:o=>o.qty||0, f:F.n},
    net:{v:o=>deliv(o)?o.net:0, f:F.tlk}, kom:{v:o=>o.kom||0, f:F.tlk},
    aov:{v:o=>deliv(o)?o.ciro:0, f:F.tl, avg:true}
  }[metric];
  if(fmt) mfn.f = fmt;
  const rowsMap=groupSum(O,o=>o[rowKey],mfn.v), rowCnt=groupSum(O,o=>o[rowKey],()=>1);
  const rl=[...rowsMap.entries()].sort((a,b)=>b[1]-a[1]).map(e=>e[0]).slice(0,rowTop);
  const colsMap=groupSum(O,o=>o[colKey],mfn.v), colCnt=groupSum(O,o=>o[colKey],()=>1);
  let cl;
  if(['ds','mon','wd','hr'].includes(colKey)){
    cl=[...colsMap.keys()].sort((a,b)=> colKey==='wd' ? WEEK.indexOf(a)-WEEK.indexOf(b) : String(a).localeCompare(String(b),undefined,{numeric:true}));
  } else {
    cl=[...colsMap.entries()].sort((a,b)=>b[1]-a[1]).map(e=>e[0]).slice(0,colTop);
  }
  const cell=new Map(), cellC=new Map();
  for(const o of O){ const rk=o[rowKey], ck=o[colKey]; if(rk==null||ck==null||rk===''||ck==='') continue;
    const key=rk+''+ck; cell.set(key,(cell.get(key)||0)+mfn.v(o)); cellC.set(key,(cellC.get(key)||0)+1); }
  const gv=(r,c)=>{ const k=r+''+c, sv=cell.get(k)||0; return mfn.avg ? (cellC.get(k)?sv/cellC.get(k):0) : sv; };
  const max=Math.max(...rl.flatMap(r=>cl.map(c=>gv(r,c))),1);
  let h=`<div class="tbl-scroll"><table class="dt"><thead><tr><th>${esc(rowFmt.label||'')}</th>`;
  cl.forEach(c=> h+=`<th>${esc(colFmt(c))}</th>`); h+=`<th>Toplam</th></tr></thead><tbody>`;
  rl.forEach(r=>{
    h+=`<tr><td>${esc(rowFmt(r))}</td>`;
    cl.forEach(c=>{ const v=gv(r,c);
      h+=`<td class="num" style="${v?`background:${mix(PAL['--surface'],PAL['--accent'],(v/max)*0.55)}`:''}">${v?esc(mfn.f(v)):'·'}</td>`; });
    const tot = mfn.avg ? (rowCnt.get(r)? rowsMap.get(r)/rowCnt.get(r):0) : rowsMap.get(r);
    h+=`<td class="num"><b>${esc(mfn.f(tot))}</b></td></tr>`;
  });
  h+=`</tbody><tfoot><tr><td>Toplam</td>`;
  cl.forEach(c=>{ const v = mfn.avg ? (colCnt.get(c)?colsMap.get(c)/colCnt.get(c):0) : (colsMap.get(c)||0); h+=`<td class="num">${esc(mfn.f(v))}</td>`; });
  h+=`<td class="num">${esc(mfn.f(mfn.avg? sum(O,mfn.v)/Math.max(O.length,1) : sum(O,mfn.v)))}</td></tr></tfoot></table></div>`;
  const w=document.createElement('div'); w.innerHTML=h; return w;
}
/* pivot (ürün kalemi bazlı) */
function pivotItm(I,{rowKey,colKey,metric,label,rowTop=24,colTop=16}){
  const vf = metric==='ciro'? (x=>x.amt) : (x=>x.qty);
  const ff = metric==='ciro'? F.tlk : F.n;
  const rm=groupSum(I,x=>x[rowKey],vf); const rl=topEntries(rm,rowTop).map(e=>e[0]);
  const cm=groupSum(I,x=>x[colKey],vf); const cl=topEntries(cm,colTop).map(e=>e[0]);
  const cell=new Map();
  for(const x of I){ const k=x[rowKey]+''+x[colKey]; cell.set(k,(cell.get(k)||0)+vf(x)); }
  const gv=(r,c)=>cell.get(r+''+c)||0;
  const max=Math.max(...rl.flatMap(r=>cl.map(c=>gv(r,c))),1);
  let h=`<div class="tbl-scroll"><table class="dt"><thead><tr><th>${esc(label)}</th>`+cl.map(c=>`<th>${esc(c)}</th>`).join('')+`<th>Toplam</th></tr></thead><tbody>`;
  rl.forEach(r=>{ h+=`<tr><td>${esc(r)}</td>`;
    cl.forEach(c=>{ const vv=gv(r,c); h+=`<td class="num" style="${vv?`background:${mix(PAL['--surface'],PAL['--accent'],(vv/max)*0.55)}`:''}">${vv?esc(ff(vv)):'·'}</td>`; });
    h+=`<td class="num"><b>${esc(ff(rm.get(r)||0))}</b></td></tr>`; });
  h+=`</tbody><tfoot><tr><td>Toplam</td>`+cl.map(c=>`<td class="num">${esc(ff(cm.get(c)||0))}</td>`).join('')+`<td class="num">${esc(ff(sum(I,vf)))}</td></tr></tfoot></table></div>`;
  const w=document.createElement('div'); w.innerHTML=h; return w;
}

/* ============ TÜRKİYE HARİTASI ============ */
/* Leaflet varsa gerçek harita altlığı (uydu / normal geçişli), yoksa SVG'ye düşer */
let _trMap = null;
function turkeyMap(rows){
  return (window.L && GEO && GEO.prov) ? turkeyMapLeaflet(rows) : turkeyMapSVG(rows);
}

/* Harita etiketleri: üst üste binmesin — kılavuz çizgiyle (ok) kenara taşır, dikey istifler */
function addLeaderLabels(map, items){
  const NS='http://www.w3.org/2000/svg';
  const box=document.createElement('div'); box.className='trll';
  const svg=document.createElementNS(NS,'svg'); svg.setAttribute('class','trll-svg');
  box.appendChild(svg);
  map.getContainer().appendChild(box);
  const el=cn=>document.createElementNS(NS,cn);
  function draw(){
    const sz=map.getSize();
    svg.setAttribute('width',sz.x); svg.setAttribute('height',sz.y);
    while(svg.firstChild) svg.removeChild(svg.firstChild);
    const cx=sz.x/2, M=6;
    const pts=items.map(it=>{ const p=map.latLngToContainerPoint([it.lat,it.lng]);
      const tw=Math.max(String(it.name).length, (it.ciroTxt+'  '+it.sipTxt).length)*6.6+16;
      return {...it, x:p.x, y:p.y, w:tw, h:44}; }).sort((a,b)=>a.y-b.y);
    const placed={ '-1':[], '1':[] };
    const LEN=40, GAP=8;
    pts.forEach(it=>{
      const side = it.x>cx ? -1 : 1;
      const arr=placed[side];
      let ly=it.y-it.h/2;
      for(let i=0;i<arr.length;i++){ const r=arr[i];
        if(ly < r.y+r.h+GAP && ly+it.h+GAP > r.y){ ly=r.y+r.h+GAP; i=-1; } }
      // etiketi harita kutusunun içine sıkıştır — kenardan taşmasın
      ly = Math.max(M, Math.min(ly, sz.y - it.h - M));
      let lx = side<0 ? it.x - it.r - LEN - it.w : it.x + it.r + LEN;
      lx = Math.max(M, Math.min(lx, sz.x - it.w - M));
      arr.push({y:ly,h:it.h});
      const x0=it.x + side*(it.r+2), x1=(side<0?lx+it.w:lx), y1=ly+it.h/2;
      const path=el('path');
      path.setAttribute('d',`M${x0},${it.y} L${x0+side*10},${it.y} L${x1-side*8},${y1} L${x1},${y1}`);
      path.setAttribute('class','trll-line'); svg.appendChild(path);
      const dot=el('circle'); dot.setAttribute('cx',x1); dot.setAttribute('cy',y1);
      dot.setAttribute('r',2.6); dot.setAttribute('class','trll-dot'); svg.appendChild(dot);
      const fo=el('foreignObject');
      fo.setAttribute('x',lx); fo.setAttribute('y',ly); fo.setAttribute('width',it.w); fo.setAttribute('height',it.h);
      fo.innerHTML=`<div xmlns="http://www.w3.org/1999/xhtml" class="trll-lbl ${side<0?'l':'r'}">`+
        `<span class="n">${esc(it.name)}</span><span class="c">${esc(it.ciroTxt)}</span>`+
        `<span class="s">${esc(it.sipTxt)}</span></div>`;
      svg.appendChild(fo);
    });
  }
  const onMove=()=>draw();
  map.on('move zoom zoomend moveend resize viewreset',onMove);
  draw();
  return { draw, remove(){ map.off('move zoom zoomend moveend resize viewreset',onMove); box.remove(); } };
}

function turkeyMapLeaflet(rows){
  const wrap = document.createElement('div');
  const el = document.createElement('div'); el.className='trmap'; wrap.appendChild(el);

  const cen = {}; for(const p of GEO.prov) cen[p.n]=p.c;               // [lon,lat]
  const withXY = rows.filter(r=>r.ciro>0 && cen[r.il]).sort((a,b)=>b.ciro-a.ciro);
  const noc = rows.filter(r=>r.ciro>0 && !cen[r.il]);
  const maxC = Math.max(...withXY.map(r=>r.ciro), 1);
  const bb = GEO.bbox || [25.6,35.8,44.9,42.2];

  setTimeout(()=>{
    if(_trMap){ try{ _trMap.remove(); }catch(e){} _trMap=null; }
    const acc = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#5fa0e6';
    const map = L.map(el, { scrollWheelZoom:false, zoomControl:true, attributionControl:true, maxBoundsViscosity:1, preferCanvas:true });
    _trMap = map;

    const normal = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
      { maxZoom:18, className:'trmap-normal', attribution:'© OpenStreetMap' });
    const uydu = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      { maxZoom:19, attribution:'Görüntü © Esri, Maxar, Earthstar Geographics' });
    normal.addTo(map);
    L.control.layers({ 'Harita': normal, 'Uydu': uydu }, null, { position:'topright', collapsed:false }).addTo(map);

    // Türkiye'yi ekranda ortala; solda/sağda kılavuz etiketlerine boşluk bırak
    const trB = L.latLngBounds([[bb[1], bb[0]], [bb[3], bb[2]]]);
    const fitTR = () => {
      map.invalidateSize(true);
      const gutter = Math.min(190, Math.max(60, map.getSize().x * 0.16));
      const pad = L.point(gutter, 24);
      map.setMinZoom(0);
      map.fitBounds(trB, { paddingTopLeft:pad, paddingBottomRight:pad });
      map.setMaxBounds(trB.pad(0.1));
      map.setMinZoom(map.getBoundsZoom(trB, false, pad));
    };
    fitTR();

    // ---- Türkiye dışını panel zeminiyle maskele: yalnızca ülke sınırları görünür ----
    const maskFill = getComputedStyle(document.documentElement).getPropertyValue('--panel').trim() || '#12223d';
    const world = [[85,-180],[85,180],[-85,180],[-85,-180]];
    const holes = [];
    for(const p of GEO.prov) for(const ring of p.p) holes.push(ring.map(pt=>[pt[1],pt[0]]));
    L.polygon([world, ...holes], { stroke:true, color:'#ffffff', weight:0.5, opacity:0.3,
      fill:true, fillColor:maskFill, fillOpacity:1, interactive:false }).addTo(map);

    const labelItems=[];
    for(const r of withXY){
      const [lo,la] = cen[r.il];
      const rad = 6 + Math.sqrt(r.ciro/maxC) * 34;
      const mk = L.circleMarker([la,lo], { radius:rad, color:'#fff', weight:1.6, fillColor:acc, fillOpacity:0.6 });
      mk.bindPopup(`<b>${esc(r.il)}</b><br>${F.tl(r.ciro)} ciro · ${F.n(r.sip)} sipariş · ${F.n(r.adet)} adet`);
      mk.addTo(map);
      labelItems.push({ lat:la, lng:lo, r:rad, name:r.il, ciroTxt:F.tl(r.ciro), sipTxt:F.n(r.sip)+' sipariş' });
    }
    const ll = addLeaderLabels(map, labelItems.slice(0, 14));   // en çok cirolu 14 il etiketlenir
    map.on('unload', ()=>ll.remove());
    setTimeout(()=>{ fitTR(); ll.draw(); }, 80);
    try{ new ResizeObserver(()=>{ map.invalidateSize(); ll.draw(); }).observe(el); }catch(e){}
  }, 0);

  if(noc.length){ const d=document.createElement('div'); d.className='sub'; d.style.marginTop='8px';
    d.textContent='Haritada eşleşmeyen iller: '+noc.map(r=>r.il+' ('+F.tl(r.ciro)+')').join(', '); wrap.appendChild(d); }
  return wrap;
}

/* ---- SVG yedeği (Leaflet yüklenemezse) ---- */
function turkeyMapSVG(rows){
  const W=960, H=452, m=8;
  const bb = (GEO&&GEO.bbox) || [25.6,35.8,44.9,42.2];
  const kx = Math.cos(((bb[1]+bb[3])/2)*Math.PI/180);   // enlem düzeltmesi
  const gx = lo => lo*kx;
  const spanX = gx(bb[2])-gx(bb[0]), spanY = bb[3]-bb[1];
  const sc = Math.min((W-2*m)/spanX, (H-2*m)/spanY);
  const offX = m + ((W-2*m)-spanX*sc)/2, offY = m + ((H-2*m)-spanY*sc)/2;
  const X = lo => offX + (gx(lo)-gx(bb[0]))*sc;
  const Y = la => offY + (bb[3]-la)*sc;
  const byName = new Map(rows.map(r=>[r.il, r]));
  const maxC = Math.max(...rows.map(r=>r.ciro),1);
  // boş il = belirgin kara zemini (panel fonundan net ayrışır); satışlı il = ısı gradyanı (taban yükseltildi)
  const shade = v => v>0 ? mix(PAL['--heat-0'],PAL['--heat-1'], 0.34 + 0.66*Math.pow(v/maxC,0.45)) : mix(PAL['--surface-2'],PAL['--ink-2'],0.22);
  const dOf = rings => rings.map(r=>'M'+r.map(([lo,la])=>X(lo).toFixed(1)+','+Y(la).toFixed(1)).join('L')+'Z').join('');

  let s=`<svg viewBox="0 0 ${W} ${H}" role="img" style="max-height:520px">`;
  s+=`<defs><filter id="trmapsh" x="-6%" y="-6%" width="112%" height="112%"><feDropShadow dx="0" dy="2" stdDeviation="3" flood-color="#000" flood-opacity="0.30"/></filter></defs>`;
  // iller
  if(GEO && GEO.prov){
    s+=`<g filter="url(#trmapsh)">`;
    for(const p of GEO.prov){
      const r = byName.get(p.n);
      const tip = r && r.ciro>0
        ? `${esc(p.n)}||${F.tl(r.ciro)} ciro · ${F.n(r.sip)} sipariş · ${F.n(r.adet)} adet`
        : `${esc(p.n)}||sipariş yok`;
      s+=`<path class="prov rowh" d="${dOf(p.p)}" fill="${shade(r?r.ciro:0)}" stroke="${PAL['--ink-2']}" stroke-width="0.9" stroke-opacity="0.55" data-t="${tip}"/>`;
    }
    s+=`</g>`;
  } else {
    s+=`<rect x="0" y="0" width="${W}" height="${H}" fill="${PAL['--surface-2']}"/>`;
  }
  // kabarcık + etiketler (yalnızca satışı olan iller)
  const halo=`paint-order="stroke" stroke="${PAL['--surface']}" stroke-width="3.6" stroke-linejoin="round"`;
  const cName=PAL['--ink'], cCiro=PAL['--accent'], cSip=PAL['--amber'];
  const cen = {}; if(GEO&&GEO.prov) for(const p of GEO.prov) cen[p.n]=p.c;
  const withXY = rows.filter(r=>r.ciro>0 && cen[r.il]).sort((a,b)=>b.ciro-a.ciro);
  const noc = rows.filter(r=>r.ciro>0 && !cen[r.il]);
  for(const r of withXY){
    const [lo,la]=cen[r.il], cx=X(lo), cy=Y(la), rad=5+Math.sqrt(r.ciro/maxC)*32;
    const val=F.tl(r.ciro), sip=F.n(r.sip)+' sipariş';
    s+=`<circle class="bub rowh" cx="${cx}" cy="${cy}" r="${rad}" fill="${PAL['--accent']}" fill-opacity="0.55" stroke="${PAL['--surface']}" stroke-width="1.4" data-t="${esc(r.il)}||${F.tl(r.ciro)} ciro · ${F.n(r.sip)} sipariş · ${F.n(r.adet)} adet"/>`;
    if(rad>=26){
      s+=`<text x="${cx}" y="${cy-6}" text-anchor="middle" font-size="13" font-weight="700" fill="${cName}" ${halo} style="pointer-events:none">${esc(r.il)}</text>`;
      s+=`<text x="${cx}" y="${cy+11}" text-anchor="middle" font-size="12.5" font-weight="700" fill="${cCiro}" ${halo} style="pointer-events:none">${esc(val)}</text>`;
      s+=`<text x="${cx}" y="${cy+27}" text-anchor="middle" font-size="10.5" font-weight="600" fill="${cSip}" ${halo} style="pointer-events:none">${esc(sip)}</text>`;
    } else {
      const left = cx>W*0.6;
      const x0=left?cx-rad:cx+rad, x1=left?cx-rad-20:cx+rad+20, tx=left?x1-5:x1+5, anc=left?'end':'start';
      s+=`<line x1="${x0}" y1="${cy}" x2="${x1}" y2="${cy}" stroke="${PAL['--ink-2']}" stroke-width="1.3"/>`;
      s+=`<circle cx="${x1}" cy="${cy}" r="2.6" fill="${cCiro}"/>`;
      s+=`<text x="${tx}" y="${cy-3}" text-anchor="${anc}" font-size="12" font-weight="700" fill="${cName}" ${halo} style="pointer-events:none">${esc(r.il)}</text>`;
      s+=`<text x="${tx}" y="${cy+12}" text-anchor="${anc}" ${halo} style="pointer-events:none"><tspan font-size="11" font-weight="700" fill="${cCiro}">${esc(val)}</tspan><tspan font-size="10.5" fill="${cSip}"> · ${esc(sip)}</tspan></text>`;
    }
  }
  s+=`</svg>`;
  const w=bindRows(elFromSvg(s));
  if(noc.length){ const d=document.createElement('div'); d.className='sub'; d.style.marginTop='8px';
    d.textContent='Haritada eşleşmeyen iller: '+noc.map(r=>r.il+' ('+F.tl(r.ciro)+')').join(', '); w.appendChild(d); }
  return w;
}

/* ============ BÖLÜMLER ============ */
const SECTIONS=[
  {grp:'ÖZET', items:[['genel','Genel Bakış','▨']]},
  {grp:'SATIŞ', items:[['ciro','Ciro & Kümülatif','₺'],['siparis','Sipariş & Adet','#']]},
  {grp:'OPERASYON', items:[['teslimat','Teslimatlar','⇲'],['zaman','Sipariş & Teslim Saati','◔']]},
  {grp:'MÜŞTERİ', items:[['musteri','Müşteri / CRM','☺']]},
  {grp:'DAĞITIM', items:[['kanal','Kanal & Mağaza','⊞'],['kategori','Kategori & Ürün','⬡'],['cografya','Şehir · İlçe · Bölge','⌖']]},
  {grp:'KAYNAK', items:[['kaynak','Sipariş Kaynağı','⇱']]},
  {grp:'MATRİS', items:[['matris','Matris Merkezi','▦']]},
  {grp:'VERİ', items:[['veri','Ham Veri & Dışa Aktar','⤓']]}
];
const TITLES=Object.fromEntries(SECTIONS.flatMap(s=>s.items.map(i=>[i[0],i[1]])));
const GRP_COL={'ÖZET':'--accent','SATIŞ':'--s1','OPERASYON':'--s4','MÜŞTERİ':'--s5','DAĞITIM':'--s3','KAYNAK':'--s7','MATRİS':'--s2','VERİ':'--muted'};

function kpi(k,v,s,cls){ return `<div class="kpi"><div class="k">${esc(k)}</div><div class="v">${esc(v)}</div>${s?`<div class="s ${cls||''}">${esc(s)}</div>`:''}</div>`; }
function kpirow(html){ const d=document.createElement('div'); d.className='kpirow'; d.innerHTML=html; return d; }
const catsDates = O => [...new Set(O.map(o=>o.ds).filter(Boolean))].sort();
function seriesByCh(O, cats, key, valFn){
  return CH.filter(c=>S.ch.has(c)).map(c=>({ name:c, color:CV(CH_COL[c]),
    values:cats.map(k=> sum(O.filter(o=>o.ch===c && o[key]===k), valFn)) }));
}
function heatDayHour(O){
  const days=WEEK.filter(d=>O.some(o=>o.wd===d));
  const hours=range(7,23);
  const M=days.map(d=>hours.map(h=>O.filter(o=>o.wd===d&&o.hr===h).length));
  const el=heat(days,hours,M,{fmt:F.n,colFmt:h=>h});
  if(!days.length) return el;
  let peak={v:-1,d:'',h:0};
  days.forEach((d,ri)=>hours.forEach((h,ci)=>{ if(M[ri][ci]>peak.v) peak={v:M[ri][ci],d,h}; }));
  const total=O.length;
  const bestDay=days.map((d,ri)=>({d,v:M[ri].reduce((a,b)=>a+b,0)})).sort((a,b)=>b.v-a.v)[0];
  const bestHour=hours.map((h,ci)=>({h,v:days.reduce((a,_,ri)=>a+M[ri][ci],0)})).sort((a,b)=>b.v-a.v)[0];
  const hh=x=>String(x).padStart(2,'0')+':00';
  const rng=fullRange()?'tüm veri':`${F.d(S.from)} – ${F.d(S.to)}`;
  const wrap=document.createElement('div');
  const note=document.createElement('div'); note.className='heat-note';
  note.innerHTML=`<span class="hn-lbl">Dönem · ${esc(rng)}</span>`+
    `<span><b>${F.n(total)}</b> sipariş</span>`+
    `<span>En yoğun dilim: <b>${esc(peak.d)} ${hh(peak.h)}</b> · ${F.n(peak.v)}</span>`+
    `<span>En yoğun gün: <b>${esc(bestDay.d)}</b> · ${F.n(bestDay.v)}</span>`+
    `<span>En yoğun saat: <b>${hh(bestHour.h)}</b> · ${F.n(bestHour.v)}</span>`;
  wrap.appendChild(note); wrap.appendChild(el);
  return wrap;
}
function storeAgg(O){
  const m=new Map();
  for(const o of O){ let r=m.get(o.store); if(!r){ r={store:o.store,sip:0,adet:0,ciro:0,_d:0}; m.set(o.store,r); }
    r.sip++; r.adet+=o.qty||0; if(deliv(o)){ r.ciro+=o.ciro; r._d++; } }
  return [...m.values()].map(r=>({...r,aov:r._d?r.ciro/r._d:0}));
}
function histo(vals,edges,fmt){
  const labels=[], counts=[];
  for(let i=0;i<edges.length;i++){ const lo=edges[i], hi=edges[i+1];
    labels.push(hi==null?('≥'+fmt(lo)):(fmt(lo)+'–'+fmt(hi)));
    counts.push(vals.filter(x=> x>=lo && (hi==null||x<hi)).length); }
  return barV(labels,[{name:'Adet',color:PAL['--accent'],values:counts}],{fmt:F.n,values:true});
}

/* ================= RENDER ================= */
const RENDERERS={};
function render(){
  refreshPal();
  const view=document.getElementById('view'); view.innerHTML='';
  const hash=(location.hash.replace('#/','')||'genel');
  document.getElementById('ttl').textContent=TITLES[hash]||'Genel Bakış';
  document.querySelectorAll('#nav a').forEach(a=>a.classList.toggle('on', a.dataset.k===hash));
  (RENDERERS[hash]||RENDERERS.genel)(view);
  renderChips();
  renderDateBar();
  syncBrandSrc();
  requestAnimationFrame(enableTopScrollbars);
}

/* Geniş tablolara üstte de yatay kaydırma çubuğu (alttakiyle senkron) */
function enableTopScrollbars(){
  document.querySelectorAll('#view .tbl-scroll').forEach(sc=>{
    const prev=sc.previousElementSibling;
    if(prev && prev.classList.contains('tbl-scroll-top')) prev.remove();
    const tbl=sc.querySelector('table'); if(!tbl) return;
    if(tbl.scrollWidth <= sc.clientWidth+4) return;         // taşma yoksa gerek yok
    const top=document.createElement('div'); top.className='tbl-scroll-top';
    const inner=document.createElement('div'); inner.className='tbl-scroll-top-inner';
    inner.style.width=tbl.scrollWidth+'px';
    top.appendChild(inner);
    sc.parentNode.insertBefore(top, sc);
    let lock=false;
    top.addEventListener('scroll',()=>{ if(lock)return; lock=true; sc.scrollLeft=top.scrollLeft; lock=false; });
    sc.addEventListener('scroll',()=>{ if(lock)return; lock=true; top.scrollLeft=sc.scrollLeft; lock=false; });
  });
}

function syncBrandSrc(){
  const bs=document.getElementById('brandSrc'); if(!bs) return;
  const all=S.ch.size>=CH.length;
  bs.querySelectorAll('.src-pill').forEach(b=>{
    const c=b.dataset.ch;
    b.classList.toggle('on', c==='__all__' ? all : (!all && S.ch.has(c)));
  });
}

/** Bir yılın haftaları (Pazartesi başlangıçlı, 52–53). Yıla taşan uçlar dahil. */
function _weeksOf(y){
  const iso=d=>d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
  const jan1=new Date(y,0,1);
  const mon=new Date(jan1); mon.setDate(jan1.getDate()-((jan1.getDay()+6)%7));
  const out=[];
  for(let n=1;n<=53;n++){
    const f=new Date(mon), t=new Date(mon); t.setDate(mon.getDate()+6);
    if(f.getFullYear()>y) break;
    out.push({ n, from:iso(f), to:iso(t) });
    if(t.getFullYear()>y) break;
    mon.setDate(mon.getDate()+7);
  }
  return out;
}
const _dm = s => s.slice(8)+'.'+s.slice(5,7);   // "YYYY-MM-DD" -> "DD.MM"

function renderDateBar(){
  const host=document.getElementById('dr'); if(!host) return;
  const isR = r => S.from===r.from && S.to===r.to;
  const full = fullRange();
  const yr = y => ({ from:_clampD(y+'-01-01'), to:_clampD(y+'-12-31') });
  const years=[]; for(let y=+PL.meta.maxDate.slice(0,4); y>=+PL.meta.minDate.slice(0,4); y--) years.push(y);
  const curYear = years.find(y=>isR(yr(y)));
  const isYear = curYear!=null;
  // Ay/Hafta planı: seçili yılın (yoksa en güncel yılın) ayları/haftaları
  const planYear = curYear || +PL.meta.maxDate.slice(0,4);
  const moRange = ym => ({ from:_clampD(ym+'-01'), to:_clampD(_lastDom(ym)) });
  const months=[]; for(let m=1;m<=12;m++) months.push(planYear+'-'+String(m).padStart(2,'0'));
  const curMonth = months.find(ym=>isR(moRange(ym)));
  const isMonth = curMonth!=null;
  const weeks = _weeksOf(planYear);
  const curWeek = weeks.find(w=>isR({from:_clampD(w.from),to:_clampD(w.to)}));
  const isWeek = curWeek!=null;
  const wasOpen = !!(host.querySelector('.dr-inputs.open')) || (!full && !isYear && !isWeek && !isMonth);
  host.innerHTML =
    `<span class="drlbl">Dönem</span>`+
    `<select class="dr-sel${isYear?' on':''}" id="drYear" title="Yıla göre süz">`+
      `<option value="">📅 Yıl</option>`+
      years.map(y=>`<option value="${y}"${curYear===y?' selected':''}>${y}</option>`).join('')+
    `</select>`+
    `<select class="dr-sel dr-mo${isMonth?' on':''}" id="drMonth" title="Aya göre süz (${planYear})">`+
      `<option value="">📅 Ay</option>`+
      months.map(ym=>`<option value="${ym}"${curMonth===ym?' selected':''}>${F.mon(ym)}</option>`).join('')+
    `</select>`+
    `<select class="dr-sel dr-wk${isWeek?' on':''}" id="drWeek" title="Haftaya göre süz (${planYear})">`+
      `<option value="">🗓️ Hafta</option>`+
      weeks.map(w=>`<option value="${w.n}"${curWeek&&curWeek.n===w.n?' selected':''}>H${w.n} · ${_dm(w.from)}–${_dm(w.to)}</option>`).join('')+
    `</select>`+
    `<button class="dr-btn dr-ta${!full&&!isMonth&&!isWeek&&!isYear?' on':''}" data-a="ta">📆 Tarih aralığı</button>`+
    `<button class="dr-btn dr-all${full?' on':''}" data-a="all">∞ Tümü</button>`+
    `<button class="dr-btn dr-nav" data-nav="-1" title="Önceki dönem"${full?' disabled':''}>‹</button>`+
    `<button class="dr-btn dr-nav" data-nav="1" title="Sonraki dönem"${full?' disabled':''}>›</button>`+
    `<span class="dr-inputs${wasOpen?' open':''}" id="drIn">`+
      `<input type="date" id="drFrom" min="${PL.meta.minDate}" max="${PL.meta.maxDate}" value="${S.from}">`+
      `<span>–</span>`+
      `<input type="date" id="drTo" min="${PL.meta.minDate}" max="${PL.meta.maxDate}" value="${S.to}"></span>`;
  const go = () => { buildFilters(); render(); };
  host.querySelector('#drYear').onchange = e => { const y=+e.target.value; if(!y) return; const r=yr(y); S.from=r.from; S.to=r.to; go(); };
  host.querySelector('#drMonth').onchange = e => { const ym=e.target.value; if(!ym) return; const r=moRange(ym); S.from=r.from; S.to=r.to; go(); };
  host.querySelector('#drWeek').onchange = e => { const w=weeks.find(x=>x.n===+e.target.value); if(!w) return; S.from=_clampD(w.from); S.to=_clampD(w.to); go(); };
  host.querySelector('[data-a="all"]').onclick = () => { S.from=PL.meta.minDate; S.to=PL.meta.maxDate; go(); };
  host.querySelector('[data-a="ta"]').onclick = () => document.getElementById('drIn').classList.toggle('open');
  host.querySelectorAll('[data-nav]').forEach(b=>b.onclick = () => shiftRange(+b.dataset.nav));
  host.querySelector('#drFrom').onchange = e => { S.from=e.target.value||PL.meta.minDate; if(S.from>S.to) S.to=S.from; go(); };
  host.querySelector('#drTo').onchange = e => { S.to=e.target.value||PL.meta.maxDate; if(S.to<S.from) S.from=S.to; go(); };
}

/* Seçili dönemi bir birim ileri/geri kaydır (dir = -1 önceki, +1 sonraki).
   Tam ay / tam yıl seçiliyse takvim adımıyla, değilse aralık uzunluğu kadar gün kaydırır. */
function shiftRange(dir){
  if(fullRange()) return;
  const f=S.from, t=S.to;
  const isMonth = f.slice(8)==='01' && f.slice(0,7)===t.slice(0,7) && t===_lastDom(f.slice(0,7));
  const isYear  = f.slice(5)==='01-01' && f.slice(0,4)===t.slice(0,4) && (t.slice(5)==='12-31' || t===PL.meta.maxDate);
  let nf, nt;
  if(isYear){ const y=(+f.slice(0,4))+dir; nf=y+'-01-01'; nt=y+'-12-31'; }
  else if(isMonth){ const d=new Date(+f.slice(0,4), (+f.slice(5,7))-1+dir, 1);
    const ym=d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0'); nf=ym+'-01'; nt=_lastDom(ym); }
  else { const span=Math.round((Date.parse(t)-Date.parse(f))/864e5)+1; nf=_addDays(f,dir*span); nt=_addDays(t,dir*span); }
  nf=_clampD(nf); nt=_clampD(nt);
  if(nf===S.from && nt===S.to) return;   // kenardayız
  S.from=nf; S.to=nt; buildFilters(); render();
}

RENDERERS.genel=(v)=>{
  const O=fO(), D=O.filter(deliv);
  const ciro=sum(D,o=>o.ciro), sip=O.length, adet=sum(O,o=>o.qty||0);
  const iptal=O.filter(o=>o.st==='İptal').length, kom=sum(O,o=>o.kom), net=sum(D,o=>o.net);
  v.appendChild(kpirow(
    kpi('Ciro (teslim edilen)',F.tl(ciro),F.mon(PL.meta.minDate)+' · '+[...S.ch].length+' kanal')+
    kpi('Sipariş adedi',F.n(sip), D.length+' teslim · '+iptal+' iptal')+
    kpi('Ürün adedi (miktar)',F.n(adet), (sip?F.n1(adet/sip):'0')+' ürün/sipariş')+
    kpi('Ortalama sepet',F.tl(D.length?ciro/D.length:0),'teslim edilen')+
    kpi('Teslim oranı',F.pct(sip?D.length/sip*100:0), iptal+' iptal ('+F.pct(sip?iptal/sip*100:0)+')')+
    kpi('Komisyon',F.tl(kom),'pazaryeri kesintisi')+
    kpi('Net hakediş',F.tl(net),'komisyon sonrası')+
    kpi('Aktif mağaza',F.n(new Set(O.map(o=>o.store)).size),'şube')
  ));
  const cats=catsDates(O);
  let acc=0; const cum=cats.map(d=>{ acc+=sum(D.filter(o=>o.ds===d),o=>o.ciro); return acc; });
  const g=document.createElement('div'); g.className='grid g2'; v.appendChild(g);
  g.appendChild(panel('Kümülatif ciro','Gün gün biriken teslim cirosu',
    lineC(cats,[{name:'Kümülatif',color:PAL['--accent'],values:cum}],{fmt:F.tl,catFmt:F.d,area:true})));
  g.appendChild(panel('Günlük ciro','Kanal kırılımı, teslim edilen',
    barV(cats, seriesByCh(D,cats,'ds',o=>o.ciro),{fmt:F.tlk,catFmt:F.d})));
  const g2=document.createElement('div'); g2.className='grid g3'; v.appendChild(g2);
  g2.appendChild(panel('Kanala göre ciro payı',null,
    donut(CH.filter(c=>S.ch.has(c)).map(c=>({label:c,value:sum(D.filter(o=>o.ch===c),o=>o.ciro),color:CV(CH_COL[c])})),{fmt:F.tlk})));
  g2.appendChild(panel('Kanala göre sipariş',null,
    donut(CH.filter(c=>S.ch.has(c)).map(c=>({label:c,value:O.filter(o=>o.ch===c).length,color:CV(CH_COL[c])})),{fmt:F.n})));
  g2.appendChild(panel('Sipariş durumu (kanal)',null,statusByChannel(O)));

  // --- Aylık net ciro matrisleri (satır: pazaryeri / mağaza · kolon: ay) ---
  v.appendChild(panel('Pazaryeri × Ay — net ciro','Teslim edilen siparişlerin aylık net hakedişi',
    pivot(O,{rowKey:'ch', colKey:'mon', metric:'net', rowTop:9,
      rowFmt:Object.assign(x=>x,{label:'Pazaryeri'}), colFmt:F.mon, fmt:F.tl})));
  v.appendChild(panel('Mağaza × Ay — net ciro','Şube bazında aylık net hakediş',
    pivot(O,{rowKey:'store', colKey:'mon', metric:'net', rowTop:40,
      rowFmt:Object.assign(x=>x,{label:'Mağaza'}), colFmt:F.mon, fmt:F.tl})));

  v.appendChild(panel('Sipariş yoğunluğu — haftanın günü × saat','Sipariş sayısı', heatDayHour(O), {mail:true}));
};

RENDERERS.ciro=(v)=>{
  const O=fO(), D=O.filter(deliv), cats=catsDates(O);
  let acc=0; const cum=cats.map(d=>{ acc+=sum(D.filter(o=>o.ds===d),o=>o.ciro); return acc; });
  const cumCh=CH.filter(c=>S.ch.has(c)).map(c=>{ let a=0; return {name:c,color:CV(CH_COL[c]),values:cats.map(d=>{ a+=sum(D.filter(o=>o.ds===d&&o.ch===c),o=>o.ciro); return a; })}; });
  v.appendChild(panel('Kümülatif ciro — toplam','Biriken teslim cirosu',
    lineC(cats,[{name:'Toplam',color:PAL['--accent'],values:cum}],{fmt:F.tl,catFmt:F.d,area:true})));
  v.appendChild(panel('Kümülatif ciro — kanal bazlı',null, lineC(cats,cumCh,{fmt:F.tl,catFmt:F.d})));
  const g=document.createElement('div'); g.className='grid g2'; v.appendChild(g);
  g.appendChild(panel('Günlük ciro','Kanal kırılımı', barV(cats,seriesByCh(D,cats,'ds',o=>o.ciro),{fmt:F.tlk,catFmt:F.d})));
  g.appendChild(panel('Haftanın gününe göre ciro',null,(()=>{
    const W=WEEK.filter(d=>D.some(o=>o.wd===d));
    return barV(W,[{name:'Ciro',color:PAL['--accent'],values:W.map(d=>sum(D.filter(o=>o.wd===d),o=>o.ciro))}],{fmt:F.tlk});
  })()));
  g.appendChild(panel('Saate göre ciro','0–23',
    barV(range(0,23),[{name:'Ciro',color:PAL['--accent'],values:range(0,23).map(h=>sum(D.filter(o=>o.hr===h),o=>o.ciro))}],{fmt:F.tlk})));
  g.appendChild(panel('Kanala göre ortalama sepet (AOV)',null,
    barH(CH.filter(c=>S.ch.has(c)).map(c=>{ const dd=D.filter(o=>o.ch===c); return {label:c,value:dd.length?sum(dd,o=>o.ciro)/dd.length:0,color:CV(CH_COL[c])}; }),{fmt:F.tl})));
  g.appendChild(panel('Sepet tutarı dağılımı','Teslim edilen sipariş sayısı',
    histo(D.map(o=>o.ciro),[0,150,300,500,750,1000,1500,2500],F.tl)));
  g.appendChild(panel('Aylık ciro','Veri: '+F.d(PL.meta.minDate)+' – '+F.d(PL.meta.maxDate),
    barV([...new Set(D.map(o=>o.mon))].sort(),seriesByCh(D,[...new Set(D.map(o=>o.mon))].sort(),'mon',o=>o.ciro),{fmt:F.tl,catFmt:F.mon,values:'v'})));
};

RENDERERS.siparis=(v)=>{
  const O=fO(), D=O.filter(deliv), adet=sum(O,o=>o.qty||0);
  v.appendChild(kpirow(
    kpi('Sipariş adedi',F.n(O.length))+
    kpi('Ürün adedi',F.n(adet))+
    kpi('Sipariş başına ürün',F.n1(O.length?adet/O.length:0))+
    kpi('İptal',F.n(O.filter(o=>o.st==='İptal').length),F.pct(O.length?O.filter(o=>o.st==='İptal').length/O.length*100:0))+
    kpi('Ort. sepet (adet)',F.n1(D.length?sum(D,o=>o.qty)/D.length:0),'teslim edilen')
  ));
  const cats=catsDates(O);
  const g=document.createElement('div'); g.className='grid g2'; v.appendChild(g);
  g.appendChild(panel('Günlük sipariş adedi','Kanal kırılımı', barV(cats,seriesByCh(O,cats,'ds',()=>1),{fmt:F.n,catFmt:F.d})));
  g.appendChild(panel('Günlük ürün adedi (miktar)',null, barV(cats,seriesByCh(O,cats,'ds',o=>o.qty||0),{fmt:F.n,catFmt:F.d})));
  g.appendChild(panel('Haftanın gününe göre sipariş',null,(()=>{
    const W=WEEK.filter(d=>O.some(o=>o.wd===d)); return barV(W,seriesByCh(O,W,'wd',()=>1),{fmt:F.n});
  })()));
  g.appendChild(panel('Saate göre sipariş','0–23', barV(range(0,23),seriesByCh(O,range(0,23),'hr',()=>1),{fmt:F.n})));
  g.appendChild(panel('Sipariş başına ürün adedi dağılımı',null, histo(O.map(o=>o.qty||0),[1,2,3,4,6,9,13,20],x=>x)));
  g.appendChild(panel('Mağazaya göre sipariş & adet',null,
    dataTable([
      {key:'store',label:'Mağaza'},{key:'sip',label:'Sipariş',fmt:F.n,def:true},
      {key:'adet',label:'Ürün adedi',fmt:F.n},{key:'ciro',label:'Ciro',fmt:F.tl},{key:'aov',label:'AOV',fmt:F.tl}
    ], storeAgg(O),{per:12,shade:['sip','ciro']})));
};

RENDERERS.teslimat=(v)=>{
  const O=fO();
  const leadH=o=> o.lead!=null ? o.lead/60 : null;
  const withLead=O.filter(o=>o.lead!=null && o.lead>0 && o.lead<60*72);
  v.appendChild(kpirow(
    kpi('Teslim edildi',F.n(O.filter(o=>o.st==='Teslim Edildi').length))+
    kpi('İptal',F.n(O.filter(o=>o.st==='İptal').length))+
    kpi('İade',F.n(O.filter(o=>o.st==='İade').length))+
    kpi('İptal oranı',F.pct(O.length?O.filter(o=>o.st==='İptal').length/O.length*100:0))+
    kpi('Ort. teslim süresi',(withLead.length?F.n1(sum(withLead,leadH)/withLead.length)+' sa':'—'),'sipariş → teslim')
  ));
  const g=document.createElement('div'); g.className='grid g2'; v.appendChild(g);
  g.appendChild(panel('Durum kırılımı (kanal)',null,statusByChannel(O)));
  g.appendChild(panel('Teslim süresi dağılımı','Sipariş → teslim (saat). Ticimax = planlanan slot.',
    histo(withLead.map(leadH),[0,1,2,4,8,16,24,48],x=>F.n1(x)+'sa')));
  g.appendChild(panel('Kanala göre ort. teslim süresi',null,
    barH(CH.filter(c=>S.ch.has(c)).map(c=>{ const w=withLead.filter(o=>o.ch===c); return {label:c,value:w.length?sum(w,leadH)/w.length:0,color:CV(CH_COL[c]),note:w.length+' sipariş'}; }),{fmt:x=>F.n1(x)+' sa'})));
  g.appendChild(panel('Teslim saati (gerçekleşen)','Teslimatın yapıldığı saat',
    barV(range(7,23),[{name:'Teslimat',color:PAL['--accent'],values:range(7,23).map(h=>O.filter(o=>o.dh===h).length)}],{fmt:F.n})));
  g.appendChild(panel('Ticimax teslimat slotu','Seçilen teslimat zaman aralığı',(()=>{
    const m=groupSum(O.filter(o=>o.slot),o=>o.slot,()=>1);
    return topEntries(m,12).length? barH(topEntries(m,12).map(([k,vv])=>({label:String(k).replace(/ Arası( Teslimat)?/,''),value:vv,color:PAL['--s1']})),{fmt:F.n}) : miss();
  })()));
  g.appendChild(panel('İptal sebepleri (Yemeksepeti)',null,(()=>{
    const e=topEntries(groupSum(O.filter(o=>o.cr),o=>crTR(o.cr),()=>1),10);
    return e.length? barH(e.map(([k,vv])=>({label:k,value:vv,color:PAL['--crit']})),{fmt:F.n}) : miss();
  })()));
};

RENDERERS.zaman=(v)=>{
  const O=fO();
  v.appendChild(panel('Sipariş yoğunluğu — haftanın günü × saat','Sipariş sayısı', heatDayHour(O), {mail:true}));
  const g=document.createElement('div'); g.className='grid g2'; v.appendChild(g);
  g.appendChild(panel('Sipariş saati dağılımı','Kanal kırılımı', barV(range(0,23),seriesByCh(O,range(0,23),'hr',()=>1),{fmt:F.n})));
  g.appendChild(panel('Teslim saati dağılımı',null,
    barV(range(0,23),[{name:'Teslimat',color:PAL['--accent'],values:range(0,23).map(h=>O.filter(o=>o.dh===h).length)}],{fmt:F.n})));
  g.appendChild(panel('Tarih × saat yoğunluğu',null,(()=>{
    const ds=catsDates(O), hs=range(7,23);
    return heat(ds.map(F.d),hs,ds.map(d=>hs.map(h=>O.filter(o=>o.ds===d&&o.hr===h).length)),{fmt:F.n});
  })()));
  g.appendChild(panel('Haftanın gününe göre ort. teslim süresi','saat',(()=>{
    const W=WEEK.filter(d=>O.some(o=>o.wd===d));
    const wl=O.filter(o=>o.lead!=null&&o.lead>0&&o.lead<60*72);
    return barV(W,[{name:'Süre',color:PAL['--amber'],values:W.map(d=>{ const x=wl.filter(o=>o.wd===d); return x.length?sum(x,o=>o.lead/60)/x.length:0; })}],{fmt:F.n1});
  })()));
  v.appendChild(panel('Teslimat adresi bazlı liste','Sipariş saati · teslim saati · süre',
    dataTable([
      {key:'id',label:'Sipariş'},{key:'ch',label:'Kanal'},{key:'ilce',label:'İlçe'},
      {key:'addr',label:'Adres', fmt:x=>esc(x?String(x).slice(0,46):'—')},
      {key:'ord',label:'Sipariş zamanı'},{key:'del',label:'Teslim zamanı'},
      {key:'leadh',label:'Süre (sa)', fmt:x=> x==null?'—':F.n1(x)}
    ], O.map(o=>({
        id:String(o.id).replace(/^[A-Z]+-/,''), ch:o.ch, ilce:o.ilce||'—', addr:o.addr,
        ord:(o.ds?F.d(o.ds):'—')+(o.hr!=null?' '+String(o.hr).padStart(2,'0')+':00':''),
        del:(o.dds?F.d(o.dds):'—')+(o.dh!=null?' '+String(o.dh).padStart(2,'0')+':00':''),
        leadh:(o.lead!=null&&o.lead>0)?o.lead/60:null })),
      {per:15})));
};

RENDERERS.musteri=(v)=>{
  const O=fO(), tic=O.filter(o=>o.ch==='Ticimax' && o.ck);
  const nt=document.createElement('div'); nt.className='note';
  nt.innerHTML='Müşteri kimliği (ad, e‑posta, telefon, üyelik tarihi) yalnızca <b>Ticimax</b> siparişlerinde var. Yemeksepeti ve Trendyol müşteri verisi paylaşmadığı için bu bölüm Ticimax üzerinden hesaplanır.';
  v.appendChild(nt);
  const cm=new Map();
  for(const o of tic){ let r=cm.get(o.ck); if(!r){ r={ck:o.ck,cust:o.cust,sip:0,adet:0,ciro:0,last:'',city:o.city||'—',ilce:o.ilce||'—',isNew:o.isNew}; cm.set(o.ck,r); }
    r.sip++; r.adet+=o.qty||0; if(deliv(o)) r.ciro+=o.ciro;
    if((o.ds||'')>=r.last){ r.last=o.ds; if(o.city) r.city=o.city; if(o.ilce) r.ilce=o.ilce; } }
  const custs=[...cm.values()];
  const nw=custs.filter(c=>c.isNew===1).length, rp=custs.filter(c=>c.isNew===0).length, rep=custs.filter(c=>c.sip>1).length;
  v.appendChild(kpirow(
    kpi('Benzersiz müşteri',F.n(custs.length),'Ticimax')+
    kpi('Yeni müşteri',F.n(nw),'bu dönem üye oldu')+
    kpi('Mevcut müşteri',F.n(rp),'önceden üye')+
    kpi('Birden fazla sipariş',F.n(rep),F.pct(custs.length?rep/custs.length*100:0)+' tekrar oranı')+
    kpi('Müşteri başına ciro',F.tl(custs.length?sum(custs,c=>c.ciro)/custs.length:0))+
    kpi('Müşteri başına sipariş',F.n1(custs.length?sum(custs,c=>c.sip)/custs.length:0))
  ));
  const g=document.createElement('div'); g.className='grid g2'; v.appendChild(g);
  g.appendChild(panel('Yeni vs mevcut müşteri','Sipariş adedi',
    donut([{label:'Yeni üye',value:tic.filter(o=>o.isNew===1).length,color:PAL['--s3']},{label:'Mevcut üye',value:tic.filter(o=>o.isNew===0).length,color:PAL['--s1']}],{fmt:F.n})));
  g.appendChild(panel('Ödeme yöntemi (tüm kanallar)',null,
    donut(topEntries(groupSum(O,o=>o.pay,()=>1),7).map(([k,vv],i)=>({label:k,value:vv,color:SER()[i]})),{fmt:F.n})));
  v.appendChild(panel('Müşteri başına sipariş adedi','Kaç müşteri, kaç sipariş vermiş', histo(custs.map(c=>c.sip),[1,2,3,4,6,10],x=>x)));
  v.appendChild(panel('En çok sipariş veren müşteriler','İl / ilçe: müşterinin en son siparişine göre',
    dataTable([
      {key:'cust',label:'Müşteri',fmt:x=>esc(x||'—')},
      {key:'city',label:'İl',fmt:x=>esc(x||'—')},{key:'ilce',label:'İlçe',fmt:x=>esc(x||'—')},
      {key:'sip',label:'Sipariş',fmt:F.n,def:true},
      {key:'adet',label:'Ürün',fmt:F.n},{key:'ciro',label:'Ciro',fmt:F.tl},{key:'last',label:'Son sipariş',fmt:x=>esc(F.d(x))}
    ], custs,{per:15,shade:['sip','ciro']})));
  v.appendChild(panel('Kampanya kullanımı (Ticimax)',null,(()=>{
    const e=topEntries(groupSum(O.filter(o=>o.camp),o=>o.camp,()=>1),12);
    return e.length? barH(e.map(([k,vv])=>({label:k,value:vv,color:PAL['--s4']})),{fmt:F.n}):miss();
  })()));
};

RENDERERS.kanal=(v)=>{
  const O=fO();
  const rows=CH.filter(c=>S.ch.has(c)).map(c=>{
    const cc=O.filter(o=>o.ch===c), dd=cc.filter(deliv);
    return {ch:c,sip:cc.length,adet:sum(cc,o=>o.qty||0),ciro:sum(dd,o=>o.ciro),
      aov:dd.length?sum(dd,o=>o.ciro)/dd.length:0, ipt:cc.length?cc.filter(o=>o.st==='İptal').length/cc.length*100:0,
      kom:sum(cc,o=>o.kom), net:sum(dd,o=>o.net)};
  });
  const dCount=O.filter(deliv).length;
  const foot={ch:'Toplam',sip:sum(rows,r=>r.sip),adet:sum(rows,r=>r.adet),ciro:sum(rows,r=>r.ciro),
    aov:dCount?sum(rows,r=>r.ciro)/dCount:0,ipt:null,kom:sum(rows,r=>r.kom),net:sum(rows,r=>r.net)};
  v.appendChild(panel('Kanal kırılımı','Ciro = teslim edilen siparişler',
    dataTable([
      {key:'ch',label:'Kanal'},{key:'sip',label:'Sipariş',fmt:F.n},{key:'adet',label:'Ürün adedi',fmt:F.n},
      {key:'ciro',label:'Ciro',fmt:F.tl,def:true},{key:'aov',label:'AOV',fmt:F.tl},
      {key:'ipt',label:'İptal %',fmt:x=>x==null?'':F.pct(x)},{key:'kom',label:'Komisyon',fmt:F.tl},{key:'net',label:'Net',fmt:F.tl}
    ],rows,{per:10,foot,shade:['ciro','sip']})));
  const g=document.createElement('div'); g.className='grid g2'; v.appendChild(g);
  g.appendChild(panel('Kanala göre ciro',null, barH(rows.map(r=>({label:r.ch,value:r.ciro,color:CV(CH_COL[r.ch])})),{fmt:F.tl})));
  g.appendChild(panel('Mağaza/şube cirosu','Teslim edilen — ilk 15',
    barH(topEntries(groupSum(O.filter(deliv),o=>o.store,o=>o.ciro),15).map(([k,vv])=>({label:k,value:vv,color:PAL['--accent']})),{fmt:F.tlk})));
  v.appendChild(panel('Mağaza performansı',null,
    dataTable([
      {key:'store',label:'Mağaza'},{key:'sip',label:'Sipariş',fmt:F.n},{key:'adet',label:'Ürün',fmt:F.n},
      {key:'ciro',label:'Ciro',fmt:F.tl,def:true},{key:'aov',label:'AOV',fmt:F.tl}
    ],storeAgg(O),{per:15,shade:['ciro','sip']})));
  v.appendChild(panel('Matris — Mağaza × Kanal','Metrik: ciro (teslim edilen)',
    pivot(O,{rowKey:'store',colKey:'ch',metric:'ciro',rowFmt:Object.assign(x=>x,{label:'Mağaza'})})));
  v.appendChild(panel('Matris — Ödeme yöntemi × Kanal','Metrik: sipariş adedi',
    pivot(O,{rowKey:'pay',colKey:'ch',metric:'sip',rowFmt:Object.assign(x=>x,{label:'Ödeme'})})));
};

RENDERERS.kategori=(v)=>{
  const I=fI();
  const catCiro=groupSum(I.filter(x=>x.amt>0),x=>x.cat,x=>x.amt);
  const catAdet=groupSum(I,x=>x.cat,x=>x.qty);
  const brand=groupSum(I,x=>x.brand,x=>x.qty);
  v.appendChild(kpirow(
    kpi('Kategori sayısı',F.n(new Set(I.map(x=>x.cat)).size))+
    kpi('Ürün çeşidi',F.n(new Set(I.map(x=>x.prod)).size))+
    kpi('Toplam adet',F.n(sum(I,x=>x.qty)))+
    kpi('En çok satan kategori',(topEntries(catAdet,1)[0]||['—'])[0])
  ));
  const nt=document.createElement('div'); nt.className='note';
  nt.innerHTML='Yemeksepeti kalemlerinde birim fiyat/kategori yok → <b>ciro</b> bazlı ürün analizleri Ticimax + Trendyol, <b>adet</b> bazlı analizler üç kanal.';
  v.appendChild(nt);
  const g=document.createElement('div'); g.className='grid g2'; v.appendChild(g);
  g.appendChild(panel('En çok ciro yapan kategoriler',null,
    barH(topEntries(catCiro,14).map(([k,vv])=>({label:k,value:vv,color:PAL['--accent']})),{fmt:F.tlk})));
  g.appendChild(panel('En çok satan kategoriler (adet)',null,
    barH(topEntries(catAdet,14).map(([k,vv])=>({label:k,value:vv,color:PAL['--s1']})),{fmt:F.n})));
  g.appendChild(panel('En çok satan markalar (adet)',null,
    barH(topEntries(brand,14).filter(([k])=>k!=='Diğer').map(([k,vv])=>({label:k,value:vv,color:PAL['--s3']})),{fmt:F.n})));
  g.appendChild(panel('En çok satan ürünler',null,
    dataTable([
      {key:'prod',label:'Ürün'},{key:'ch',label:'Kanal'},{key:'qty',label:'Adet',fmt:F.n,def:true},{key:'amt',label:'Ciro',fmt:F.tl}
    ], (()=>{ const m=new Map();
      for(const x of I){ if(!x.prod) continue; const k=x.prod+'|'+x.ch; let r=m.get(k); if(!r){ r={prod:x.prod,ch:x.ch,qty:0,amt:0}; m.set(k,r); } r.qty+=x.qty; r.amt+=x.amt; }
      return [...m.values()]; })(),{per:15,shade:['qty','amt']})));
  v.appendChild(panel('Matris — Kategori × Kanal','Metrik: ürün adedi',
    pivotItm(I,{rowKey:'cat',colKey:'ch',metric:'adet',label:'Kategori'})));
  v.appendChild(panel('Matris — Kategori × Mağaza','Metrik: ciro (Ticimax + Trendyol)',
    pivotItm(I,{rowKey:'cat',colKey:'store',metric:'ciro',label:'Kategori',colTop:12})));
};

RENDERERS.cografya=(v)=>{
  const O=fO();
  const ilAgg=[...new Set(O.map(o=>o.city).filter(Boolean))].map(il=>({il,
    sip:O.filter(o=>o.city===il).length, ciro:sum(O.filter(o=>o.city===il&&deliv(o)),o=>o.ciro), adet:sum(O.filter(o=>o.city===il),o=>o.qty||0)}));
  const cogKpi = kpirow(
    kpi('İl sayısı',F.n(new Set(O.map(o=>o.city).filter(Boolean)).size))+
    kpi('İlçe sayısı',F.n(new Set(O.map(o=>o.ilce).filter(Boolean)).size))+
    kpi('Antalya payı',F.pct(O.length?O.filter(o=>o.city==='Antalya').length/O.length*100:0),'sipariş')+
    kpi('Bölge sayısı',F.n(new Set(O.map(o=>o.region).filter(Boolean)).size))
  );
  cogKpi.classList.add('compact');
  v.appendChild(cogKpi);
  v.appendChild(panel('Türkiye haritası — il bazlı ciro','Kabarcık büyüklüğü = teslim cirosu · baloncuğa tıkla · sağ üstten Harita / Uydu', turkeyMap(ilAgg)));
  const g=document.createElement('div'); g.className='grid g2'; v.appendChild(g);
  g.appendChild(panel('İllere göre ciro',null,
    barH([...ilAgg].sort((a,b)=>b.ciro-a.ciro).slice(0,12).map(r=>({label:r.il,value:r.ciro,color:PAL['--accent'],note:F.n(r.sip)+' sipariş'})),{fmt:F.tlk})));
  g.appendChild(panel('İllere göre ciro — Antalya hariç',null,(()=>{
    const x=ilAgg.filter(r=>r.il!=='Antalya').sort((a,b)=>b.ciro-a.ciro).slice(0,12);
    return x.length? barH(x.map(r=>({label:r.il,value:r.ciro,color:PAL['--s2'],note:F.n(r.sip)+' sipariş'})),{fmt:F.tlk}):miss();
  })()));
  g.appendChild(panel('İlçelere göre sipariş','İlk 15',
    barH(topEntries(groupSum(O,o=>o.ilce,()=>1),15).map(([k,vv])=>({label:k,value:vv,color:PAL['--s1']})),{fmt:F.n})));
  g.appendChild(panel('Coğrafi bölgelere göre',null,
    donut(topEntries(groupSum(O,o=>o.region,()=>1),8).map(([k,vv],i)=>({label:k,value:vv,color:SER()[i]})),{fmt:F.n})));
  v.appendChild(panel('Matris — İl × Kanal','Metrik: sipariş adedi',
    pivot(O,{rowKey:'city',colKey:'ch',metric:'sip',rowFmt:Object.assign(x=>x,{label:'İl'})})));
  v.appendChild(panel('Matris — İlçe × Kanal','Metrik: ciro (teslim edilen)',
    pivot(O,{rowKey:'ilce',colKey:'ch',metric:'ciro',rowFmt:Object.assign(x=>x,{label:'İlçe'})})));
};

RENDERERS.kaynak=(v)=>{
  const O=fO();
  const gm=groupSum(O,o=>o.srcGrp,()=>1);
  const SRC_COL={iOS:PAL['--s7'],Android:PAL['--s3'],Web:PAL['--s1'],Yemeksepeti:PAL['--s2'],Trendyol:PAL['--s4']};
  v.appendChild(kpirow(
    kpi('iOS',F.n(gm.get('iOS')||0),F.pct(O.length?(gm.get('iOS')||0)/O.length*100:0))+
    kpi('Android',F.n(gm.get('Android')||0),F.pct(O.length?(gm.get('Android')||0)/O.length*100:0))+
    kpi('Web',F.n(gm.get('Web')||0),F.pct(O.length?(gm.get('Web')||0)/O.length*100:0))+
    kpi('Mobil uygulama',F.n((gm.get('iOS')||0)+(gm.get('Android')||0)),'iOS + Android (Ticimax)')+
    kpi('Pazaryeri app',F.n((gm.get('Yemeksepeti')||0)+(gm.get('Trendyol')||0)),'YS + Trendyol')
  ));
  const g=document.createElement('div'); g.className='grid g2'; v.appendChild(g);
  g.appendChild(panel('Sipariş kaynağı kırılımı',null,
    donut([...gm.entries()].sort((a,b)=>b[1]-a[1]).map(([k,vv])=>({label:k,value:vv,color:SRC_COL[k]||PAL['--muted']})),{fmt:F.n})));
  g.appendChild(panel('Kaynağa göre ciro (teslim)',null,
    barH([...gm.keys()].map(k=>({label:k,value:sum(O.filter(o=>o.srcGrp===k&&deliv(o)),o=>o.ciro),color:SRC_COL[k]||PAL['--muted']})).sort((a,b)=>b.value-a.value),{fmt:F.tlk})));
  const cats=catsDates(O);
  g.appendChild(panel('Günlük kaynak trendi','Sipariş adedi',
    barV(cats,[...gm.keys()].map(k=>({name:k,color:SRC_COL[k]||PAL['--muted'],values:cats.map(d=>O.filter(o=>o.srcGrp===k&&o.ds===d).length)})),{fmt:F.n,catFmt:F.d})));
  g.appendChild(panel('Kaynağa göre ortalama sepet',null,
    barH([...gm.keys()].map(k=>{ const dd=O.filter(o=>o.srcGrp===k&&deliv(o)); return {label:k,value:dd.length?sum(dd,o=>o.ciro)/dd.length:0,color:SRC_COL[k]||PAL['--muted']}; }).sort((a,b)=>b.value-a.value),{fmt:F.tl})));
  const tic=O.filter(o=>o.ch==='Ticimax');
  const g2=document.createElement('div'); g2.className='grid g2'; v.appendChild(g2);
  g2.appendChild(panel('Ticimax — kaynağa göre sipariş & ciro',null,
    barV(['iOS','Android','Web'],[
      {name:'Sipariş',color:PAL['--s1'],values:['iOS','Android','Web'].map(sc=>tic.filter(o=>o.src===sc).length)}
    ],{fmt:F.n,stacked:false,values:true})));
  g2.appendChild(panel('Ticimax — kaynağa göre ciro',null,
    barH(['iOS','Android','Web'].map(sc=>({label:sc,value:sum(tic.filter(o=>o.src===sc&&deliv(o)),o=>o.ciro),color:{iOS:PAL['--s7'],Android:PAL['--s3'],Web:PAL['--s1']}[sc]})),{fmt:F.tlk})));
  const drDays=Math.max(1, Math.round((new Date(S.to+'T00:00:00')-new Date(S.from+'T00:00:00'))/864e5)+1);
  const iosT=tic.filter(o=>o.src==='iOS').length, andT=tic.filter(o=>o.src==='Android').length;
  v.appendChild(panel('Ticimax — saate göre iOS vs Android','Sipariş adedi',
    barV(range(8,23),[
      {name:'iOS',color:PAL['--s7'],values:range(8,23).map(h=>tic.filter(o=>o.src==='iOS'&&o.hr===h).length)},
      {name:'Android',color:PAL['--s3'],values:range(8,23).map(h=>tic.filter(o=>o.src==='Android'&&o.hr===h).length)}
    ],{fmt:F.n,stacked:false,values:true,note:{
      title:`Dönem ortalaması · ${F.n(drDays)} gün`,
      rows:[
        {t:`iOS: ${F.n1(iosT/drDays)} / gün  (toplam ${F.n(iosT)})`, c:PAL['--s7']},
        {t:`Android: ${F.n1(andT/drDays)} / gün  (toplam ${F.n(andT)})`, c:PAL['--s3']}
      ]}}),{mail:true}));
  v.appendChild(panel('Matris — Kaynak × Mağaza','Metrik: sipariş adedi',
    pivot(O,{rowKey:'srcGrp',colKey:'store',metric:'sip',rowFmt:Object.assign(x=>x,{label:'Kaynak'}),colTop:14})));
};

const MDIMS={ store:'Mağaza', ch:'Kanal', city:'İl', ilce:'İlçe', srcGrp:'Kaynak', pay:'Ödeme', wd:'Gün', st:'Durum', mon:'Ay', ds:'Tarih (gün)', hr:'Saat', camp:'Kampanya' };
const MMETRICS={ ciro:'Ciro (₺)', sip:'Sipariş adedi', adet:'Ürün adedi', net:'Net hakediş (₺)', kom:'Komisyon (₺)', aov:'Ortalama sepet (₺)' };
let MSTATE={row:'store',col:'ch',metric:'ciro'};
RENDERERS.matris=(v)=>{
  const wrap=document.createElement('div'); wrap.className='panel';
  wrap.innerHTML=`<h3>Matris Merkezi</h3><div class="sub">Satır ve sütun boyutunu seç, metriği belirle. Hücre koyuluğu değerle orantılı. "Ürün" satırı seçilirse ürün kalemleri kullanılır (ciro / adet).</div>
   <div class="pivot-tools">
     <div class="fg"><label>Satır</label><select id="mrow"></select></div>
     <div class="fg"><label>Sütun</label><select id="mcol"></select></div>
     <div class="fg"><label>Metrik</label><select id="mmet"></select></div>
     <button class="tb-btn" id="mcsv">⤓ CSV</button>
   </div>
   <div class="quick">
     <button data-r="store" data-c="mon" data-m="ciro">Mağaza × Ay · ciro</button>
     <button data-r="store" data-c="ch" data-m="ciro">Mağaza × Kanal · ciro</button>
     <button data-r="store" data-c="ds" data-m="sip">Mağaza × Gün · sipariş</button>
     <button data-r="PRODUCT" data-c="store" data-m="adet">Ürün × Mağaza · adet</button>
     <button data-r="PRODUCT" data-c="ch" data-m="adet">Ürün × Kanal · adet</button>
     <button data-r="city" data-c="ch" data-m="sip">İl × Kanal · sipariş</button>
     <button data-r="srcGrp" data-c="store" data-m="sip">Kaynak × Mağaza · sipariş</button>
     <button data-r="ilce" data-c="ch" data-m="ciro">İlçe × Kanal · ciro</button>
   </div>
   <div id="mout"></div>`;
  v.appendChild(wrap);
  const rowSel=wrap.querySelector('#mrow'), colSel=wrap.querySelector('#mcol'), metSel=wrap.querySelector('#mmet');
  rowSel.innerHTML='<option value="PRODUCT">Ürün</option>'+Object.entries(MDIMS).map(([k,l])=>`<option value="${k}">${l}</option>`).join('');
  colSel.innerHTML=Object.entries(MDIMS).map(([k,l])=>`<option value="${k}">${l}</option>`).join('');
  metSel.innerHTML=Object.entries(MMETRICS).map(([k,l])=>`<option value="${k}">${l}</option>`).join('');
  function draw(){
    rowSel.value=MSTATE.row; colSel.value=MSTATE.col; metSel.value=MSTATE.metric;
    const out=wrap.querySelector('#mout'); out.innerHTML='';
    if(MSTATE.row==='PRODUCT'){
      const metric = MSTATE.metric==='ciro'?'ciro':'adet';
      if(MSTATE.metric!=='ciro'&&MSTATE.metric!=='adet') out.insertAdjacentHTML('beforeend','<div class="sub">Ürün bazlı matris yalnızca ciro / ürün adedi destekler — ürün adedi gösteriliyor.</div>');
      out.appendChild(pivotItm(fI(),{rowKey:'prod',colKey:MSTATE.col,metric, label:'Ürün', rowTop:30, colTop:16}));
    } else {
      const fmtD=k=>x=> k==='ds'?F.d(x):(k==='mon'?F.mon(x):(k==='hr'?x+':00':x));
      out.appendChild(pivot(fO(),{rowKey:MSTATE.row,colKey:MSTATE.col,metric:MSTATE.metric,
        rowFmt:Object.assign(fmtD(MSTATE.row),{label:MDIMS[MSTATE.row]}), colFmt:fmtD(MSTATE.col), rowTop:30, colTop:18}));
    }
  }
  [['#mrow','row'],['#mcol','col'],['#mmet','metric']].forEach(([sel,key])=>wrap.querySelector(sel).onchange=e=>{ MSTATE[key]=e.target.value; draw(); });
  wrap.querySelectorAll('.quick button').forEach(b=>b.onclick=()=>{ MSTATE={row:b.dataset.r,col:b.dataset.c,metric:b.dataset.m}; draw(); });
  wrap.querySelector('#mcsv').onclick=()=>exportTable(wrap.querySelector('table'),'matris');
  draw();
};

RENDERERS.veri=(v)=>{
  const O=fO();
  v.appendChild(panel('Filtrelenmiş siparişler', O.length+' kayıt · başlığa tıklayarak sırala',
    dataTable([
      {key:'id',label:'Sipariş'},{key:'ch',label:'Kanal'},{key:'ds',label:'Tarih',fmt:x=>esc(F.d(x))},
      {key:'hr',label:'Saat',fmt:x=>x==null?'—':String(x).padStart(2,'0')+':00'},
      {key:'st',label:'Durum'},{key:'store',label:'Mağaza'},{key:'city',label:'İl'},{key:'ilce',label:'İlçe'},
      {key:'src',label:'Kaynak'},{key:'pay',label:'Ödeme'},
      {key:'ciro',label:'Ciro',fmt:F.tl,def:true},{key:'qty',label:'Adet',fmt:F.n},
      {key:'cust',label:'Müşteri',fmt:x=>esc(x||'—')}
    ], O, {per:25, shade:['ciro']})));
  const p=panel('Dışa aktar',null,null);
  p.insertAdjacentHTML('beforeend',
    `<div class="sub">CSV indirin (tarayıcı bloklarsa "Metni göster" ile kopyalayın).</div>
     <div style="display:flex;gap:8px;flex-wrap:wrap">
       <button class="tb-btn" id="csvOrd">⤓ Siparişler (filtreli)</button>
       <button class="tb-btn" id="csvItm">⤓ Ürün kalemleri (filtreli)</button>
       <button class="tb-btn" id="csvShow">◱ Metni göster</button>
     </div>
     <textarea id="csvBox" style="display:none;width:100%;height:220px;margin-top:12px;font:12px/1.4 monospace;border:1px solid var(--hair-strong);border-radius:8px;background:var(--surface-2);color:var(--ink);padding:10px"></textarea>`);
  v.appendChild(p);
  const ordCsv=()=>toCsv(PL.ordCols, fO().map(o=>PL.ordCols.map(c=>o[c])));
  const itmCsv=()=>toCsv(PL.itmCols, fI().map(o=>PL.itmCols.map(c=>o[c])));
  p.querySelector('#csvOrd').onclick=()=>dl('e-ticaret-siparisler.csv',ordCsv());
  p.querySelector('#csvItm').onclick=()=>dl('e-ticaret-kalemler.csv',itmCsv());
  p.querySelector('#csvShow').onclick=()=>{ const t=p.querySelector('#csvBox'); const show=t.style.display==='none'; t.style.display=show?'block':'none'; if(show){ t.value=ordCsv(); t.select(); } };
};
function toCsv(cols,rows){ const e=s=>{ s=s==null?'':String(s); return /[",\n;]/.test(s)?'"'+s.replace(/"/g,'""')+'"':s; };
  return cols.join(';')+'\n'+rows.map(r=>r.map(e).join(';')).join('\n'); }
function dl(name,text){ try{ const b=new Blob(['﻿'+text],{type:'text/csv;charset=utf-8'}); const u=URL.createObjectURL(b);
  const a=document.createElement('a'); a.href=u; a.download=name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(()=>URL.revokeObjectURL(u),2000);
}catch(e){ alert('İndirme engellendi — "Metni göster" ile kopyalayın.'); } }
function exportTable(tbl,name){ if(!tbl) return;
  const rows=[...tbl.querySelectorAll('tr')].map(tr=>[...tr.children].map(td=>td.textContent.trim()));
  dl(name+'.csv', rows.map(r=>r.join(';')).join('\n')); }

/* ================= FİLTRE UI ================= */
function buildFilters(){
  const f=document.getElementById('filters');
  const multi=(key,label,opts)=>`<div class="fg"><label>${label}</label><div class="multi" data-key="${key}">`+
    opts.map(o=>`<label><input type="checkbox" value="${esc(o)}" ${S[key].has(o)?'checked':''}>${esc(o)}</label>`).join('')+`</div></div>`;
  f.innerHTML=
    `<div class="fg"><label>Kanal</label><div class="multi" data-key="ch">`+
      CH.map(c=>`<label><input type="checkbox" value="${c}" ${S.ch.has(c)?'checked':''}>${c}</label>`).join('')+`</div></div>`+
    `<div class="fg"><label>Başlangıç</label><input type="date" id="fFrom" min="${PL.meta.minDate}" max="${PL.meta.maxDate}" value="${S.from}"></div>`+
    `<div class="fg"><label>Bitiş</label><input type="date" id="fTo" min="${PL.meta.minDate}" max="${PL.meta.maxDate}" value="${S.to}"></div>`+
    multi('st','Durum',DIMS.st)+ multi('src','Sipariş kaynağı',DIMS.src)+ multi('store','Mağaza',DIMS.store)+
    multi('city','İl',DIMS.city)+ multi('ilce','İlçe',DIMS.ilce)+ multi('pay','Ödeme',DIMS.pay)+
    `<div class="fg"><label>Ara (müşteri / adres / no)</label><input type="text" id="fQ" value="${esc(S.q)}" placeholder="ör. Muratpaşa"></div>`;
  f.querySelectorAll('.multi').forEach(m=>m.addEventListener('change',()=>{
    const key=m.dataset.key; S[key].clear();
    m.querySelectorAll('input:checked').forEach(i=>S[key].add(i.value));
    if(key==='ch' && S.ch.size===0) CH.forEach(c=>S.ch.add(c));
    render();
  }));
  f.querySelector('#fFrom').onchange=e=>{ S.from=e.target.value||PL.meta.minDate; render(); };
  f.querySelector('#fTo').onchange=e=>{ S.to=e.target.value||PL.meta.maxDate; render(); };
  let qt; f.querySelector('#fQ').oninput=e=>{ clearTimeout(qt); qt=setTimeout(()=>{ S.q=e.target.value.trim(); render(); },260); };
}
function renderChips(){
  const c=document.getElementById('chips'); const items=[];
  if(S.ch.size<CH.length) items.push(['Kanal',[...S.ch].join(', '),()=>CH.forEach(x=>S.ch.add(x))]);
  if(!fullRange()) items.push(['Tarih',F.d(S.from)+' – '+F.d(S.to),()=>{ S.from=PL.meta.minDate; S.to=PL.meta.maxDate; }]);
  [['st','Durum'],['src','Kaynak'],['store','Mağaza'],['city','İl'],['ilce','İlçe'],['pay','Ödeme']].forEach(([k,l])=>{
    if(S[k].size) items.push([l,[...S[k]].slice(0,3).join(', ')+(S[k].size>3?' +'+(S[k].size-3):''),()=>S[k].clear()]);
  });
  if(S.q) items.push(['Ara','“'+S.q+'”',()=>S.q='']);
  c.innerHTML = items.length? items.map((it,i)=>`<span class="chip"><b>${it[0]}:</b> ${esc(it[1])} <button data-i="${i}">×</button></span>`).join('')
    : `<span class="chip" style="opacity:.75">Tüm veri · ${F.d(PL.meta.minDate)} – ${F.d(PL.meta.maxDate)} · ${PL.meta.orders} sipariş</span>`;
  c.querySelectorAll('button').forEach(b=>b.onclick=()=>{ items[+b.dataset.i][2](); buildFilters(); render(); });
}

/* ================= NAV / BOOT ================= */
function buildNav(){
  document.getElementById('nav').innerHTML=SECTIONS.map(s=>{
    const gc=`--gc:var(${GRP_COL[s.grp]||'--accent'})`;
    return `<div class="grp" style="${gc}">${s.grp}</div>`+s.items.map(i=>
      `<a class="navobj" href="#/${i[0]}" data-k="${i[0]}" style="${gc}"><span class="ic">${i[2]}</span><span class="lbl">${i[1]}</span></a>`).join('');
  }).join('');
  const srcNames=(PL.meta.sources&&PL.meta.sources.length?PL.meta.sources:CH);
  const bs=document.getElementById('brandSrc');
  if(bs){
    bs.innerHTML=
      `<button type="button" class="src-pill" data-ch="__all__" style="--sc:var(--muted)" title="Tüm kanallar">Tümü</button>`+
      CH.map(n=>`<button type="button" class="src-pill" data-ch="${esc(n)}" style="--sc:${CV(CH_COL[n]||'--muted')}" title="Sadece ${esc(n)}">${esc(n)}</button>`).join('');
    bs.querySelectorAll('.src-pill').forEach(b=>b.onclick=()=>{
      const c=b.dataset.ch;
      if(c==='__all__') S.ch=new Set(CH);
      else if(S.ch.size===1 && S.ch.has(c)) S.ch=new Set(CH);   // aynı pile tekrar tık → tümü
      else S.ch=new Set([c]);                                    // sadece bu kanal
      buildFilters(); render();
    });
    syncBrandSrc();
  }
  document.getElementById('foot').innerHTML=
    `<b>${PL.meta.orders}</b> sipariş · <b>${PL.meta.items}</b> kalem<br>`+
    `${F.d(PL.meta.minDate)} – ${F.d(PL.meta.maxDate)}<br>Pazaryerleri: ${srcNames.join(' · ')}`;
}
document.getElementById('fltBtn').onclick=e=>{ const f=document.getElementById('filters'); f.classList.toggle('open'); e.currentTarget.classList.toggle('act',f.classList.contains('open')); };
document.getElementById('rstBtn').onclick=()=>{ S.ch=new Set(CH); S.from=PL.meta.minDate; S.to=PL.meta.maxDate;
  ['city','ilce','store','st','src','pay'].forEach(k=>S[k].clear()); S.q=''; buildFilters(); render(); };
function applyTheme(t){ if(t) document.documentElement.setAttribute('data-theme',t); else document.documentElement.removeAttribute('data-theme');
  try{ localStorage.setItem('eta-theme',t||''); }catch(e){} render(); }
document.getElementById('thmBtn').onclick=()=>{ const cur=document.documentElement.getAttribute('data-theme');
  applyTheme(cur==='dark'?'light':cur==='light'?'':'dark'); };
const fsBtn=document.getElementById('fsBtn');
function toggleFs(){
  try{
    if(!document.fullscreenElement){ (document.documentElement.requestFullscreen||document.documentElement.webkitRequestFullscreen).call(document.documentElement); }
    else { (document.exitFullscreen||document.webkitExitFullscreen).call(document); }
  }catch(e){ alert('Tarayıcı tam ekranı engelledi.'); }
}
fsBtn.onclick=toggleFs;
document.addEventListener('fullscreenchange',()=>{
  const on=!!document.fullscreenElement;
  fsBtn.textContent = on ? '⛶ Çık' : '⛶ Tam ekran';
  fsBtn.classList.toggle('act',on);
});
document.addEventListener('keydown',e=>{
  if(e.key==='F11'){ e.preventDefault(); toggleFs(); }
  else if((e.key==='f'||e.key==='F') && !/^(INPUT|SELECT|TEXTAREA)$/.test(document.activeElement.tagName)){ toggleFs(); }
});
try{ const t=localStorage.getItem('eta-theme'); if(t) document.documentElement.setAttribute('data-theme',t); }catch(e){}
window.addEventListener('hashchange',render);
try{ matchMedia('(prefers-color-scheme: dark)').addEventListener('change',render); }catch(e){}

buildNav(); buildFilters(); refreshPal(); render();
