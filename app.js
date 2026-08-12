/* ==================================================================
   Calendrier Dividendes — logique applicative
   Aucune dépendance externe. Données 100% locales (localStorage).
   Récupération auto optionnelle via l'API Financial Modeling Prep.
   ================================================================== */

const STORAGE_KEY = 'dividendCalendarApp_v1';
const MS_DAY = 86400000;
const MOIS_FR = ['Janvier','Février','Mars','Avril','Mai','Juin','Juillet','Août','Septembre','Octobre','Novembre','Décembre'];
const JOURS_FR = ['Lun','Mar','Mer','Jeu','Ven','Sam','Dim'];
const AVATAR_COLORS = ['#1F4D3A','#223A5E','#A9791F','#7A3B2E','#4A5A50','#5B4B8A','#2E6F6E'];

/* ---------------------------------------------------------------
   ÉTAT
   --------------------------------------------------------------- */
let state = loadState();
let view = {
  mode: 'year',           // 'year' | 'month'
  dateType: 'pay',        // 'pay' | 'ex'
  showEarnings: true,
  cursor: new Date()      // date de référence pour la période affichée
};

function defaultState(){
  return { holdings: [], settings: { apiKey: '' } };
}
function loadState(){
  try{
    const raw = localStorage.getItem(STORAGE_KEY);
    if(!raw) return defaultState();
    const parsed = JSON.parse(raw);
    return Object.assign(defaultState(), parsed);
  }catch(e){ return defaultState(); }
}
function saveState(){
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

/* ---------------------------------------------------------------
   UTILITAIRES
   --------------------------------------------------------------- */
function uid(){ return Math.random().toString(36).slice(2,10) + Date.now().toString(36); }
function pad2(n){ return String(n).padStart(2,'0'); }
function toISO(d){ return `${d.getFullYear()}-${pad2(d.getMonth()+1)}-${pad2(d.getDate())}`; }
function parseISO(s){ if(!s) return null; const [y,m,d] = s.split('-').map(Number); return new Date(y, m-1, d); }
function todayISO(){ return toISO(new Date()); }
function addMonths(date, n){ const d = new Date(date); d.setMonth(d.getMonth()+n); return d; }
function addDays(date, n){ const d = new Date(date); d.setDate(d.getDate()+n); return d; }
function daysBetween(a,b){ return Math.round((parseISO(b) - parseISO(a)) / MS_DAY); }
function currencySymbol(c){
  return { EUR:'€', USD:'$', GBP:'£', CHF:'CHF', JPY:'¥' }[c] || (c||'');
}
function fmtAmount(n, currency){
  if(n === null || n === undefined || isNaN(n)) return '—';
  const sym = currencySymbol(currency);
  return `${Number(n).toFixed(3).replace(/0+$/,'').replace(/\.$/,'')}${sym}`;
}
function fmtAmount2(n, currency){
  if(n === null || n === undefined || isNaN(n)) return '—';
  return `${Number(n).toFixed(2)}${currencySymbol(currency)}`;
}
function fmtDateHuman(iso){
  const d = parseISO(iso);
  if(!d) return '';
  return `${d.getDate()} ${MOIS_FR[d.getMonth()].toLowerCase()} ${d.getFullYear()}`;
}
function initials(ticker){
  return (ticker||'??').replace(/\..*/,'').slice(0,2).toUpperCase();
}
function colorFor(ticker){
  let h = 0;
  for(const c of (ticker||'')) h = (h*31 + c.charCodeAt(0)) % AVATAR_COLORS.length;
  return AVATAR_COLORS[Math.abs(h)];
}
function toast(msg){
  const t = document.createElement('div');
  t.className = 'toast';
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(()=> t.remove(), 2600);
}
function freqMonths(freq){
  return { monthly:1, quarterly:3, semiannual:6, annual:12 }[freq] || 0;
}
function freqLabel(freq){
  return { monthly:'Mensuelle', quarterly:'Trimestrielle', semiannual:'Semestrielle', annual:'Annuelle', irregular:'Irrégulière', none:'Aucune' }[freq] || '—';
}

/* ---------------------------------------------------------------
   PROJECTION DES ÉVÉNEMENTS FUTURS
   À partir de la dernière date connue + fréquence, on projette des
   échéances estimées jusqu'à la fin de la plage affichée. Les
   entrées réelles (issues de l'API ou saisies à la main) priment
   toujours sur les estimations à date égale.
   --------------------------------------------------------------- */
function avgExToPayGap(history){
  const gaps = history.filter(h=>h.exDate && h.payDate).map(h=>daysBetween(h.exDate, h.payDate)).filter(g=>g>0 && g<120);
  if(!gaps.length) return 21; // valeur par défaut ~3 semaines
  return Math.round(gaps.reduce((a,b)=>a+b,0)/gaps.length);
}

function buildDividendEvents(holding, rangeStart, rangeEnd){
  const events = [];
  const hist = (holding.dividend && holding.dividend.history) || [];
  hist.forEach(h=>{
    events.push({ exDate: h.exDate || null, payDate: h.payDate || null, amount: h.amount, estimate: !!h.estimate, source: 'known' });
  });

  const freq = holding.dividend && holding.dividend.frequency;
  const months = freqMonths(freq);
  if(months > 0){
    const lastKnown = hist.slice().sort((a,b)=> (a.payDate||a.exDate||'').localeCompare(b.payDate||b.exDate||'')).pop();
    const baseDateISO = (lastKnown && (lastKnown.payDate || lastKnown.exDate)) || holding.dividend.lastPayDate || holding.dividend.lastExDate;
    const amount = (lastKnown && lastKnown.amount) || holding.dividend.lastAmount;
    if(baseDateISO && amount){
      const gap = avgExToPayGap(hist);
      let cursorPay = parseISO(baseDateISO);
      // si baseDateISO est une ex-date, on l'aligne approximativement sur le paiement pour la projection
      let guard = 0;
      while(guard++ < 60){
        cursorPay = addMonths(cursorPay, months);
        if(cursorPay > rangeEnd) break;
        if(cursorPay < rangeStart) continue;
        const payISO = toISO(cursorPay);
        const exISO = toISO(addDays(cursorPay, -gap));
        const already = hist.some(h => h.payDate === payISO || h.exDate === exISO);
        if(!already){
          events.push({ exDate: exISO, payDate: payISO, amount, estimate: true, source: 'projected' });
        }
      }
    }
  }
  return events;
}

function buildEarningsEvents(holding, rangeStart, rangeEnd){
  const events = [];
  const hist = (holding.earnings && holding.earnings.history) || [];
  hist.forEach(h=>{
    events.push({ date: h.date, period: h.period || '', estimate: !!h.estimate, source:'known' });
  });
  const freq = holding.earnings && holding.earnings.frequency;
  const months = freqMonths(freq);
  if(months > 0){
    const lastKnown = hist.slice().sort((a,b)=> (a.date||'').localeCompare(b.date||'')).pop();
    const baseDateISO = (lastKnown && lastKnown.date) || holding.earnings.lastDate;
    if(baseDateISO){
      let cursor = parseISO(baseDateISO);
      let guard = 0;
      while(guard++ < 60){
        cursor = addMonths(cursor, months);
        if(cursor > rangeEnd) break;
        if(cursor < rangeStart) continue;
        const iso = toISO(cursor);
        const already = hist.some(h=>h.date === iso);
        if(!already){
          events.push({ date: iso, period:'Estimé', estimate: true, source:'projected' });
        }
      }
    }
  }
  return events;
}

/* Construit l'index plat de tous les événements affichables pour une plage donnée */
function buildEventIndex(rangeStart, rangeEnd){
  const index = {}; // 'YYYY-MM-DD' -> [event,...]
  function push(dateISO, ev){
    if(!dateISO) return;
    if(!index[dateISO]) index[dateISO] = [];
    index[dateISO].push(ev);
  }
  state.holdings.forEach(h=>{
    const divEvents = buildDividendEvents(h, rangeStart, rangeEnd);
    divEvents.forEach(ev=>{
      const dateISO = view.dateType === 'ex' ? (ev.exDate || ev.payDate) : (ev.payDate || ev.exDate);
      if(!dateISO) return;
      const d = parseISO(dateISO);
      if(d < rangeStart || d > rangeEnd) return;
      push(dateISO, {
        type: 'dividend', holdingId: h.id, ticker: h.displayTicker || h.ticker, name: h.name,
        logo: h.logo, currency: h.currency, quantity: h.quantity,
        amount: ev.amount, total: (ev.amount||0) * (h.quantity||0),
        estimate: ev.estimate, exDate: ev.exDate, payDate: ev.payDate
      });
    });
    if(view.showEarnings){
      const earnEvents = buildEarningsEvents(h, rangeStart, rangeEnd);
      earnEvents.forEach(ev=>{
        const d = parseISO(ev.date);
        if(d < rangeStart || d > rangeEnd) return;
        push(ev.date, {
          type:'earnings', holdingId:h.id, ticker: h.displayTicker || h.ticker, name: h.name,
          logo: h.logo, period: ev.period, estimate: ev.estimate
        });
      });
    }
  });
  return index;
}

/* ---------------------------------------------------------------
   API — Financial Modeling Prep (récupération automatique, best-effort)
   --------------------------------------------------------------- */
async function fetchAutoData(ticker){
  const key = state.settings.apiKey;
  if(!key) throw new Error('Aucune clé API renseignée (voir Paramètres).');
  const base = 'https://financialmodelingprep.com/api/v3';
  const result = { name:null, logo:null, website:null, currency:null, dividend:null, earnings:null };

  // Profil (nom, logo, devise)
  try{
    const r = await fetch(`${base}/profile/${encodeURIComponent(ticker)}?apikey=${key}`);
    const data = await r.json();
    const p = Array.isArray(data) ? data[0] : null;
    if(p){
      result.name = p.companyName || null;
      result.logo = p.image || null;
      result.website = p.website || null;
      result.currency = p.currency || null;
    }
  }catch(e){ /* ignoré, on continue avec le reste */ }

  // Historique des dividendes
  try{
    const r = await fetch(`${base}/historical-price-full/stock_dividend/${encodeURIComponent(ticker)}?apikey=${key}`);
    const data = await r.json();
    const hist = (data && data.historical) || [];
    if(hist.length){
      const sorted = hist.slice().sort((a,b)=> (a.date||'').localeCompare(b.date||''));
      const recent = sorted.slice(-8).map(h=>({
        exDate: h.date || null,
        payDate: h.paymentDate || null,
        amount: h.adjDividend || h.dividend || null,
        estimate: false
      })).filter(h=>h.amount);
      if(recent.length){
        // détection de fréquence à partir de l'écart moyen entre versements
        let freq = 'irregular';
        if(recent.length >= 2){
          const gaps = [];
          for(let i=1;i<recent.length;i++){
            const a = recent[i-1].exDate, b = recent[i].exDate;
            if(a && b) gaps.push(daysBetween(a,b));
          }
          const avg = gaps.length ? gaps.reduce((x,y)=>x+y,0)/gaps.length : 0;
          if(avg > 0 && avg < 45) freq = 'monthly';
          else if(avg >= 45 && avg < 135) freq = 'quarterly';
          else if(avg >= 135 && avg < 270) freq = 'semiannual';
          else if(avg >= 270) freq = 'annual';
        }
        result.dividend = { history: recent, frequency: freq };
      }
    }
  }catch(e){ /* ignoré */ }

  // Calendrier des résultats
  try{
    const r = await fetch(`${base}/historical/earning_calendar/${encodeURIComponent(ticker)}?apikey=${key}`);
    const data = await r.json();
    if(Array.isArray(data) && data.length){
      const sorted = data.slice().sort((a,b)=> (a.date||'').localeCompare(b.date||''));
      const recent = sorted.slice(-6).map(e=>({ date:e.date, period:e.fiscalDateEnding||'', estimate:false }));
      let freq = 'quarterly';
      if(recent.length >= 2){
        const gaps = [];
        for(let i=1;i<recent.length;i++) gaps.push(daysBetween(recent[i-1].date, recent[i].date));
        const avg = gaps.reduce((x,y)=>x+y,0)/gaps.length;
        if(avg >= 135 && avg < 270) freq = 'semiannual';
        else if(avg >= 270) freq = 'annual';
        else freq = 'quarterly';
      }
      result.earnings = { history: recent, frequency: freq };
    }
  }catch(e){ /* ignoré */ }

  if(!result.name && !result.dividend && !result.earnings){
    throw new Error("Aucune donnée exploitable (clé invalide, quota atteint, ou plan API ne couvrant pas ce endpoint).");
  }
  return result;
}

/* ---------------------------------------------------------------
   RENDU — TICKER TAPE
   --------------------------------------------------------------- */
function renderTickerTape(){
  const track = document.getElementById('tickerTrack');
  const today = new Date();
  const horizon = addDays(today, 90);
  const index = buildEventIndex(today, horizon);
  const flat = [];
  Object.keys(index).sort().forEach(dateISO=>{
    index[dateISO].forEach(ev=> flat.push(Object.assign({dateISO}, ev)));
  });
  if(!flat.length){
    track.innerHTML = `<div class="ticker-empty">Ajoutez des actions pour voir vos prochaines échéances défiler ici →</div>`;
    return;
  }
  const items = flat.slice(0,14).map(ev=>{
    if(ev.type === 'dividend'){
      return `<div class="ticker-item"><span class="tk">${escapeHtml(ev.ticker)}</span><span>${fmtDateHuman(ev.dateISO)}</span><span class="amt-div">${fmtAmount2(ev.total, ev.currency)}${ev.estimate?' ≈':''}</span></div>`;
    }
    return `<div class="ticker-item"><span class="tk">${escapeHtml(ev.ticker)}</span><span>${fmtDateHuman(ev.dateISO)}</span><span class="amt-earn">Résultats${ev.estimate?' (est.)':''}</span></div>`;
  }).join('');
  track.innerHTML = items + items; // dupliqué pour boucle infinie fluide
}

function escapeHtml(s){
  return String(s==null?'':s).replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

/* ---------------------------------------------------------------
   RENDU — TOOLBAR / PERIOD LABEL
   --------------------------------------------------------------- */
function renderToolbar(){
  document.querySelectorAll('#viewSwitch button').forEach(b=>{
    b.classList.toggle('active', b.dataset.mode === view.mode);
  });
  const label = document.getElementById('periodLabel');
  if(view.mode === 'year'){
    label.textContent = view.cursor.getFullYear();
  }else{
    label.textContent = `${MOIS_FR[view.cursor.getMonth()]} ${view.cursor.getFullYear()}`;
  }
  document.getElementById('dateTypeSelect').value = view.dateType;
  document.getElementById('showEarningsCheckbox').checked = view.showEarnings;
}

/* ---------------------------------------------------------------
   RENDU — CALENDRIER
   --------------------------------------------------------------- */
function renderCalendar(){
  const wrap = document.getElementById('calendarWrap');
  if(view.mode === 'year'){
    renderYearView(wrap);
  }else{
    renderMonthView(wrap);
  }
}

function renderYearView(wrap){
  const year = view.cursor.getFullYear();
  const rangeStart = new Date(year, 0, 1);
  const rangeEnd = new Date(year, 11, 31);
  const index = buildEventIndex(rangeStart, rangeEnd);

  let html = `<div class="year-grid">`;
  for(let m=0; m<12; m++){
    html += renderMiniMonth(year, m, index);
  }
  html += `</div>`;
  wrap.innerHTML = html;

  wrap.querySelectorAll('.mini-month').forEach(el=>{
    el.addEventListener('click', ()=>{
      view.mode = 'month';
      view.cursor = new Date(year, Number(el.dataset.month), 1);
      renderAll();
    });
  });
  wrap.querySelectorAll('.mini-day[data-date]').forEach(el=>{
    el.addEventListener('click', (e)=>{
      e.stopPropagation();
      openDayPopover(el.dataset.date, index[el.dataset.date] || []);
    });
  });
}

function renderMiniMonth(year, month, index){
  const first = new Date(year, month, 1);
  const startOffset = (first.getDay() + 6) % 7; // lundi = 0
  const daysInMonth = new Date(year, month+1, 0).getDate();
  const todayIso = todayISO();

  let cells = '';
  for(let i=0;i<startOffset;i++) cells += `<div class="mini-day pad"></div>`;
  for(let d=1; d<=daysInMonth; d++){
    const dateISO = `${year}-${pad2(month+1)}-${pad2(d)}`;
    const evs = index[dateISO] || [];
    const hasDiv = evs.some(e=>e.type==='dividend');
    const hasEarn = evs.some(e=>e.type==='earnings');
    const isToday = dateISO === todayIso;
    cells += `<div class="mini-day${isToday?' today':''}" data-date="${dateISO}">${d}
      ${(hasDiv||hasEarn) ? `<span class="dots">${hasDiv?'<span class="dot dot-div"></span>':''}${hasEarn?'<span class="dot dot-earn"></span>':''}</span>` : ''}
    </div>`;
  }
  const dow = JOURS_FR.map(j=>`<div class="mini-dow">${j[0]}</div>`).join('');
  return `<div class="mini-month" data-month="${month}">
    <h3>${MOIS_FR[month]}</h3>
    <div class="mini-grid">${dow}${cells}</div>
  </div>`;
}

function renderMonthView(wrap){
  const year = view.cursor.getFullYear();
  const month = view.cursor.getMonth();
  const rangeStart = new Date(year, month, 1);
  const rangeEnd = new Date(year, month+1, 0);
  const index = buildEventIndex(rangeStart, rangeEnd);

  const first = new Date(year, month, 1);
  const startOffset = (first.getDay() + 6) % 7;
  const daysInMonth = rangeEnd.getDate();
  const todayIso = todayISO();

  let cells = '';
  for(let i=0;i<startOffset;i++) cells += `<div class="month-day pad"></div>`;
  for(let d=1; d<=daysInMonth; d++){
    const dateISO = `${year}-${pad2(month+1)}-${pad2(d)}`;
    const evs = index[dateISO] || [];
    const isToday = dateISO === todayIso;
    const shown = evs.slice(0,3).map(ev=>{
      if(ev.type === 'dividend'){
        return `<div class="chip chip-div${ev.estimate?' estimate':''}" title="${escapeHtml(ev.name||ev.ticker)}">${escapeHtml(ev.ticker)} · ${fmtAmount2(ev.total, ev.currency)}${ev.estimate?' ≈':''}</div>`;
      }
      return `<div class="chip chip-earn${ev.estimate?' estimate':''}" title="${escapeHtml(ev.name||ev.ticker)}">${escapeHtml(ev.ticker)} · résultats${ev.estimate?' (est.)':''}</div>`;
    }).join('');
    const more = evs.length > 3 ? `<div class="chip-more">+${evs.length-3} autre(s)</div>` : '';
    cells += `<div class="month-day${isToday?' today':''}" data-date="${dateISO}">
      <div class="daynum">${d}</div>
      <div class="day-chips">${shown}${more}</div>
    </div>`;
  }
  const dow = JOURS_FR.map(j=>`<div class="month-dow">${j}</div>`).join('');
  wrap.innerHTML = `<div class="month-card">
    <div class="month-grid">${dow}${cells}</div>
  </div>`;

  wrap.querySelectorAll('.month-day[data-date]').forEach(el=>{
    el.addEventListener('click', ()=> openDayPopover(el.dataset.date, index[el.dataset.date] || []));
  });
}

/* ---------------------------------------------------------------
   POPOVER JOUR
   --------------------------------------------------------------- */
function openDayPopover(dateISO, events){
  const root = document.getElementById('modalRoot');
  const listHtml = events.length ? events.map(ev=>{
    const avatar = renderAvatar(ev.ticker, ev.logo);
    if(ev.type === 'dividend'){
      return `<div class="day-event">
        ${avatar}
        <div class="info">
          <div class="top"><span class="tk">${escapeHtml(ev.ticker)}</span>
            <span class="badge badge-div">Dividende</span>
            ${ev.estimate?'<span class="badge badge-est">Estimé</span>':''}
          </div>
          <div class="nm">${escapeHtml(ev.name||'')} · ${ev.quantity} action(s)</div>
          <div class="amount">${fmtAmount2(ev.total, ev.currency)} <span style="color:var(--ink-soft); font-weight:400;">(${fmtAmount(ev.amount, ev.currency)} / action)</span></div>
        </div>
      </div>`;
    }
    return `<div class="day-event">
      ${avatar}
      <div class="info">
        <div class="top"><span class="tk">${escapeHtml(ev.ticker)}</span>
          <span class="badge badge-earn">Résultats</span>
          ${ev.estimate?'<span class="badge badge-est">Estimé</span>':''}
        </div>
        <div class="nm">${escapeHtml(ev.name||'')}${ev.period?(' · '+escapeHtml(ev.period)):''}</div>
      </div>
    </div>`;
  }).join('') : `<div class="empty-state">Aucune échéance ce jour-là.</div>`;

  root.innerHTML = `<div class="modal-overlay" id="dayOverlay">
    <div class="modal" style="max-width:480px;">
      <button class="modal-close" id="dayClose">×</button>
      <h2>${fmtDateHuman(dateISO)}</h2>
      <p class="modal-sub">${events.length} échéance(s)</p>
      <div class="day-popover-list">${listHtml}</div>
    </div>
  </div>`;
  document.getElementById('dayClose').onclick = closeModal;
  document.getElementById('dayOverlay').addEventListener('click', (e)=>{ if(e.target.id === 'dayOverlay') closeModal(); });
}

function renderAvatar(ticker, logo){
  if(logo){
    return `<div class="avatar"><img src="${escapeHtml(logo)}" alt="${escapeHtml(ticker)}" onerror="this.parentElement.innerHTML='${initials(ticker)}'; this.parentElement.style.background='${colorFor(ticker)}';"/></div>`;
  }
  return `<div class="avatar" style="background:${colorFor(ticker)}">${initials(ticker)}</div>`;
}

function closeModal(){
  document.getElementById('modalRoot').innerHTML = '';
}

/* ---------------------------------------------------------------
   SIDEBAR — LISTE DU PORTEFEUILLE + RÉSUMÉ
   --------------------------------------------------------------- */
function renderHoldingsList(){
  const el = document.getElementById('holdingsList');
  if(!state.holdings.length){
    el.innerHTML = `<div class="empty-state"><span class="em-icon">🗂️</span>Aucune action pour l'instant.<br>Ajoutez votre première ligne.</div>`;
    return;
  }
  el.innerHTML = state.holdings.map(h=>`
    <div class="holding-row" data-id="${h.id}">
      ${renderAvatar(h.displayTicker || h.ticker, h.logo)}
      <div class="holding-meta">
        <div class="tk">${escapeHtml(h.displayTicker || h.ticker)}</div>
        <div class="nm">${escapeHtml(h.name || 'Sans nom')}</div>
      </div>
      <div class="holding-qty">×${h.quantity}</div>
      <button class="holding-edit" title="Modifier" data-edit="${h.id}">✎</button>
    </div>
  `).join('');
  el.querySelectorAll('[data-edit]').forEach(btn=>{
    btn.addEventListener('click', ()=> openStockModal(btn.dataset.edit));
  });
}

function renderSummary(){
  const el = document.getElementById('summaryBox');
  const now = new Date();
  const yearEnd = new Date(now.getFullYear(), 11, 31);
  const index = buildEventIndex(now, yearEnd);
  const totalsByCurrency = {};
  let countRemaining = 0;
  Object.values(index).forEach(evs=>{
    evs.forEach(ev=>{
      if(ev.type !== 'dividend') return;
      countRemaining++;
      totalsByCurrency[ev.currency||'—'] = (totalsByCurrency[ev.currency||'—']||0) + (ev.total||0);
    });
  });
  const rows = Object.keys(totalsByCurrency).map(cur=>
    `<div class="sum-row"><span class="lbl">Estimé restant ${now.getFullYear()} (${cur})</span><span class="val gold">${fmtAmount2(totalsByCurrency[cur], cur==='—'?'':cur)}</span></div>`
  ).join('') || `<div class="sum-row"><span class="lbl">Estimé restant ${now.getFullYear()}</span><span class="val">—</span></div>`;

  el.innerHTML = `
    <div class="sum-row"><span class="lbl">Lignes en portefeuille</span><span class="val">${state.holdings.length}</span></div>
    <div class="sum-row"><span class="lbl">Versements restants (${now.getFullYear()})</span><span class="val">${countRemaining}</span></div>
    ${rows}
  `;
}

/* ---------------------------------------------------------------
   MODAL — AJOUT / ÉDITION D'UNE ACTION
   --------------------------------------------------------------- */
let modalDraft = null; // état temporaire du formulaire en cours d'édition

function openStockModal(existingId){
  const existing = existingId ? state.holdings.find(h=>h.id===existingId) : null;
  modalDraft = existing ? JSON.parse(JSON.stringify(existing)) : {
    id: uid(),
    ticker: '', displayTicker: '', name: '', exchange: 'US', quantity: 1, currency: 'USD',
    logo: null, source: 'manual',
    dividend: { lastAmount:null, lastExDate:null, lastPayDate:null, frequency:'quarterly', history: [] },
    earnings: { lastDate:null, frequency:'quarterly', history: [] }
  };
  renderStockModal();
}

function renderStockModal(){
  const root = document.getElementById('modalRoot');
  const d = modalDraft;
  const isEdit = state.holdings.some(h=>h.id===d.id);

  root.innerHTML = `<div class="modal-overlay" id="stockOverlay">
    <div class="modal">
      <button class="modal-close" id="stockClose">×</button>
      <h2>${isEdit ? 'Modifier' : 'Ajouter'} une action</h2>
      <p class="modal-sub">Complétez au minimum le ticker et la quantité. Le reste peut être auto-rempli ou saisi à la main.</p>

      <div class="field-row">
        <div class="field">
          <label>Ticker (symbole)</label>
          <input type="text" id="f-ticker" value="${escapeHtml(d.ticker)}" placeholder="ex : AAPL, AI.PA" />
          <span class="hint">Euronext Paris : ajoutez .PA (ex : AI.PA). Amsterdam : .AS, Allemagne : .DE, Londres : .L</span>
        </div>
        <div class="field">
          <label>Quantité détenue</label>
          <input type="number" id="f-qty" min="0" step="1" value="${d.quantity}" />
        </div>
      </div>
      <div class="field-row">
        <div class="field">
          <label>Place boursière</label>
          <select id="f-exchange">
            <option value="US" ${d.exchange==='US'?'selected':''}>US (NYSE / NASDAQ)</option>
            <option value="EU" ${d.exchange==='EU'?'selected':''}>Europe (Euronext...)</option>
            <option value="Autre" ${d.exchange==='Autre'?'selected':''}>Autre</option>
          </select>
        </div>
        <div class="field">
          <label>Devise</label>
          <select id="f-currency">
            ${['USD','EUR','GBP','CHF'].map(c=>`<option value="${c}" ${d.currency===c?'selected':''}>${c}</option>`).join('')}
          </select>
        </div>
      </div>
      <div class="field">
        <label>Nom de la société</label>
        <input type="text" id="f-name" value="${escapeHtml(d.name)}" placeholder="Rempli automatiquement si dispo" />
      </div>

      <div class="auto-fetch-row">
        <button class="btn btn-primary btn-sm" id="autoFetchBtn">⇩ Récupérer automatiquement</button>
        <span class="auto-fetch-status" id="autoFetchStatus"></span>
      </div>

      <div class="section-title">Dividende</div>
      <div class="field-row">
        <div class="field">
          <label>Montant / action</label>
          <input type="number" id="f-div-amount" step="0.0001" value="${d.dividend.lastAmount ?? ''}" />
        </div>
        <div class="field">
          <label>Fréquence</label>
          <select id="f-div-freq">
            ${['monthly','quarterly','semiannual','annual','irregular','none'].map(f=>`<option value="${f}" ${d.dividend.frequency===f?'selected':''}>${freqLabel(f)}</option>`).join('')}
          </select>
        </div>
      </div>
      <div class="field-row">
        <div class="field">
          <label>Dernière ex-date</label>
          <input type="date" id="f-div-ex" value="${d.dividend.lastExDate||''}" />
        </div>
        <div class="field">
          <label>Dernière date de paiement</label>
          <input type="date" id="f-div-pay" value="${d.dividend.lastPayDate||''}" />
        </div>
      </div>
      <span class="hint">Les prochaines échéances seront projetées automatiquement à partir de cette dernière date connue et de la fréquence choisie.</span>

      <div class="section-title">Résultats trimestriels / semestriels / annuels</div>
      <div class="field-row">
        <div class="field">
          <label>Dernière date de publication</label>
          <input type="date" id="f-earn-date" value="${d.earnings.lastDate||''}" />
        </div>
        <div class="field">
          <label>Fréquence de publication</label>
          <select id="f-earn-freq">
            ${['quarterly','semiannual','annual','none'].map(f=>`<option value="${f}" ${d.earnings.frequency===f?'selected':''}>${freqLabel(f)}</option>`).join('')}
          </select>
        </div>
      </div>

      <div class="modal-actions">
        <div class="left">
          ${isEdit ? `<button class="btn btn-danger" id="stockDelete">Supprimer</button>` : '<span></span>'}
        </div>
        <div class="right">
          <button class="btn btn-ghost" id="stockCancel">Annuler</button>
          <button class="btn btn-primary" id="stockSave">Enregistrer</button>
        </div>
      </div>
    </div>
  </div>`;

  document.getElementById('stockClose').onclick = closeModal;
  document.getElementById('stockCancel').onclick = closeModal;
  document.getElementById('stockOverlay').addEventListener('click', (e)=>{ if(e.target.id==='stockOverlay') closeModal(); });
  if(isEdit) document.getElementById('stockDelete').onclick = ()=> deleteHolding(d.id);
  document.getElementById('stockSave').onclick = saveStockModal;
  document.getElementById('autoFetchBtn').onclick = runAutoFetch;
}

async function runAutoFetch(){
  const statusEl = document.getElementById('autoFetchStatus');
  const ticker = document.getElementById('f-ticker').value.trim();
  if(!ticker){ statusEl.textContent = 'Renseignez d\'abord un ticker.'; statusEl.className='auto-fetch-status err'; return; }
  if(!state.settings.apiKey){
    statusEl.innerHTML = 'Aucune clé API — ajoutez-en une dans Paramètres, ou complétez les champs à la main.';
    statusEl.className = 'auto-fetch-status err';
    return;
  }
  statusEl.textContent = 'Récupération en cours…';
  statusEl.className = 'auto-fetch-status';
  try{
    const data = await fetchAutoData(ticker);
    if(data.name) document.getElementById('f-name').value = data.name;
    if(data.currency) document.getElementById('f-currency').value = data.currency;
    modalDraft.logo = data.logo || modalDraft.logo;
    modalDraft.website = data.website || modalDraft.website;
    if(data.dividend){
      modalDraft.dividend.history = data.dividend.history;
      modalDraft.dividend.frequency = data.dividend.frequency;
      const last = data.dividend.history[data.dividend.history.length-1];
      if(last){
        document.getElementById('f-div-amount').value = last.amount || '';
        document.getElementById('f-div-ex').value = last.exDate || '';
        document.getElementById('f-div-pay').value = last.payDate || '';
        document.getElementById('f-div-freq').value = data.dividend.frequency;
      }
    }
    if(data.earnings){
      modalDraft.earnings.history = data.earnings.history;
      modalDraft.earnings.frequency = data.earnings.frequency;
      const last = data.earnings.history[data.earnings.history.length-1];
      if(last){
        document.getElementById('f-earn-date').value = last.date || '';
        document.getElementById('f-earn-freq').value = data.earnings.frequency;
      }
    }
    statusEl.textContent = '✓ Données récupérées. Vérifiez et complétez si besoin.';
    statusEl.className = 'auto-fetch-status ok';
  }catch(err){
    statusEl.textContent = '✗ ' + err.message;
    statusEl.className = 'auto-fetch-status err';
  }
}

function saveStockModal(){
  const ticker = document.getElementById('f-ticker').value.trim();
  if(!ticker){ toast('Merci de renseigner un ticker.'); return; }
  const d = modalDraft;
  d.ticker = ticker;
  d.displayTicker = ticker.toUpperCase();
  d.quantity = Number(document.getElementById('f-qty').value) || 0;
  d.exchange = document.getElementById('f-exchange').value;
  d.currency = document.getElementById('f-currency').value;
  d.name = document.getElementById('f-name').value.trim();

  const divAmount = parseFloat(document.getElementById('f-div-amount').value);
  d.dividend.lastAmount = isNaN(divAmount) ? null : divAmount;
  d.dividend.lastExDate = document.getElementById('f-div-ex').value || null;
  d.dividend.lastPayDate = document.getElementById('f-div-pay').value || null;
  d.dividend.frequency = document.getElementById('f-div-freq').value;
  if(!d.dividend.history) d.dividend.history = [];
  // Les champs "dernier montant / dernière date" reflètent toujours l'entrée la plus
  // récente de l'historique : on la (re)synchronise ici pour que toute correction
  // manuelle après une récupération automatique se répercute bien sur le calendrier.
  if(d.dividend.lastAmount){
    const lastEntry = { exDate: d.dividend.lastExDate, payDate: d.dividend.lastPayDate, amount: d.dividend.lastAmount, estimate:false };
    if(!d.dividend.history.length) d.dividend.history = [lastEntry];
    else d.dividend.history[d.dividend.history.length-1] = lastEntry;
  }

  d.earnings.lastDate = document.getElementById('f-earn-date').value || null;
  d.earnings.frequency = document.getElementById('f-earn-freq').value;
  if(!d.earnings.history) d.earnings.history = [];
  if(d.earnings.lastDate){
    const lastEarn = { date: d.earnings.lastDate, period:'', estimate:false };
    if(!d.earnings.history.length) d.earnings.history = [lastEarn];
    else d.earnings.history[d.earnings.history.length-1] = lastEarn;
  }

  const idx = state.holdings.findIndex(h=>h.id===d.id);
  if(idx >= 0) state.holdings[idx] = d; else state.holdings.push(d);
  saveState();
  closeModal();
  toast('Action enregistrée.');
  renderAll();
}

function deleteHolding(id){
  if(!confirm('Supprimer cette ligne du portefeuille ?')) return;
  state.holdings = state.holdings.filter(h=>h.id!==id);
  saveState();
  closeModal();
  toast('Action supprimée.');
  renderAll();
}

/* ---------------------------------------------------------------
   MODAL — PARAMÈTRES
   --------------------------------------------------------------- */
function openSettingsModal(){
  const root = document.getElementById('modalRoot');
  root.innerHTML = `<div class="modal-overlay" id="setOverlay">
    <div class="modal" style="max-width:480px;">
      <button class="modal-close" id="setClose">×</button>
      <h2>Paramètres</h2>
      <p class="modal-sub">La clé est stockée uniquement dans votre navigateur (localStorage), jamais envoyée ailleurs qu'à financialmodelingprep.com.</p>
      <div class="field">
        <label>Clé API Financial Modeling Prep</label>
        <input type="text" id="f-apikey" value="${escapeHtml(state.settings.apiKey||'')}" placeholder="Collez votre clé ici" />
        <span class="hint">Clé gratuite disponible sur <a href="https://site.financialmodelingprep.com/developer/docs" target="_blank" rel="noopener">financialmodelingprep.com</a>. Sans clé, vous pouvez toujours saisir vos dividendes et résultats manuellement.</span>
      </div>
      <div class="modal-actions">
        <span></span>
        <div class="right">
          <button class="btn btn-ghost" id="setCancel">Annuler</button>
          <button class="btn btn-primary" id="setSave">Enregistrer</button>
        </div>
      </div>
    </div>
  </div>`;
  document.getElementById('setClose').onclick = closeModal;
  document.getElementById('setCancel').onclick = closeModal;
  document.getElementById('setOverlay').addEventListener('click', (e)=>{ if(e.target.id==='setOverlay') closeModal(); });
  document.getElementById('setSave').onclick = ()=>{
    state.settings.apiKey = document.getElementById('f-apikey').value.trim();
    saveState();
    closeModal();
    toast('Paramètres enregistrés.');
  };
}

/* ---------------------------------------------------------------
   IMPORT / EXPORT
   --------------------------------------------------------------- */
function exportData(){
  const blob = new Blob([JSON.stringify(state, null, 2)], { type:'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `calendrier-dividendes-${todayISO()}.json`;
  a.click();
  URL.revokeObjectURL(url);
}
function importData(file){
  const reader = new FileReader();
  reader.onload = ()=>{
    try{
      const parsed = JSON.parse(reader.result);
      if(!parsed.holdings) throw new Error('Format invalide');
      state = Object.assign(defaultState(), parsed);
      saveState();
      toast('Import réussi.');
      renderAll();
    }catch(e){
      toast('Échec de l\'import : fichier invalide.');
    }
  };
  reader.readAsText(file);
}

/* ---------------------------------------------------------------
   NAVIGATION / ÉVÉNEMENTS GLOBAUX
   --------------------------------------------------------------- */
function renderAll(){
  renderToolbar();
  renderTickerTape();
  renderCalendar();
  renderHoldingsList();
  renderSummary();
}

function initEvents(){
  document.getElementById('addStockBtn').onclick = ()=> openStockModal(null);
  document.getElementById('settingsBtn').onclick = openSettingsModal;

  document.querySelectorAll('#viewSwitch button').forEach(b=>{
    b.addEventListener('click', ()=>{ view.mode = b.dataset.mode; renderAll(); });
  });
  document.getElementById('prevBtn').onclick = ()=>{
    view.cursor = view.mode === 'year' ? addMonths(view.cursor, -12) : addMonths(view.cursor, -1);
    renderAll();
  };
  document.getElementById('nextBtn').onclick = ()=>{
    view.cursor = view.mode === 'year' ? addMonths(view.cursor, 12) : addMonths(view.cursor, 1);
    renderAll();
  };
  document.getElementById('todayBtn').onclick = ()=>{ view.cursor = new Date(); renderAll(); };

  document.getElementById('dateTypeSelect').onchange = (e)=>{ view.dateType = e.target.value; renderAll(); };
  document.getElementById('showEarningsCheckbox').onchange = (e)=>{ view.showEarnings = e.target.checked; renderAll(); };

  document.getElementById('exportBtn').onclick = exportData;
  document.getElementById('importBtn').onclick = ()=> document.getElementById('importFile').click();
  document.getElementById('importFile').onchange = (e)=>{
    if(e.target.files[0]) importData(e.target.files[0]);
    e.target.value = '';
  };

  document.addEventListener('keydown', (e)=>{ if(e.key === 'Escape') closeModal(); });
}

initEvents();
renderAll();
