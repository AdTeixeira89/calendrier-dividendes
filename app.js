/* ==================================================================
   Calendrier Dividendes — logique applicative
   Aucune dépendance externe. Données 100% locales (localStorage).
   Récupération auto optionnelle via l'API Financial Modeling Prep.
   ================================================================== */

const STORAGE_KEY = 'dividendCalendarApp_v1';
const MS_DAY = 86400000;
const MOIS_FR = ['Janvier','Février','Mars','Avril','Mai','Juin','Juillet','Août','Septembre','Octobre','Novembre','Décembre'];
const JOURS_FR = ['Lun','Mar','Mer','Jeu','Ven','Sam','Dim'];
const AVATAR_COLORS = ['#0E8A94','#6C4FE0','#C97A1D','#B23A56','#3D5A80','#7A4FBF','#1F8A70'];
const GOLD_HEX = '#FFB454';
const NAVY_HEX = '#9D6BFF';
const LINE_HEX = '#263349';
const INK_SOFT_HEX = '#8A99B3';

/* ---------------------------------------------------------------
   ÉTAT
   --------------------------------------------------------------- */
let state = loadState();
let view = {
  tab: 'upcoming',        // 'upcoming' | 'calendar' | 'portfolio' | 'totals'
  mode: (window.innerWidth < 700 ? 'month' : 'year'),   // 'year' | 'month' | 'logos'
  dateType: 'pay',        // 'pay' | 'ex'
  showEarnings: true,
  accountFilter: 'all',   // 'all' | account id
  cursor: new Date()      // date de référence pour la période affichée
};

/* ---------------------------------------------------------------
   TAUX DE CHANGE (conversion des totaux en euros)
   API gratuite Frankfurter (données BCE), sans clé, mise en cache
   une journée dans le navigateur pour limiter les appels.
   --------------------------------------------------------------- */
let fxRates = null;   // { USD: 1.153, GBP: 0.86, ... } — unités de devise pour 1 €
let fxDate = null;    // date des taux affichés (fournie par l'API)

async function ensureFxRates(){
  try{
    const cacheRaw = localStorage.getItem('fxRatesCache_v1');
    const today = todayISO();
    if(cacheRaw){
      const cache = JSON.parse(cacheRaw);
      if(cache.date === today){ fxRates = cache.rates; fxDate = cache.apiDate; return; }
    }
    const r = await fetch('https://api.frankfurter.dev/v1/latest?from=EUR');
    if(!r.ok) return;
    const data = await r.json();
    if(data && data.rates){
      fxRates = data.rates;
      fxDate = data.date || today;
      localStorage.setItem('fxRatesCache_v1', JSON.stringify({ date: today, apiDate: fxDate, rates: fxRates }));
      renderAll(); // les totaux étaient déjà affichés sans conversion ; on les rafraîchit
    }
  }catch(e){ /* silencieux : les totaux resteront affichés devise par devise */ }
}

function convertToEUR(amount, currency){
  if(currency === 'EUR' || !currency) return amount;
  if(!fxRates || !fxRates[currency]) return null;
  return amount / fxRates[currency];
}

/* Convertit un ensemble {devise: montant} en un total unique en euros.
   Retourne aussi la liste des devises n'ayant pas pu être converties
   (taux indisponible), pour rester honnête si ça arrive. */
function sumToEUR(totals){
  let sum = 0; const missing = [];
  Object.keys(totals).forEach(cur=>{
    const v = totals[cur];
    if(!v) return;
    const conv = convertToEUR(v, cur);
    if(conv === null) missing.push(cur);
    else sum += conv;
  });
  return { sum, missing };
}

function getFilteredHoldings(){
  if(view.accountFilter === 'all') return state.holdings;
  return state.holdings.filter(h=>h.account === view.accountFilter);
}
function accountName(id){
  const a = state.accounts.find(a=>a.id===id);
  return a ? a.name : '—';
}

function defaultState(){
  return {
    holdings: [],
    settings: { apiKey: '', relayUrl: '', notify: false },
    sent: { days: {}, months: {} },
    accounts: [ { id:'degiro', name:'DEGIRO' }, { id:'pea', name:'PEA Trade Republic' }, { id:'nominatif', name:'Air Liquide Nominatif Pur' } ]
  };
}
function monthOf(iso){ const d = parseISO(iso); return d ? d.getMonth()+1 : null; }
function migrateHoldingToMonthModel(h){
  h.dividend = h.dividend || {};
  h.earnings = h.earnings || {};
  if(!h.dividend.anchorMonth){
    const lastDivDate = h.dividend.lastPayDate || h.dividend.lastExDate
      || (h.dividend.history && h.dividend.history.length && (h.dividend.history[h.dividend.history.length-1].payDate || h.dividend.history[h.dividend.history.length-1].exDate));
    if(lastDivDate) h.dividend.anchorMonth = monthOf(lastDivDate);
  }
  if(!h.earnings.anchorMonth){
    const lastEarnDate = h.earnings.lastDate
      || (h.earnings.history && h.earnings.history.length && h.earnings.history[h.earnings.history.length-1].date);
    if(lastEarnDate) h.earnings.anchorMonth = monthOf(lastEarnDate);
  }
  return h;
}
function loadState(){
  try{
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    const merged = Object.assign(defaultState(), parsed);
    if(!merged.accounts || !merged.accounts.length) merged.accounts = defaultState().accounts;
    merged.settings = Object.assign({ apiKey:'', relayUrl:'', notify:false }, merged.settings || {});
    merged.sent = merged.sent || { days:{}, months:{} };
    merged.holdings.forEach(h=>{
      if(!h.account) h.account = merged.accounts[0].id;
      migrateHoldingToMonthModel(h);
    });
    return merged;
  }catch(e){ return defaultState(); }
}
function saveState(){
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  snapshotForWorker();
}
/* Copie des données lisible par le service worker (vérification en arrière-plan). */
function snapshotForWorker(){
  try{
    if(!('caches' in window)) return;
    caches.open('dividendes-data').then(c=> c.put('state.json', new Response(JSON.stringify({
      holdings: state.holdings, settings: { notify: !!state.settings.notify }, sent: state.sent
    }))));
  }catch(e){}
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
  const txt = Number(n).toFixed(3).replace(/0+$/,'').replace(/\.$/,'').replace('.', ',');
  const sym = currencySymbol(currency);
  return txt + (sym.length > 1 ? ' ' : '\u202f') + sym;
}
function fmtAmount2(n, currency){
  if(n === null || n === undefined || isNaN(n)) return '—';
  const sym = currencySymbol(currency);
  return Number(n).toFixed(2).replace('.', ',') + (sym ? (sym.length > 1 ? ' ' : '\u202f') + sym : '');
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
function freqMonths(freq){ return Payouts.freqMonths(freq); }
function freqLabel(freq){
  return { monthly:'Mensuelle', quarterly:'Trimestrielle', semiannual:'Semestrielle', annual:'Annuelle', irregular:'Irrégulière', none:'Aucune' }[freq] || '—';
}

/* ---------------------------------------------------------------
   PROJECTION DES ÉVÉNEMENTS FUTURS — modèle simplifié "mois seul"
   Plus besoin de date exacte ni d'ex-date : on ne retient qu'un mois
   de versement (1-12) + une fréquence. Les autres mois sont déduits
   automatiquement du cycle (ex : trimestrielle + mois=8 → Fév/Mai/
   Août/Nov, chaque année). Le jour du mois est arbitraire (15) car
   sans importance pour l'affichage calendrier.
   --------------------------------------------------------------- */
function monthsInCycle(anchorMonth, freq){ return Payouts.monthsInCycle(anchorMonth, freq); }

function buildDividendEvents(holding, rangeStart, rangeEnd){
  const events = [];
  const yStart = rangeStart.getFullYear(), yEnd = rangeEnd.getFullYear();
  for(let y = yStart; y <= yEnd; y++){
    for(let m = 1; m <= 12; m++){
      const p = Payouts.payoutInMonth(holding, y, m);
      if(!p) continue;
      const d = parseISO(p.date);
      if(d < rangeStart || d > rangeEnd) continue;
      events.push({ exDate: p.date, payDate: p.date, amount: p.amount, estimate: true, dayKnown: p.dayKnown, source: 'month-pattern' });
    }
  }
  return events;
}

function buildEarningsEvents(holding, rangeStart, rangeEnd){
  const events = [];
  const earn = holding.earnings || {};
  const months = monthsInCycle(earn.anchorMonth, earn.frequency);
  if(!months.length) return events;
  const yStart = rangeStart.getFullYear(), yEnd = rangeEnd.getFullYear();
  for(let y = yStart; y <= yEnd; y++){
    months.forEach(m=>{
      const d = new Date(y, m-1, 15);
      if(d < rangeStart || d > rangeEnd) return;
      events.push({ date: toISO(d), period:'', estimate: true, source:'month-pattern' });
    });
  }
  return events;
}

/* Construit l'index plat de tous les événements affichables pour une plage donnée.
   holdingsList est optionnel : par défaut, respecte le filtre de compte actif. */
function buildEventIndex(rangeStart, rangeEnd, holdingsList){
  const list = holdingsList || getFilteredHoldings();
  const index = {}; // 'YYYY-MM-DD' -> [event,...]
  function push(dateISO, ev){
    if(!dateISO) return;
    if(!index[dateISO]) index[dateISO] = [];
    index[dateISO].push(ev);
  }
  list.forEach(h=>{
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
        estimate: ev.estimate, dayKnown: ev.dayKnown, exDate: ev.exDate, payDate: ev.payDate
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
function isLikelyISIN(s){
  return /^[A-Z]{2}[A-Z0-9]{9}[0-9]$/.test((s||'').trim().toUpperCase());
}

/* Les clés API ne contiennent jamais d'espace. Si l'utilisateur colle par erreur
   une URL entière (« …/stable/dividends-calendar?apikey=XXXX »), on en extrait
   uniquement la clé plutôt que de l'envoyer telle quelle (ce qui donne un 401). */
function cleanApiKey(raw){
  const s = String(raw||'').trim();
  const m = s.match(/[?&]apikey=([^&\s#]+)/i);
  return (m ? m[1] : s).replace(/\s/g,'');
}

/* Suffixe de place boursière FMP le plus probable selon le pays de l'ISIN
   (2 premières lettres) — sert à départager les résultats d'une recherche. */
const ISIN_COUNTRY_SUFFIX = { FR:['.PA'], NL:['.AS'], DE:['.DE','.F'], GB:['.L'], IT:['.MI'], ES:['.MC'], BE:['.BR'], PT:['.LS'], CH:['.SW'], SE:['.ST'], DK:['.CO'], FI:['.HE'], NO:['.OL'], IE:['.IR','.L'], AT:['.VI'], US:[''], CA:['.TO'] };

function pickBySuffix(list, isin){
  const rows = (Array.isArray(list) ? list : []).filter(x => x && x.symbol);
  if(!rows.length) return null;
  const wanted = ISIN_COUNTRY_SUFFIX[isin.slice(0,2).toUpperCase()];
  if(wanted){
    for(const suf of wanted){
      const hit = rows.find(x => suf === '' ? !x.symbol.includes('.') : x.symbol.toUpperCase().endsWith(suf));
      if(hit) return hit.symbol;
    }
  }
  return rows[0].symbol;
}

/* Noms DEGIRO du type « VISA INC-CLASS A SHARES » : on essaie le nom complet,
   puis sans les mots génériques (INC, CORP, CLASS A…), puis les 2 premiers mots. */
function nameQueries(name){
  const full = String(name||'').trim().slice(0,60);
  const core = full.replace(/[-–]\s*CLASS\s+\w+.*$/i,'').replace(/\b(INC|CORP|CORPORATION|CO|COMPANY|LTD|PLC|SA|SE|AG|NV|N\.V\.|HOLDINGS?|GROUP|THE)\b\.?/gi,' ').replace(/\s+/g,' ').trim();
  const two = core.split(' ').slice(0,2).join(' ');
  const hyphen = two.includes(' ') ? two.replace(/ /g,'-') : '';
  return [...new Set([full, core, two, hyphen].filter(q => q && q.length >= 3))];
}

/* Recherche par nom : on n'accepte que la cotation cohérente avec le pays de
   l'ISIN (États-Unis → NASDAQ/NYSE/AMEX ; ailleurs → suffixe de la place).
   Mieux vaut échouer qu'associer une mauvaise cotation (autre devise). */
function pickFromNameSearch(list, isin){
  const rows = (Array.isArray(list) ? list : []).filter(x => x && x.symbol);
  const cc = isin.slice(0,2).toUpperCase();
  if(cc === 'US'){
    const hit = rows.find(x => ['NASDAQ','NYSE','AMEX'].includes(String(x.exchange||'').toUpperCase()));
    return hit ? hit.symbol : null;
  }
  for(const suf of (ISIN_COUNTRY_SUFFIX[cc] || [])){
    const hit = rows.find(x => suf ? x.symbol.toUpperCase().endsWith(suf) : !x.symbol.includes('.'));
    if(hit) return hit.symbol;
  }
  return null;
}

/* Beaucoup d'exports de courtiers (DEGIRO, Trade Republic…) ne donnent que
   l'ISIN, pas le ticker boursier attendu par l'API. On tente plusieurs voies,
   de la plus fiable à la plus floue : recherche par ISIN, recherche texte de
   l'ISIN, puis recherche par nom du produit (colonne « Produit » de DEGIRO).
   Best-effort : si rien ne répond, on continue avec l'ISIN d'origine (la
   suite échouera proprement avec un message explicite).*/
function rateLimitError(msg){ return Object.assign(new Error(msg || 'Quota API dépassé (429) — réessayez demain, ou réduisez le nombre de lignes.'), { rate:true }); }

/* Le plan gratuit FMP refuse la recherche par ISIN (402) : une fois constaté,
   on ne gaspille plus de requêtes (250/jour) à la retenter pour chaque ligne. */
let isinSearchBlocked = false;

async function resolveIsinToSymbol(isin, key, nameHint){
  const base = 'https://financialmodelingprep.com/stable';
  const get = async (path)=>{
    let r;
    try{ r = await fetch(`${base}/${path}&apikey=${key}`); }catch(e){ return null; }
    if(r.status === 429) throw rateLimitError();
    if(r.status === 402){ isinSearchBlocked = true; return null; }
    if(!r.ok) return null;
    return await r.json().catch(()=>null);
  };
  isin = isin.trim().toUpperCase();
  if(!isinSearchBlocked){
    const byIsin = await get(`search-isin?isin=${encodeURIComponent(isin)}`);
    if(Array.isArray(byIsin) && byIsin[0] && byIsin[0].symbol) return pickBySuffix(byIsin, isin);
  }
  if(nameHint && nameHint.trim()){
    for(const q of nameQueries(nameHint).slice(0,3)){
      const byName = await get(`search-name?query=${encodeURIComponent(q)}`);
      const hit = pickFromNameSearch(byName, isin);
      if(hit) return hit;
    }
  }
  return null;
}

async function fetchFmpData(tickerInput, nameHint){
  const key = state.settings.apiKey;
  if(!key) throw new Error('Aucune clé API renseignée (voir Paramètres).');
  const base = 'https://financialmodelingprep.com/stable';
  const result = { name:null, logo:null, website:null, currency:null, dividend:null, earnings:null, resolvedSymbol:null };

  let ticker = tickerInput.trim();
  if(isLikelyISIN(ticker) && !ticker.toUpperCase().startsWith('US')){
    // Hors États-Unis : le plan gratuit refuse de toute façon → on n'use pas le quota.
    throw new Error("ISIN hors États-Unis : le plan gratuit FMP ne couvre pas ces titres (relais Yahoo requis, ou saisissez le ticker à la main).");
  }
  if(isLikelyISIN(ticker)){
    const resolved = await resolveIsinToSymbol(ticker, key, nameHint);
    if(resolved){ result.resolvedSymbol = resolved; ticker = resolved; }
  }

  // Diagnostic : on garde trace de ce qui a concrètement répondu, pour donner
  // un message d'erreur final utile plutôt qu'un "ça n'a pas marché" vague.
  const diag = { anyNetworkError:false, anyAuthError:false, anyRateLimit:false, anyPlanLimit:false, lastApiMessage:null, anyOk:false };

  async function safeFetch(url){
    try{
      const r = await fetch(url);
      if(r.status === 401 || r.status === 403) diag.anyAuthError = true;
      if(r.status === 429) diag.anyRateLimit = true;
      if(r.status === 402) diag.anyPlanLimit = true;
      const data = await r.json().catch(()=>null);
      if(data && data['Error Message']) diag.lastApiMessage = data['Error Message'];
      if(r.ok && data) diag.anyOk = true;
      return { ok: r.ok, data };
    }catch(e){
      diag.anyNetworkError = true;
      return { ok:false, data:null };
    }
  }

  // Profil (nom, logo, devise) — nouvel endpoint stable, symbole en paramètre de requête
  {
    const { data } = await safeFetch(`${base}/profile?symbol=${encodeURIComponent(ticker)}&apikey=${key}`);
    const p = Array.isArray(data) ? data[0] : (data && data.symbol ? data : null);
    if(p){
      result.name = p.companyName || p.name || null;
      result.logo = p.image || null;
      result.website = p.website || null;
      result.currency = p.currency || null;
    }
  }

  // Historique des dividendes — nouvel endpoint stable, renvoie un tableau à plat
  {
    const { data } = await safeFetch(`${base}/dividends?symbol=${encodeURIComponent(ticker)}&apikey=${key}`);
    const hist = Array.isArray(data) ? data : ((data && data.historical) || []);
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
  }

  // Calendrier des résultats — nouvel endpoint stable "earnings" (par symbole).
  // Sauté si aucun dividende n'a été trouvé (économise le quota de 250 requêtes/jour).
  if(result.dividend){
    const { data } = await safeFetch(`${base}/earnings?symbol=${encodeURIComponent(ticker)}&apikey=${key}`);
    const list = Array.isArray(data) ? data : [];
    if(list.length){
      const sorted = list.slice().sort((a,b)=> (a.date||'').localeCompare(b.date||''));
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
  }

  if(diag.anyRateLimit && !result.dividend) throw rateLimitError();
  if(!result.name && !result.dividend && !result.earnings){
    if(diag.anyAuthError) throw new Error("Clé API refusée (401/403) — vérifiez qu'elle est bien collée sans espace dans Paramètres.");
    if(diag.anyPlanLimit) throw new Error("Titre non couvert par le plan gratuit FMP (actions hors États-Unis = payant). Saisissez les dates à la main.");
    if(diag.anyRateLimit) throw rateLimitError();
    if(diag.anyNetworkError) throw new Error("Échec réseau (CORS ou connexion bloquée) — l'API n'a pas pu être contactée depuis le navigateur.");
    if(diag.lastApiMessage) throw new Error(`Réponse API : ${diag.lastApiMessage}`);
    if(isLikelyISIN(tickerInput.trim()) && !result.resolvedSymbol){
      if(!tickerInput.trim().toUpperCase().startsWith('US')) throw new Error("ISIN hors États-Unis : le plan gratuit FMP ne permet pas de le convertir en ticker (relais Yahoo requis, ou saisissez le ticker à la main).");
      throw new Error("ISIN non résolu en ticker — vérifiez que la colonne Nom (Produit) a bien été importée, ou saisissez le ticker à la main (ex : AAPL).");
    }
    throw new Error('Aucune donnée exploitable pour ce ticker sur le plan API actuel.');
  }
  return result;
}

/* ---------------------------------------------------------------
   API — Yahoo Finance via le relais Cloudflare (gratuit, actions européennes)
   Fournit nom, devise, historique des dividendes (date ex-dividende + montant).
   Pas de date de mise en paiement ni de calendrier de résultats : ces champs
   restent saisissables à la main (l'app retombe sur la date ex-dividende).
   --------------------------------------------------------------- */
function cleanRelayUrl(raw){
  const s = String(raw||'').trim().replace(/\/+$/,'');
  return /^https:\/\/[^\s]+$/i.test(s) ? s : '';
}

function detectFrequency(isoDates){
  if(isoDates.length < 2) return 'irregular';
  const gaps = [];
  for(let i=1;i<isoDates.length;i++) gaps.push(daysBetween(isoDates[i-1], isoDates[i]));
  const avg = gaps.reduce((x,y)=>x+y,0)/gaps.length;
  if(avg < 45) return 'monthly';
  if(avg < 135) return 'quarterly';
  if(avg < 270) return 'semiannual';
  return 'annual';
}

async function fetchYahooData(tickerInput, nameHint){
  const relay = cleanRelayUrl(state.settings.relayUrl);
  if(!relay) throw new Error('Aucune adresse de relais Yahoo renseignée (voir Paramètres).');
  const result = { name:null, logo:null, website:null, currency:null, dividend:null, earnings:null, resolvedSymbol:null };

  async function call(path){
    let r;
    try{ r = await fetch(`${relay}${path}`); }
    catch(e){ throw new Error("Relais Yahoo injoignable (adresse incorrecte ou hors-ligne)."); }
    if(r.status === 403) throw new Error("Relais refusé (403) : l'adresse du site n'est pas dans ALLOWED_ORIGINS du relais.");
    if(r.status === 429) throw new Error('Yahoo limite temporairement les requêtes (429) — réessayez dans quelques minutes.');
    const data = await r.json().catch(()=>null);
    if(!r.ok || !data) throw new Error(`Réponse Yahoo invalide (code ${r.status}).`);
    return data;
  }

  let ticker = tickerInput.trim();
  if(isLikelyISIN(ticker)){
    const queries = [ticker.toUpperCase()];
    if(nameHint && nameHint.trim()) queries.push(nameHint.trim().slice(0,60));
    for(const q of queries){
      const data = await call(`/search?q=${encodeURIComponent(q)}`).catch(()=>null);
      const quotes = ((data && data.quotes) || []).filter(x => x && x.symbol && (!x.quoteType || ['EQUITY','ETF'].includes(x.quoteType)));
      const sym = pickBySuffix(quotes, ticker);
      if(sym){ result.resolvedSymbol = sym; ticker = sym; break; }
    }
    if(!result.resolvedSymbol) throw new Error("ISIN introuvable sur Yahoo — renseignez le vrai symbole boursier (ex : AI.PA).");
  }

  const data = await call(`/chart?symbol=${encodeURIComponent(ticker)}`);
  const res = data.chart && data.chart.result && data.chart.result[0];
  if(!res){
    const desc = data.chart && data.chart.error && data.chart.error.description;
    throw new Error(desc ? `Yahoo : ${desc}` : 'Symbole inconnu sur Yahoo.');
  }
  const meta = res.meta || {};
  result.name = meta.longName || meta.shortName || null;
  result.currency = meta.currency ? (meta.currency === 'GBp' ? 'GBP' : meta.currency) : null;

  const divs = Object.values((res.events && res.events.dividends) || {})
    .filter(d => d && d.amount && d.date)
    .map(d => ({ exDate: new Date(d.date*1000).toISOString().slice(0,10), payDate:null, amount:d.amount, estimate:false }))
    .sort((a,b)=> a.exDate.localeCompare(b.exDate))
    .slice(-8);
  if(divs.length){
    result.dividend = { history: divs, frequency: detectFrequency(divs.map(d=>d.exDate)) };
  }
  if(!result.name && !result.dividend) throw new Error('Aucune donnée Yahoo exploitable pour ce ticker.');
  return result;
}

/* Source de données : FMP d'abord (si clé), puis Yahoo via le relais (si adresse),
   notamment pour les titres hors États-Unis que le plan gratuit FMP refuse. */
function hasDataSource(){
  return !!state.settings.apiKey || !!cleanRelayUrl(state.settings.relayUrl);
}

async function fetchAutoData(tickerInput, nameHint){
  const hasFmp = !!state.settings.apiKey;
  const hasRelay = !!cleanRelayUrl(state.settings.relayUrl);
  if(!hasFmp && !hasRelay) throw new Error('Aucune clé API ni relais Yahoo renseigné (voir Paramètres).');
  let fmpErr = null;
  if(hasFmp){
    try{ return await fetchFmpData(tickerInput, nameHint); }
    catch(e){ fmpErr = e; if(!hasRelay) throw e; }
  }
  try{ return await fetchYahooData(tickerInput, nameHint); }
  catch(e){ throw fmpErr ? Object.assign(new Error(`FMP : ${fmpErr.message} · Yahoo : ${e.message}`), { rate: !!fmpErr.rate && !!e.rate }) : e; }
}

/* ---------------------------------------------------------------
   RENDU — TICKER TAPE
   --------------------------------------------------------------- */
function renderTickerTape(){
  const track = document.getElementById('tickerTrack');
  if(!track) return;
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
  if(view.mode === 'month'){
    label.textContent = `${MOIS_FR[view.cursor.getMonth()]} ${view.cursor.getFullYear()}`;
  }else{
    label.textContent = view.cursor.getFullYear();
  }
  document.getElementById('dateTypeSelect').value = view.dateType;
  document.getElementById('showEarningsCheckbox').checked = view.showEarnings;
  document.getElementById('logoLegend').style.display = (view.mode === 'logos') ? 'flex' : 'none';
}

function renderAccountSwitch(){
  const el = document.getElementById('accountSwitch');
  if(!el) return;
  const tabs = [{ id:'all', name:'Tous les comptes' }, ...state.accounts];
  el.innerHTML = tabs.map(t=>`<button data-acct="${t.id}" class="${view.accountFilter===t.id?'active':''}">${escapeHtml(t.name)}</button>`).join('');
  el.querySelectorAll('button').forEach(b=>{
    b.addEventListener('click', ()=>{ view.accountFilter = b.dataset.acct; renderAll(); });
  });
}

/* ---------------------------------------------------------------
   RENDU — CALENDRIER
   --------------------------------------------------------------- */
function renderCalendar(){
  const wrap = document.getElementById('calendarWrap');
  if(view.mode === 'year'){
    renderYearView(wrap);
  }else if(view.mode === 'logos'){
    renderLogoView(wrap);
  }else{
    renderMonthView(wrap);
  }
}

function renderLogoView(wrap){
  const year = view.cursor.getFullYear();
  const rangeStart = new Date(year, 0, 1);
  const rangeEnd = new Date(year, 11, 31);
  const index = buildEventIndex(rangeStart, rangeEnd);

  // Regroupe les événements par mois, triés par date
  const byMonth = Array.from({length:12}, ()=>[]);
  Object.keys(index).sort().forEach(dateISO=>{
    const month = parseISO(dateISO).getMonth();
    index[dateISO].forEach(ev=> byMonth[month].push(Object.assign({ dateISO }, ev)));
  });

  const cards = MOIS_FR.map((moisNom, m)=>{
    const events = byMonth[m];
    let inner;
    if(!events.length){
      inner = `<div class="logo-month-empty">Aucune échéance</div>`;
    }else{
      inner = `<div class="logo-avatar-list">${events.map(ev=>{
        const classes = ['logo-avatar-item'];
        if(ev.type === 'earnings') classes.push('is-earnings');
        if(ev.estimate) classes.push('is-estimate');
        const title = ev.type === 'dividend'
          ? `${ev.ticker} — ${fmtDateHuman(ev.dateISO)} — ${fmtAmount2(ev.total, ev.currency)}${ev.estimate?' (estimé)':''}`
          : `${ev.ticker} — Résultats — ${fmtDateHuman(ev.dateISO)}${ev.estimate?' (estimé)':''}`;
        const avatarInner = ev.logo
          ? `<img src="${escapeHtml(ev.logo)}" alt="${escapeHtml(ev.ticker)}" onerror="this.parentElement.innerHTML='${initials(ev.ticker)}'; this.parentElement.style.background='${colorFor(ev.ticker)}'; this.parentElement.style.color='#fff'; this.parentElement.style.fontFamily='var(--font-mono)'; this.parentElement.style.fontSize='11px'; this.parentElement.style.fontWeight='700';" />`
          : `<span style="background:${colorFor(ev.ticker)};color:#fff;width:100%;height:100%;display:flex;align-items:center;justify-content:center;font-family:var(--font-mono);font-size:11px;font-weight:700;">${initials(ev.ticker)}</span>`;
        return `<div class="${classes.join(' ')}" data-date="${ev.dateISO}" title="${escapeHtml(title)}">${avatarInner}</div>`;
      }).join('')}</div>`;
    }
    return `<div class="logo-month-card" data-month="${m}"><h3>${moisNom}</h3>${inner}</div>`;
  }).join('');

  wrap.innerHTML = `<div class="logo-grid">${cards}</div>`;

  wrap.querySelectorAll('.logo-avatar-item[data-date]').forEach(el=>{
    el.addEventListener('click', ()=> openDayPopover(el.dataset.date, index[el.dataset.date] || []));
  });
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
  const list = getFilteredHoldings();
  if(!list.length){
    el.innerHTML = `<div class="empty-state"><span class="em-icon">🗂️</span>${view.accountFilter==='all' ? "Aucune action pour l'instant.<br>Ajoutez votre première ligne." : "Aucune action dans ce compte."}</div>`;
    return;
  }
  let html = '';
  if(view.accountFilter === 'all'){
    state.accounts.forEach((acc, idx)=>{
      const items = list.filter(h=>h.account===acc.id);
      if(!items.length) return;
      html += `<div class="holdings-group-label"${idx===0?' style="border-top:none;margin-top:0;padding-top:0;"':''}>${escapeHtml(acc.name)}</div>`;
      html += items.map(holdingRowHtml).join('');
    });
  }else{
    html = list.map(holdingRowHtml).join('');
  }
  el.innerHTML = html;
  el.querySelectorAll('[data-edit]').forEach(btn=>{
    btn.addEventListener('click', ()=> openStockModal(btn.dataset.edit));
  });
}

/* ---------------------------------------------------------------
   DATES DE VERSEMENT VIA L'API (Financial Modeling Prep)
   Récupère les dates de paiement déclarées par les sociétés et le
   jour habituel de versement. Les rappels s'appuient dessus : plus
   besoin de saisir le jour à la main.
   --------------------------------------------------------------- */
const sleep = ms => new Promise(r=> setTimeout(r, ms));
let dateSync = { running:false, last:null };
async function syncPayDates(h, key){
  const r = await fetch(`https://financialmodelingprep.com/stable/dividends?symbol=${encodeURIComponent(h.ticker)}&apikey=${key}`);
  if(r.status === 429) throw Object.assign(new Error('quota'), { rate:true });
  if(r.status === 401 || r.status === 403) throw Object.assign(new Error('clé refusée'), { auth:true });
  if(!r.ok) throw new Error('HTTP ' + r.status);
  const data = await r.json();
  const arr = Array.isArray(data) ? data : ((data && data.historical) || []);
  const todayIso = todayISO();
  const rows = arr.map(x=>({ exDate:x.date||null, payDate:x.paymentDate||null, amount:x.dividend||x.adjDividend||null }))
    .filter(x=>x.amount && x.payDate).sort((a,b)=> a.payDate.localeCompare(b.payDate));
  h.dividend = h.dividend || {};
  h.dividend.confirmed = rows.filter(x=>x.payDate >= todayIso).slice(0,4);
  const lastPaid = rows.filter(x=>x.payDate < todayIso).pop();
  h.dividend.payDayApi = lastPaid ? Number(lastPaid.payDate.slice(8)) : null;
  h.dividend.lastSync = Date.now();
  return { confirmed: h.dividend.confirmed.length, payDayApi: h.dividend.payDayApi };
}
async function autoSyncDates(force){
  const key = state.settings.apiKey;
  if(!key || dateSync.running || !navigator.onLine) return null;
  const DAY = 24*3600*1000;
  const stale = state.holdings.filter(h=> force || !h.dividend || !h.dividend.lastSync || Date.now() - h.dividend.lastSync > DAY);
  if(!stale.length) return { ok:0, fail:0, rate:false, auth:false, total:0 };
  dateSync.running = true;
  const res = { ok:0, fail:0, rate:false, auth:false, total:stale.length };
  for(const h of (force ? stale : stale.slice(0,10))){
    try{ await syncPayDates(h, key); res.ok++; }
    catch(e){
      res.fail++;
      if(e.rate){ res.rate = true; break; }
      if(e.auth){ res.auth = true; break; }
      h.dividend = h.dividend || {}; h.dividend.lastSync = Date.now();   // pas de données : on réessaiera demain
    }
    await sleep(350);
  }
  dateSync.running = false; dateSync.last = res;
  if(res.ok || res.fail){ saveState(); renderAll(); checkNotifications(); }
  return res;
}

/* ---------------------------------------------------------------
   ONGLET « À VENIR » — les prochains versements, mois par mois
   --------------------------------------------------------------- */
function totalsLabel(totals){
  const cur = Object.keys(totals).filter(c=>totals[c]);
  if(!cur.length) return '';
  if(cur.length === 1) return fmtAmount2(totals[cur[0]], cur[0]);
  const { sum, missing } = sumToEUR(totals);
  if(!missing.length) return '≈ ' + fmtAmount2(sum, 'EUR');
  return cur.map(c=>fmtAmount2(totals[c], c)).join(' + ');
}
function relativeDay(iso){
  const n = daysBetween(todayISO(), iso);
  if(n === 0) return "Aujourd'hui";
  if(n === 1) return 'Demain';
  return `Dans ${n} jours`;
}
function renderUpcoming(){
  const hero = document.getElementById('upcomingHero');
  const listEl = document.getElementById('upcomingList');
  if(!hero || !listEl) return;
  const holdings = getFilteredHoldings();
  const now = new Date();
  const todayIso = todayISO();
  const monthNow = todayIso.slice(0,7);
  const horizon = view.upcomingMonths || 6;
  const from = new Date(now.getFullYear(), now.getMonth(), 1);
  const to = new Date(now.getFullYear(), now.getMonth() + horizon, 0);
  const items = Payouts.payoutsBetween(holdings, from, to).filter(p=>
    p.date >= todayIso || (!p.dayKnown && p.date.slice(0,7) === monthNow)
  );

  if(!state.holdings.length){
    hero.innerHTML = '';
    listEl.innerHTML = `<div class="empty-state big"><span class="em-icon">🗂️</span>Aucune action pour l'instant.<br>Ajoutez votre première ligne avec le bouton +.</div>`;
    return;
  }
  if(!items.length){
    hero.innerHTML = '';
    listEl.innerHTML = `<div class="empty-state big"><span class="em-icon">🔎</span>Aucun versement prévu.<br>Vérifiez que chaque action a un montant, une fréquence et un mois de versement.</div>`;
    return;
  }

  // --- Prochain versement
  const next = items[0];
  const nextDate = parseISO(next.date);
  const sameDay = items.filter(p=>p.date === next.date && p.dayKnown === next.dayKnown);
  const nextTotals = {};
  sameDay.forEach(p=>{ nextTotals[p.currency] = (nextTotals[p.currency]||0) + p.total; });
  const nextWhen = next.dayKnown
    ? `${relativeDay(next.date)} · ${JOURS_LONG[(nextDate.getDay()+6)%7]} ${nextDate.getDate()} ${MOIS_FR[nextDate.getMonth()].toLowerCase()}`
    : (next.date.slice(0,7) === monthNow ? 'Ce mois-ci' : `Attendu en ${MOIS_FR[nextDate.getMonth()].toLowerCase()}`) + ' · jour non renseigné';
  const nextWho = sameDay.length > 1
    ? `${sameDay.length} versements (${sameDay.map(p=>escapeHtml(p.ticker)).slice(0,3).join(', ')}${sameDay.length>3?'…':''})`
    : `${escapeHtml(next.ticker)} · ${escapeHtml(next.name)}`;
  hero.innerHTML = `<div class="next-pay">
    <div class="next-when">${nextWhen}</div>
    <div class="next-amount">${totalsLabel(nextTotals)}</div>
    <div class="next-who">${nextWho}</div>
    
  </div>`;

  // --- Liste groupée par mois
  const groups = {};
  items.forEach(p=>{ (groups[p.date.slice(0,7)] = groups[p.date.slice(0,7)] || []).push(p); });
  let html = '';
  Object.keys(groups).sort().forEach(key=>{
    const [y, m] = key.split('-').map(Number);
    const rows = groups[key].slice().sort((a,b)=>{
      if(a.dayKnown !== b.dayKnown) return a.dayKnown ? -1 : 1;
      return a.date < b.date ? -1 : a.date > b.date ? 1 : 0;
    });
    const totals = {};
    rows.forEach(p=>{ totals[p.currency] = (totals[p.currency]||0) + p.total; });
    html += `<section class="pay-month">
      <header class="pay-month-head"><h3>${MOIS_FR[m-1]} ${y}</h3><span class="pay-month-total">${totalsLabel(totals)}</span></header>
      ${rows.map(p=>{
        const h = state.holdings.find(x=>x.id===p.holdingId) || {};
        const d = parseISO(p.date);
        const acct = (view.accountFilter==='all' && state.accounts.length>1) ? accountName(h.account) : '';
        return `<button class="pay-row${p.date===todayIso&&p.dayKnown?' is-today':''}" data-edit="${p.holdingId}" type="button">
          <div class="pay-day">${p.dayKnown ? `<b>${d.getDate()}</b><span>${JOURS_FR[(d.getDay()+6)%7].toLowerCase()}.</span>` : `<b>—</b><span>jour ?</span>`}</div>
          ${renderAvatar(p.ticker, h.logo)}
          <div class="pay-meta">
            <div class="tk">${escapeHtml(p.ticker)}</div>
            <div class="nm">${escapeHtml(p.name)}${acct?` · ${escapeHtml(acct)}`:''}</div>
          </div>
          <div class="pay-amt"><b>${fmtAmount2(p.total, p.currency)}</b><span>${p.quantity} × ${fmtAmount(p.amount, p.currency)}</span>${p.confirmed?'<span class="conf">✓ date confirmée</span>':(p.dayFrom==='api'?'<span class="conf soft">jour habituel</span>':'')}</div>
        </button>`;
      }).join('')}
    </section>`;
  });
  if(horizon < 24) html += `<button class="btn btn-ghost more-btn" id="upcomingMoreBtn" type="button">Voir 6 mois de plus</button>`;
  html += `<p class="fine-print">Montants estimés d'après le dernier dividende saisi. Touchez une ligne pour la modifier.</p>`;
  listEl.innerHTML = html;
  listEl.querySelectorAll('[data-edit]').forEach(b=> b.addEventListener('click', ()=> openStockModal(b.dataset.edit)));
  const more = document.getElementById('upcomingMoreBtn');
  if(more) more.onclick = ()=>{ view.upcomingMonths = horizon + 6; renderUpcoming(); };
}
const JOURS_LONG = ['lundi','mardi','mercredi','jeudi','vendredi','samedi','dimanche'];

/* ---------------------------------------------------------------
   ONGLETS
   --------------------------------------------------------------- */
function renderTabs(){
  document.querySelectorAll('.screen').forEach(sc=> sc.classList.toggle('active', sc.id === 'screen-' + view.tab));
  document.querySelectorAll('.tabbar [data-tab]').forEach(b=>{
    const on = b.dataset.tab === view.tab;
    b.classList.toggle('active', on);
    if(on) b.setAttribute('aria-current','page'); else b.removeAttribute('aria-current');
  });
}
function setTab(t){ view.tab = t; renderAll(); window.scrollTo(0,0); }

/* ---------------------------------------------------------------
   RAPPELS DE VERSEMENT
   - À l'ouverture de l'app : notification système si c'est le jour.
   - En arrière-plan : au mieux (Android/Chrome, app installée).
   - Garanti app fermée : export agenda (.ics) vers le téléphone.
   --------------------------------------------------------------- */
function isIOS(){ return /iphone|ipad|ipod/i.test(navigator.userAgent); }
function isStandalone(){ return (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true; }
function notifSupported(){ return ('Notification' in window) && ('serviceWorker' in navigator); }
function notifStatusText(){
  if(!notifSupported()){
    return (isIOS() && !isStandalone())
      ? "Sur iPhone : ouvrez d'abord l'app depuis l'écran d'accueil (Partager → Sur l'écran d'accueil), puis revenez ici."
      : "Les notifications ne sont pas disponibles sur ce navigateur.";
  }
  if(Notification.permission === 'denied') return "Bloquées par le navigateur : réautorisez-les dans les réglages du site.";
  if(Notification.permission === 'granted' && state.settings.notify) return "Activées. Une notification par mois, avec le montant attendu pour chaque action concernée.";
  return "Désactivées.";
}
function mergeSent(other){
  if(!other) return;
  ['days','months'].forEach(k=>{ state.sent[k] = Object.assign({}, other[k] || {}, state.sent[k] || {}); });
}
async function showLocalNotification(plan){
  const reg = await navigator.serviceWorker.ready;
  await reg.showNotification(plan.title, { body: plan.body, tag: plan.tag, icon: 'icon-192.png', badge: 'icon-192.png' });
}
async function checkNotifications(){
  if(!state.settings.notify || !notifSupported() || Notification.permission !== 'granted') return;
  try{
    const c = await caches.open('dividendes-data');
    const r = await c.match('state.json');
    if(r){ const snap = await r.json(); mergeSent(snap.sent); }
  }catch(e){}
  const plans = Payouts.notificationPlan(state, new Date());
  for(const pl of plans){
    try{ await showLocalNotification(pl); Payouts.markSent(state, pl); }catch(e){}
  }
  if(plans.length) saveState();
}
async function registerPeriodicSync(){
  try{
    const reg = await navigator.serviceWorker.ready;
    if(!('periodicSync' in reg)) return;
    const st = await navigator.permissions.query({ name:'periodic-background-sync' });
    if(st.state === 'granted') await reg.periodicSync.register('payday-check', { minInterval: 12*3600*1000 });
  }catch(e){}
}
async function enableNotifications(){
  if(!notifSupported()){ toast(notifStatusText()); return false; }
  const perm = await Notification.requestPermission();
  if(perm !== 'granted'){ toast('Notifications refusées par le navigateur.'); renderAll(); return false; }
  state.settings.notify = true;
  saveState();
  registerPeriodicSync();
  await checkNotifications();
  renderAll();
  toast('Rappels activés.');
  return true;
}
function downloadICS(){
  const { text, count } = Payouts.buildICS({ holdings: state.holdings }, new Date(), 12, 9);
  if(!count){ toast('Aucun versement à exporter.'); return; }
  const blob = new Blob([text], { type:'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = 'dividendes.ics';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(()=> URL.revokeObjectURL(url), 2000);
  toast(`${count} rappel(s) prêts à importer dans votre agenda.`);
}
function renderNotifBanner(){
  const el = document.getElementById('notifBanner');
  if(!el) return;
  const show = !state.settings.notify && state.holdings.length && (!notifSupported() || Notification.permission === 'default') && !view.notifDismissed;
  el.hidden = !show;
  if(!show){ el.innerHTML = ''; return; }
  el.innerHTML = `<div class="nb-text"><b>Un résumé chaque mois ?</b><span>${notifSupported() ? 'Recevez le montant attendu ce mois-ci.' : escapeHtml(notifStatusText())}</span></div>
    <div class="nb-actions"><button class="btn btn-primary btn-sm" id="nbEnable" type="button">${notifSupported() ? 'Activer' : 'Détails'}</button><button class="btn btn-ghost btn-sm" id="nbClose" type="button" aria-label="Masquer">×</button></div>`;
  document.getElementById('nbEnable').onclick = ()=> notifSupported() ? enableNotifications() : openSettingsModal();
  document.getElementById('nbClose').onclick = ()=>{ view.notifDismissed = true; renderNotifBanner(); };
}

const MOIS_COURT = ['Jan','Fév','Mar','Avr','Mai','Juin','Juil','Aoû','Sep','Oct','Nov','Déc'];
function holdingRowHtml(h){
  const div = h.dividend || {};
  const months = monthsInCycle(div.anchorMonth, div.frequency);
  const perYear = (div.lastAmount && months.length) ? div.lastAmount * (h.quantity||0) * months.length : null;
  const sched = months.length
    ? `${freqLabel(div.frequency)} · ${months.slice().sort((x,y)=>x-y).map(m=>MOIS_COURT[m-1]).join(' ')}${div.payDay?` · le ${div.payDay}`:''}`
    : 'Calendrier de versement à compléter';
  return `<button class="holding-row" data-id="${h.id}" data-edit="${h.id}" type="button">
    ${renderAvatar(h.displayTicker || h.ticker, h.logo)}
    <div class="holding-meta">
      <div class="tk">${escapeHtml(h.displayTicker || h.ticker)} <span class="qty">×${h.quantity}</span></div>
      <div class="nm">${escapeHtml(h.name || 'Sans nom')}</div>
      <div class="sched">${escapeHtml(sched)}</div>
    </div>
    <div class="holding-year">${perYear!==null ? `<b>${fmtAmount2(perYear, h.currency)}</b><span>par an</span>` : ''}</div>
  </button>`;
}

function renderSummary(){
  const el = document.getElementById('summaryBox');
  const now = new Date();
  const yearEnd = new Date(now.getFullYear(), 11, 31);
  const holdingsList = getFilteredHoldings();
  const index = buildEventIndex(now, yearEnd, holdingsList);
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

  let breakdown = '';
  if(view.accountFilter === 'all' && state.accounts.length > 1){
    const perAccount = state.accounts.map(acc=>{
      const accHoldings = state.holdings.filter(h=>h.account===acc.id);
      if(!accHoldings.length) return '';
      const accIndex = buildEventIndex(now, yearEnd, accHoldings);
      const totals = {};
      Object.values(accIndex).forEach(evs=> evs.forEach(ev=>{ if(ev.type==='dividend') totals[ev.currency||'—'] = (totals[ev.currency||'—']||0)+(ev.total||0); }));
      const totalsStr = Object.keys(totals).length ? Object.keys(totals).map(c=>fmtAmount2(totals[c], c==='—'?'':c)).join(' + ') : '—';
      return `<div class="sum-row"><span class="lbl">${escapeHtml(acc.name)}</span><span class="val">${totalsStr}</span></div>`;
    }).join('');
    if(perAccount) breakdown = `<div style="margin-top:10px;padding-top:10px;border-top:1px dashed var(--line);">${perAccount}</div>`;
  }

  el.innerHTML = `
    <div class="sum-row"><span class="lbl">Lignes${view.accountFilter==='all'?' (tous comptes)':''}</span><span class="val">${holdingsList.length}</span></div>
    <div class="sum-row"><span class="lbl">Versements restants (${now.getFullYear()})</span><span class="val">${countRemaining}</span></div>
    ${rows}
    ${breakdown}
  `;
}

/* ---------------------------------------------------------------
   GRAPHIQUES — dividendes par mois & évolution annuelle
   Rendu en SVG "à la main" (pas de dépendance), dans le même
   thème graphique que le reste de l'app.
   --------------------------------------------------------------- */
function fmtCompact(v, currency){
  if(!v) return '';
  const sym = currencySymbol(currency);
  let numStr;
  if(Math.abs(v) >= 100) numStr = Math.round(v).toLocaleString('fr-FR');
  else if(Math.abs(v) >= 10) numStr = v.toFixed(1).replace('.', ',');
  else numStr = v.toFixed(2).replace('.', ',');
  return `${numStr}${sym}`;
}

function svgBarChart({ labels, values, estimateFlags, color, currency }){
  const width = 560, height = 210;
  const padding = { top:24, right:8, bottom:24, left:6 };
  const w = width - padding.left - padding.right;
  const h = height - padding.top - padding.bottom;
  const max = Math.max(1, ...values);
  const gap = 6;
  const barW = (w - gap*(values.length-1)) / values.length;
  const axisY = padding.top + h;

  let bars = '';
  values.forEach((v, i)=>{
    const bh = max > 0 ? (v/max) * h : 0;
    const x = padding.left + i*(barW+gap);
    const y = axisY - bh;
    const est = estimateFlags[i];
    const fillAttr = est ? `url(#hatch-${color.slice(1)})` : color;
    bars += `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barW.toFixed(1)}" height="${Math.max(bh,1).toFixed(1)}" rx="3" fill="${fillAttr}"><title>${escapeHtml(labels[i])} : ${fmtAmount2(v, currency)}${est && v ? ' (estimé)' : ''}</title></rect>`;
    if(v > 0){
      const labelY = Math.max(y - 5, 10);
      bars += `<text x="${(x+barW/2).toFixed(1)}" y="${labelY.toFixed(1)}" font-size="8.5" font-family="'IBM Plex Mono',monospace" text-anchor="middle" style="fill:${INK_SOFT_HEX}">${escapeHtml(fmtCompact(v, currency))}</text>`;
    }
    bars += `<text x="${(x+barW/2).toFixed(1)}" y="${height-7}" font-size="9.5" font-family="'IBM Plex Mono',monospace" text-anchor="middle" style="fill:${INK_SOFT_HEX}">${escapeHtml(labels[i])}</text>`;
  });

  return `<svg class="chart-svg" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <pattern id="hatch-${color.slice(1)}" width="6" height="6" patternTransform="rotate(45)" patternUnits="userSpaceOnUse">
        <rect width="6" height="6" style="fill:${color}" opacity="0.25"/>
        <line x1="0" y1="0" x2="0" y2="6" style="stroke:${color}" stroke-width="2"/>
      </pattern>
    </defs>
    <line x1="${padding.left}" y1="${axisY}" x2="${width-padding.right}" y2="${axisY}" style="stroke:${LINE_HEX}" stroke-width="1"/>
    ${bars}
  </svg>`;
}

function totalsByCurrencyForHoldings(holdingsList, rangeStart, rangeEnd){
  const index = buildEventIndex(rangeStart, rangeEnd, holdingsList);
  const totals = {};
  Object.values(index).forEach(evs=> evs.forEach(ev=>{
    if(ev.type !== 'dividend') return;
    totals[ev.currency||'—'] = (totals[ev.currency||'—']||0) + (ev.total||0);
  }));
  return totals;
}

function regionOf(holding){
  if(holding.exchange === 'US') return 'US';
  if(holding.exchange === 'EU') return 'Europe';
  return 'Autre';
}

function pillsFromTotals(totals){
  return Object.keys(totals)
    .filter(cur=> totals[cur])
    .map(cur=> fmtAmount2(totals[cur], cur))
    .join(' + ') || '—';
}

function eurCellHtml(totals){
  if(!fxRates) return `<span class="fx-pending">…</span>`;
  const { sum, missing } = sumToEUR(totals);
  const missingNote = missing.length ? ` <span class="fx-missing" title="Taux indisponible pour : ${missing.join(', ')}">*</span>` : '';
  return `${fmtAmount2(sum, 'EUR')}${missingNote}`;
}

/* Tableau Compte × Zone géographique (US / Europe / Autre) + total général.
   Toujours calculé sur TOUS les comptes (indépendamment du filtre actif),
   pour donner une vue d'ensemble complète en un coup d'œil. La colonne
   Total est convertie en euros ; US/Europe/Autre gardent la devise
   d'origine (c'est là que le montant en dollars reste visible tel quel). */
function renderRegionAccountTable(year){
  const rangeStart = new Date(year,0,1), rangeEnd = new Date(year,11,31);
  const regions = ['US','Europe','Autre'];
  const rows = state.accounts.map(acc=>{
    const accHoldings = state.holdings.filter(h=>h.account===acc.id);
    if(!accHoldings.length) return null;
    const byRegion = {};
    regions.forEach(r=> byRegion[r] = totalsByCurrencyForHoldings(accHoldings.filter(h=>regionOf(h)===r), rangeStart, rangeEnd));
    const accountTotal = totalsByCurrencyForHoldings(accHoldings, rangeStart, rangeEnd);
    return { name: acc.name, byRegion, accountTotal };
  }).filter(Boolean);

  if(!rows.length) return '';

  const grandByRegion = {};
  regions.forEach(r=> grandByRegion[r] = totalsByCurrencyForHoldings(state.holdings.filter(h=>regionOf(h)===r), rangeStart, rangeEnd));
  const grandTotal = totalsByCurrencyForHoldings(state.holdings, rangeStart, rangeEnd);

  const bodyRows = rows.map(r=>`
    <tr>
      <td>${escapeHtml(r.name)}</td>
      <td class="mono">${pillsFromTotals(r.byRegion['US'])}</td>
      <td class="mono">${pillsFromTotals(r.byRegion['Europe'])}</td>
      <td class="mono">${pillsFromTotals(r.byRegion['Autre'])}</td>
      <td class="mono region-total-col">${eurCellHtml(r.accountTotal)}</td>
    </tr>`).join('');

  return `<div class="region-table-wrap">
    <table class="region-totals-table">
      <thead><tr><th>Compte</th><th>US</th><th>Europe</th><th>Autre</th><th>Total (€)</th></tr></thead>
      <tbody>
        ${bodyRows}
        <tr class="region-grand-total">
          <td>Total général</td>
          <td class="mono">${pillsFromTotals(grandByRegion['US'])}</td>
          <td class="mono">${pillsFromTotals(grandByRegion['Europe'])}</td>
          <td class="mono">${pillsFromTotals(grandByRegion['Autre'])}</td>
          <td class="mono region-total-col">${eurCellHtml(grandTotal)}</td>
        </tr>
      </tbody>
    </table>
    ${fxRates ? `<div class="fx-caption">Taux de change du ${fmtDateHuman(fxDate)} (BCE) — 1 € = ${fxRates.USD ? fxRates.USD.toFixed(3)+' $' : '—'}</div>` : `<div class="fx-caption">Récupération des taux de change en cours…</div>`}
  </div>`;
}

function renderTotalsBlock(year, currencies){
  if(!currencies.length) return '';
  const rangeStart = new Date(year,0,1), rangeEnd = new Date(year,11,31);
  const overall = totalsByCurrencyForHoldings(getFilteredHoldings(), rangeStart, rangeEnd);

  return `<div class="chart-totals-wrap">
    <div class="chart-totals">Total ${year} (converti en €) : <strong class="chart-total-eur">${eurCellHtml(overall)}</strong></div>
    ${renderRegionAccountTable(year)}
  </div>`;
}

function buildMonthlyTotals(year){
  const rangeStart = new Date(year,0,1), rangeEnd = new Date(year,11,31);
  const index = buildEventIndex(rangeStart, rangeEnd);
  const totals = {}, allEstimate = {};
  Object.keys(index).forEach(dateISO=>{
    const month = parseISO(dateISO).getMonth();
    index[dateISO].forEach(ev=>{
      if(ev.type !== 'dividend') return;
      const cur = ev.currency || '—';
      if(!totals[cur]){ totals[cur] = Array(12).fill(0); allEstimate[cur] = Array(12).fill(true); }
      totals[cur][month] += ev.total || 0;
      if(!ev.estimate) allEstimate[cur][month] = false;
    });
  });
  return { totals, allEstimate };
}

function buildYearlyTotals(startYear, endYear){
  const rangeStart = new Date(startYear,0,1), rangeEnd = new Date(endYear,11,31);
  const index = buildEventIndex(rangeStart, rangeEnd);
  const totals = {}, allEstimate = {};
  Object.keys(index).forEach(dateISO=>{
    const y = parseISO(dateISO).getFullYear();
    index[dateISO].forEach(ev=>{
      if(ev.type !== 'dividend') return;
      const cur = ev.currency || '—';
      if(!totals[cur]) totals[cur] = {};
      if(!allEstimate[cur]) allEstimate[cur] = {};
      totals[cur][y] = (totals[cur][y]||0) + (ev.total||0);
      if(allEstimate[cur][y] === undefined) allEstimate[cur][y] = true;
      if(!ev.estimate) allEstimate[cur][y] = false;
    });
  });
  return { totals, allEstimate };
}

function renderStats(){
  const section = document.getElementById('statsSection');
  const filteredHoldings = getFilteredHoldings();
  const acctLabel = view.accountFilter === 'all' ? '' : ` — ${accountName(view.accountFilter)}`;
  if(!filteredHoldings.length){
    section.innerHTML = `<div class="stats-card"><div class="empty-state">${view.accountFilter==='all' ? "Ajoutez des actions pour voir vos statistiques de revenus apparaître ici." : "Aucune action dans ce compte."}</div></div>`;
    return;
  }
  const year = view.cursor.getFullYear();
  const { totals: monthTotals, allEstimate: monthEst } = buildMonthlyTotals(year);
  const monthLabels = MOIS_FR.map(m=>m.slice(0,3));
  const monthCurrencies = Object.keys(monthTotals);

  let monthHtml;
  if(!monthCurrencies.length){
    monthHtml = `<div class="empty-state">Aucun montant connu pour ${year}. Renseignez le montant du dividende sur vos lignes.</div>`;
  }else{
    monthHtml = monthCurrencies.map(cur=>`
      <div class="chart-block">
        <div class="chart-cur-label">${escapeHtml(cur)}</div>
        ${svgBarChart({ labels: monthLabels, values: monthTotals[cur], estimateFlags: monthEst[cur], color: GOLD_HEX, currency: cur })}
      </div>`).join('');
  }

  section.innerHTML = `
    <div class="stats-card">
      <h3>Dividendes par mois — ${year}${acctLabel}</h3>
      <p class="stats-sub">Selon le filtre actif (${view.dateType==='ex' ? 'ex-dividende' : 'mise en paiement'}). Motif hachuré = mois entièrement estimé.</p>
      ${monthHtml}
    </div>
    <div class="stats-card">
      <h3>Totaux${acctLabel}</h3>
      <p class="stats-sub">Par compte et par zone géographique, converti en euros.</p>
      ${renderTotalsBlock(year, monthCurrencies)}
    </div>
  `;
}

/* ---------------------------------------------------------------
   IMPORT D'UN RELEVÉ DE COURTIER (CSV / Excel)
   Fonctionne avec n'importe quel export tabulaire (Degiro ou
   autre) : l'utilisateur associe lui-même les colonnes Ticker et
   Quantité, car chaque courtier nomme/ordonne ses colonnes
   différemment. Les PDF ne sont pas analysés automatiquement —
   trop peu fiable d'un courtier à l'autre ; Degiro propose un
   export CSV direct depuis la page "Portefeuille" à privilégier.
   --------------------------------------------------------------- */
let importRowsCache = [];

function handleBrokerFile(file){
  const name = file.name.toLowerCase();
  if(name.endsWith('.csv')){
    const reader = new FileReader();
    reader.onload = ()=>{
      if(typeof Papa === 'undefined'){ toast('Bibliothèque CSV indisponible (hors-ligne ?).'); return; }
      let text = reader.result;
      if(text.charCodeAt(0) === 0xFEFF) text = text.slice(1); // retire le BOM UTF-8 (courant sur les exports bancaires)
      const parsed = Papa.parse(text, { header:false, skipEmptyLines:true });
      openImportMappingModal(parsed.data);
    };
    reader.readAsText(file, 'UTF-8');
  }else if(name.endsWith('.xlsx') || name.endsWith('.xls')){
    const reader = new FileReader();
    reader.onload = ()=>{
      if(typeof XLSX === 'undefined'){ toast('Bibliothèque Excel indisponible (hors-ligne ?).'); return; }
      const data = new Uint8Array(reader.result);
      const wb = XLSX.read(data, { type:'array' });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(sheet, { header:1, raw:false, defval:'' });
      openImportMappingModal(rows);
    };
    reader.readAsArrayBuffer(file);
  }else{
    toast('Format non pris en charge. Utilisez un fichier .csv ou .xlsx.');
  }
}

function parseNumberLoose(raw){
  if(raw === undefined || raw === null) return NaN;
  let s = String(raw).trim().replace(/\s/g,'').replace(/[€$£]/g,'');
  if(!s) return NaN;
  const hasComma = s.includes(','), hasDot = s.includes('.');
  if(hasComma && hasDot){
    if(s.lastIndexOf(',') > s.lastIndexOf('.')) s = s.replace(/\./g,'').replace(',', '.');
    else s = s.replace(/,/g,'');
  }else if(hasComma){
    s = s.replace(',', '.');
  }
  return parseFloat(s);
}

const TICKER_KEYWORDS = ['symbole','symbol','ticker','isin','code'];
const QTY_KEYWORDS = ['quantité','quantity','nombre','qté','qty','position','en portefeuille'];
const NAME_KEYWORDS = ['produit','nom','name','société','company','libellé'];

/* Beaucoup d'exports bancaires ont 1 ou 2 lignes de titre/résumé avant la vraie
   ligne d'en-têtes de colonnes. On cherche automatiquement, dans les 10
   premières lignes, celle qui ressemble le plus à un en-tête (contient à la
   fois un mot-clé "ticker" et un mot-clé "quantité"). */
function guessHeaderRowIndex(rows){
  const maxCheck = Math.min(10, rows.length);
  for(let i=0;i<maxCheck;i++){
    const cells = (rows[i]||[]).map(c=>String(c).toLowerCase());
    const hasTicker = cells.some(c=>TICKER_KEYWORDS.some(k=>c.includes(k)));
    const hasQty = cells.some(c=>QTY_KEYWORDS.some(k=>c.includes(k)));
    if(hasTicker && hasQty) return i;
  }
  return 0;
}

function openImportMappingModal(rows){
  rows = (rows||[]).filter(r=> r && r.some(c=> String(c).trim() !== ''));
  if(!rows.length){ toast('Fichier vide ou illisible.'); return; }
  importRowsCache = rows;
  renderImportModal(guessHeaderRowIndex(rows));
}

function renderImportModal(headerRowIdx){
  const rows = importRowsCache;
  const headerRow = rows[headerRowIdx] || [];
  const colCount = Math.max(...rows.map(r=>r.length));

  const guessCol = (keywords)=>{
    for(let i=0;i<colCount;i++){
      const h = (headerRow[i]||'').toString().toLowerCase();
      if(keywords.some(k=>h.includes(k))) return i;
    }
    return -1;
  };
  const guessTicker = guessCol(TICKER_KEYWORDS);
  const guessQty = guessCol(QTY_KEYWORDS);
  const guessName = guessCol(NAME_KEYWORDS);

  const options = (selected)=>{
    let opts = `<option value="-1">— Ignorer —</option>`;
    for(let i=0;i<colCount;i++){
      const label = headerRow[i] ? `${headerRow[i]} (col ${i+1})` : `Colonne ${i+1}`;
      opts += `<option value="${i}" ${i===selected?'selected':''}>${escapeHtml(label)}</option>`;
    }
    return opts;
  };

  const headerRowOptions = Array.from({length: Math.min(10, rows.length)}, (_,i)=>i)
    .map(i=>`<option value="${i}" ${i===headerRowIdx?'selected':''}>Ligne ${i+1}${rows[i] ? ' — ' + rows[i].slice(0,3).map(c=>String(c)).join(' / ') : ''}</option>`)
    .join('');

  const previewRows = rows.slice(0, 9);
  const previewHtml = `<div class="import-preview-wrap"><table><tbody>
    ${previewRows.map((r,i)=>`<tr style="${i===headerRowIdx?'background:var(--forest-tint);font-weight:600;':''}"><td class="mono" style="color:var(--ink-soft);">${i+1}</td>${r.map(c=>`<td>${escapeHtml(c)}</td>`).join('')}</tr>`).join('')}
  </tbody></table></div>`;

  const root = document.getElementById('modalRoot');
  root.innerHTML = `<div class="modal-overlay" id="impOverlay">
    <div class="modal" style="max-width:680px;">
      <button class="modal-close" id="impClose">×</button>
      <h2>Importer un relevé</h2>
      <p class="modal-sub">Si l'import ne détecte rien, la cause la plus fréquente est une ligne d'en-tête mal identifiée (beaucoup d'exports ont 1-2 lignes de résumé avant le vrai tableau) — corrigez-la ci-dessous, la ligne surlignée en vert dans l'aperçu est celle actuellement utilisée comme en-tête.</p>

      <div class="field">
        <label>Ligne contenant les en-têtes de colonnes</label>
        <select id="map-headerrow">${headerRowOptions}</select>
      </div>

      <div class="field-row">
        <div class="field"><label>Colonne Ticker / Symbole</label><select id="map-ticker">${options(guessTicker)}</select></div>
        <div class="field"><label>Colonne Quantité</label><select id="map-qty">${options(guessQty)}</select></div>
      </div>
      <div class="field-row">
        <div class="field"><label>Colonne Nom (optionnel)</label><select id="map-name">${options(guessName)}</select></div>
        <div class="field"><label>Compte de destination</label>
          <select id="imp-account">
            ${state.accounts.map(a=>`<option value="${a.id}" ${(view.accountFilter!=='all'?view.accountFilter:state.accounts[0].id)===a.id?'selected':''}>${escapeHtml(a.name)}</option>`).join('')}
          </select>
        </div>
      </div>
      <div class="field" style="margin-top:2px;">
        <label style="display:flex; align-items:center; gap:8px; font-weight:500;">
          <input type="checkbox" id="imp-only-dividend" style="accent-color:var(--forest);" ${hasDataSource() ? '' : 'disabled'} />
          Ne garder que les entreprises versant un dividende
        </label>
        <span class="hint">${hasDataSource()
          ? "Vérifie chaque ligne une par une via l'API avant de l'ajouter (plus lent : ~1 seconde par ligne), et remplit directement les données de dividende au passage."
          : "Nécessite une clé API dans ⚙ Paramètres pour pouvoir vérifier les lignes."}</span>
      </div>
      <div class="section-title">Aperçu (les 9 premières lignes du fichier, numérotées)</div>
      ${previewHtml}
      <span class="hint">Les lignes déjà présentes dans votre portefeuille (même ticker) sont ignorées automatiquement.</span>
      <div class="modal-actions">
        <span></span>
        <div class="right">
          <button class="btn btn-ghost" id="impCancel">Annuler</button>
          <button class="btn btn-primary" id="impConfirm">Importer</button>
        </div>
      </div>
    </div>
  </div>`;
  document.getElementById('impClose').onclick = ()=>{ if(!importInProgress) closeModal(); };
  document.getElementById('impCancel').onclick = ()=>{ if(!importInProgress) closeModal(); };
  document.getElementById('impOverlay').addEventListener('click', (e)=>{ if(e.target.id==='impOverlay' && !importInProgress) closeModal(); });
  document.getElementById('impConfirm').onclick = confirmImportMapping;
  document.getElementById('map-headerrow').onchange = (e)=> renderImportModal(Number(e.target.value));
}

let importInProgress = false;

async function confirmImportMapping(){
  const rows = importRowsCache;
  const headerRowIdx = Number(document.getElementById('map-headerrow').value);
  const tCol = Number(document.getElementById('map-ticker').value);
  const qCol = Number(document.getElementById('map-qty').value);
  const nCol = Number(document.getElementById('map-name').value);
  const accountId = document.getElementById('imp-account').value;
  const onlyDividend = document.getElementById('imp-only-dividend').checked;
  if(tCol < 0){ toast('Sélectionnez au minimum la colonne Ticker.'); return; }
  if(onlyDividend && !hasDataSource()){ toast('Ajoutez une clé API ou un relais Yahoo dans Paramètres pour filtrer par dividende.'); return; }

  const dataRows = rows.slice(headerRowIdx + 1);
  const candidates = [];
  let skippedEmptyTicker = 0, skippedBadQty = 0, skippedDupe = 0;
  dataRows.forEach(r=>{
    const rawTicker = (r[tCol] || '').toString().trim();
    if(!rawTicker){ skippedEmptyTicker++; return; }
    const qty = qCol >= 0 ? parseNumberLoose(r[qCol]) : 1;
    if(!qty || qty <= 0 || isNaN(qty)){ skippedBadQty++; return; }
    const already = state.holdings.some(h => (h.displayTicker||h.ticker||'').toUpperCase() === rawTicker.toUpperCase());
    if(already){ skippedDupe++; return; }
    candidates.push({ rawTicker, qty, name: nCol >= 0 ? (r[nCol]||'').toString().trim() : '' });
  });
  const totalSkippedUpfront = skippedEmptyTicker + skippedBadQty + skippedDupe;

  if(!candidates.length){
    closeModal();
    if(totalSkippedUpfront > 0){
      const reasons = [];
      if(skippedEmptyTicker) reasons.push(`${skippedEmptyTicker} sans ticker (colonne Ticker probablement mal choisie)`);
      if(skippedBadQty) reasons.push(`${skippedBadQty} quantité invalide (colonne Quantité probablement mal choisie)`);
      if(skippedDupe) reasons.push(`${skippedDupe} déjà présent(s) dans le portefeuille`);
      toast(`0 action importée. ${reasons.join(' · ')}.`);
    }else{
      toast('Aucune ligne exploitable dans ce fichier.');
    }
    renderAll();
    return;
  }

  /* ---- Import rapide, sans vérification API (comportement d'origine) ---- */
  if(!onlyDividend){
    candidates.forEach(c=>{
      state.holdings.push({
        id: uid(), ticker: c.rawTicker, displayTicker: c.rawTicker.toUpperCase(),
        name: c.name, exchange: 'Autre', quantity: c.qty, currency: 'EUR',
        account: accountId, logo: null, source: 'import',
        dividend: { lastAmount:null, anchorMonth:null, frequency:'quarterly' },
        earnings: { anchorMonth:null, frequency:'quarterly' }
      });
    });
    saveState();
    closeModal();
    toast(`${candidates.length} action(s) importée(s)${totalSkippedUpfront ? `, ${totalSkippedUpfront} ligne(s) ignorée(s)` : ''}.`);
    renderAll();
    return;
  }

  /* ---- Import filtré : on vérifie chaque ligne via l'API avant de l'ajouter ---- */
  importInProgress = true;
  const confirmBtn = document.getElementById('impConfirm');
  const cancelBtn = document.getElementById('impCancel');
  confirmBtn.disabled = true;
  cancelBtn.disabled = true;

  let added = 0, noDividend = 0, failed = 0;
  const failedList = [];
  for(let i=0;i<candidates.length;i++){
    const c = candidates[i];
    confirmBtn.textContent = `Vérification ${i+1}/${candidates.length}…`;
    try{
      const data = await fetchAutoData(c.rawTicker, c.name);
      if(data.dividend && data.dividend.history && data.dividend.history.length){
        const symbol = data.resolvedSymbol || c.rawTicker;
        const last = data.dividend.history[data.dividend.history.length-1];
        const lastEarn = data.earnings && data.earnings.history.length ? data.earnings.history[data.earnings.history.length-1] : null;
        state.holdings.push({
          id: uid(), ticker: symbol, displayTicker: symbol.toUpperCase(),
          name: data.name || c.name, exchange: 'Autre', quantity: c.qty, currency: data.currency || 'EUR',
          account: accountId, logo: data.logo || null, source: 'import',
          dividend: { lastAmount: last.amount, anchorMonth: monthOf(last.payDate || last.exDate), frequency: data.dividend.frequency },
          earnings: data.earnings ? { anchorMonth: lastEarn ? monthOf(lastEarn.date) : null, frequency: data.earnings.frequency } : { anchorMonth:null, frequency:'quarterly' }
        });
        added++;
      }else{
        noDividend++;
      }
    }catch(e){
      failed++;
      failedList.push(c.rawTicker);
    }
    saveState();
    await new Promise(r=>setTimeout(r, 350));
  }

  importInProgress = false;
  closeModal();
  const parts = [`${added} action(s) verseuse(s) de dividende importée(s)`];
  if(noDividend) parts.push(`${noDividend} sans dividende détecté (ignorée(s))`);
  if(failed) parts.push(`${failed} échec(s) de vérification : ${failedList.slice(0,5).join(', ')}${failedList.length>5?'…':''}`);
  if(totalSkippedUpfront) parts.push(`${totalSkippedUpfront} ligne(s) déjà écartée(s) avant vérification`);
  toast(parts.join(' · ') + '.');
  renderAll();
}

/* ---------------------------------------------------------------
   RÉCUPÉRATION AUTOMATIQUE GROUPÉE
   Complète toutes les lignes qui n'ont pas encore d'historique de
   dividendes (typiquement après un import CSV/Excel), une par une
   avec une petite pause pour respecter le quota de l'API.
   --------------------------------------------------------------- */
async function runBulkAutoFetch(){
  if(!hasDataSource()){
    toast('Ajoutez une clé API dans Paramètres pour la récupération automatique.');
    openSettingsModal();
    return;
  }
  const targets = state.holdings.filter(h => !h.dividend.anchorMonth || !h.dividend.lastAmount);
  if(!targets.length){ toast('Toutes les lignes ont déjà des données de dividende.'); return; }
  toast(`Récupération en cours pour ${targets.length} ligne(s)…`);

  let ok = 0, fail = 0, resolved = 0; const failedTickers = []; let firstError = ''; let stoppedOnQuota = false;
  for(const h of targets){
    try{
      const data = await fetchAutoData(h.ticker, h.name);
      if(data.resolvedSymbol){
        h.ticker = data.resolvedSymbol;
        h.displayTicker = data.resolvedSymbol.toUpperCase();
        resolved++;
      }
      if(data.name && !h.name) h.name = data.name;
      if(data.logo) h.logo = data.logo;
      if(data.currency) h.currency = data.currency;
      if(data.dividend){
        h.dividend.frequency = data.dividend.frequency;
        const last = data.dividend.history[data.dividend.history.length-1];
        if(last){ h.dividend.lastAmount = last.amount; h.dividend.anchorMonth = monthOf(last.payDate || last.exDate); }
      }
      if(data.earnings){
        h.earnings.frequency = data.earnings.frequency;
        const last = data.earnings.history[data.earnings.history.length-1];
        if(last){ h.earnings.anchorMonth = monthOf(last.date); }
      }
      ok++;
    }catch(e){
      fail++;
      failedTickers.push(h.displayTicker || h.ticker);
      if(!firstError) firstError = e && e.message ? e.message : '';
      if(e && e.rate){ stoppedOnQuota = true; break; }
    }
    saveState();
    renderHoldingsList();
    await new Promise(r=>setTimeout(r, 350));
  }
  saveState();
  renderAll();
  if(stoppedOnQuota){ toast(`Quota FMP atteint (250 requêtes/jour) : ${ok} ligne(s) remplie(s), arrêt anticipé. Relancez demain, les lignes déjà remplies sont conservées.`); return; }
  toast(`${ok} ligne(s) mise(s) à jour${resolved ? ` (dont ${resolved} ISIN résolu(s) en ticker)` : ''}${fail ? `, ${fail} échec(s) : ${failedTickers.slice(0,5).join(', ')}${failedTickers.length>5?'…':''}. ${firstError} Relancez l'auto-complétion pour réessayer ces lignes` : ''}.`);
}

/* ---------------------------------------------------------------
   MODAL — COMPTES / PORTEFEUILLES
   --------------------------------------------------------------- */
function openAccountsModal(){
  const root = document.getElementById('modalRoot');
  const rowsHtml = state.accounts.map(a=>{
    const count = state.holdings.filter(h=>h.account===a.id).length;
    return `<div class="account-row" data-id="${a.id}">
      <input type="text" value="${escapeHtml(a.name)}" data-rename="${a.id}" />
      <span class="hint" style="white-space:nowrap;">${count} ligne(s)</span>
      <button class="holding-edit" data-delete="${a.id}" title="Supprimer" ${state.accounts.length<=1?'disabled':''}>🗑</button>
    </div>`;
  }).join('');

  root.innerHTML = `<div class="modal-overlay" id="acctOverlay">
    <div class="modal" style="max-width:460px;">
      <button class="modal-close" id="acctClose">×</button>
      <h2>Comptes / portefeuilles</h2>
      <p class="modal-sub">Séparez par exemple votre CTO et votre PEA — chaque action est rattachée à un compte, et vous pouvez les consulter séparément ou ensemble via les onglets en haut.</p>
      <div id="acctRows">${rowsHtml}</div>
      <div class="account-row" style="margin-top:14px;">
        <input type="text" id="newAcctName" placeholder="Nom du nouveau compte (ex : PEA)" />
        <button class="btn btn-primary btn-sm" id="addAcctBtn">Ajouter</button>
      </div>
      <div class="modal-actions"><span></span><div class="right"><button class="btn btn-ghost" id="acctDone">Fermer</button></div></div>
    </div>
  </div>`;

  document.getElementById('acctClose').onclick = closeModal;
  document.getElementById('acctDone').onclick = closeModal;
  document.getElementById('acctOverlay').addEventListener('click', (e)=>{ if(e.target.id==='acctOverlay') closeModal(); });

  root.querySelectorAll('[data-rename]').forEach(inp=>{
    inp.addEventListener('change', ()=>{
      const acc = state.accounts.find(a=>a.id===inp.dataset.rename);
      if(acc){ acc.name = inp.value.trim() || acc.name; saveState(); renderAll(); }
    });
  });
  root.querySelectorAll('[data-delete]').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      if(state.accounts.length <= 1){ toast('Il doit rester au moins un compte.'); return; }
      const id = btn.dataset.delete;
      const count = state.holdings.filter(h=>h.account===id).length;
      const fallbackAcc = state.accounts.find(a=>a.id!==id);
      if(count>0 && !confirm(`${count} ligne(s) seront déplacées vers "${fallbackAcc.name}". Continuer ?`)) return;
      state.holdings.forEach(h=>{ if(h.account===id) h.account = fallbackAcc.id; });
      state.accounts = state.accounts.filter(a=>a.id!==id);
      if(view.accountFilter === id) view.accountFilter = 'all';
      saveState();
      toast('Compte supprimé.');
      openAccountsModal();
      renderAll();
    });
  });
  document.getElementById('addAcctBtn').onclick = ()=>{
    const nameInput = document.getElementById('newAcctName');
    const name = nameInput.value.trim();
    if(!name){ toast('Donnez un nom au compte.'); return; }
    state.accounts.push({ id: uid(), name });
    saveState();
    toast('Compte ajouté.');
    openAccountsModal();
    renderAll();
  };
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
    account: (view.accountFilter !== 'all' ? view.accountFilter : state.accounts[0].id),
    logo: null, source: 'manual',
    dividend: { lastAmount:null, anchorMonth:null, frequency:'quarterly' },
    earnings: { anchorMonth:null, frequency:'quarterly' }
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
        <div class="field" style="position:relative;">
          <label>Nom de l'entreprise ou ticker</label>
          <input type="text" id="f-ticker" value="${escapeHtml(d.ticker)}" placeholder="ex : Air Liquide, AAPL, AI.PA" autocomplete="off" />
          <div id="tickerSuggestList" class="ticker-suggest-list" style="display:none;"></div>
          <span class="hint">Tapez un nom d'entreprise pour rechercher, ou un ticker directement (Euronext Paris : .PA, Amsterdam : .AS, Allemagne : .DE, Londres : .L).</span>
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
      <div class="field">
        <label>Compte</label>
        <select id="f-account">
          ${state.accounts.map(a=>`<option value="${a.id}" ${d.account===a.id?'selected':''}>${escapeHtml(a.name)}</option>`).join('')}
        </select>
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
      <div class="field">
        <label>Mois de versement (un seul suffit)</label>
        <select id="f-div-month">
          <option value="">—</option>
          ${MOIS_FR.map((m,i)=>`<option value="${i+1}" ${Number(d.dividend.anchorMonth)===i+1?'selected':''}>${m}</option>`).join('')}
        </select>
      </div>
      <div class="field">
        <label>Jour de versement (facultatif — sinon via l'API)</label>
        <select id="f-div-day">
          <option value="">Je ne sais pas</option>
          ${Array.from({length:31},(_,i)=>`<option value="${i+1}" ${Number(d.dividend.payDay)===i+1?'selected':''}>${i+1}</option>`).join('')}
        </select>
      </div>
      <span class="hint">Les autres mois sont calculés automatiquement à partir de la fréquence — ex : trimestrielle + Août → Fév/Mai/Août/Nov chaque année. Le jour est récupéré automatiquement via l'API ; saisissez-le ici seulement pour le forcer.</span>

      <div class="section-title">Résultats trimestriels / semestriels / annuels</div>
      <div class="field-row">
        <div class="field">
          <label>Mois de publication (un seul suffit)</label>
          <select id="f-earn-month">
            <option value="">—</option>
            ${MOIS_FR.map((m,i)=>`<option value="${i+1}" ${Number(d.earnings.anchorMonth)===i+1?'selected':''}>${m}</option>`).join('')}
          </select>
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
  wireTickerSearch();
}

/* ---------------------------------------------------------------
   RECHERCHE D'ENTREPRISE PAR NOM (autocomplétion)
   Évite d'avoir à connaître le ticker ou l'ISIN exact : on tape le
   nom, on choisit dans la liste, le ticker se remplit tout seul et
   la récupération automatique se lance immédiatement.
   --------------------------------------------------------------- */
let tickerSearchTimer = null;

async function searchCompanies(query){
  const key = state.settings.apiKey;
  if(!key || query.trim().length < 2) return [];
  try{
    const r = await fetch(`https://financialmodelingprep.com/stable/search-name?query=${encodeURIComponent(query.trim())}&limit=8&apikey=${key}`);
    if(!r.ok) return [];
    const data = await r.json();
    return Array.isArray(data) ? data : [];
  }catch(e){ return []; }
}

function wireTickerSearch(){
  const input = document.getElementById('f-ticker');
  const list = document.getElementById('tickerSuggestList');
  if(!input || !list) return;

  input.addEventListener('input', ()=>{
    clearTimeout(tickerSearchTimer);
    const q = input.value.trim();
    if(q.length < 2){ list.style.display = 'none'; list.innerHTML = ''; return; }
    if(!state.settings.apiKey){ list.style.display = 'none'; return; }
    tickerSearchTimer = setTimeout(async ()=>{
      const results = await searchCompanies(q);
      if(!results.length){ list.style.display = 'none'; list.innerHTML = ''; return; }
      list.innerHTML = results.map(r=>`
        <div class="ticker-suggest-item" data-symbol="${escapeHtml(r.symbol)}" data-name="${escapeHtml(r.name||'')}" data-currency="${escapeHtml(r.currency||'')}">
          <span class="tk">${escapeHtml(r.symbol)}</span>
          <span class="nm">${escapeHtml(r.name||'')}</span>
          <span class="ex">${escapeHtml(r.exchangeShortName||r.stockExchange||'')}</span>
        </div>`).join('');
      list.style.display = 'block';
      list.querySelectorAll('.ticker-suggest-item').forEach(item=>{
        item.addEventListener('mousedown', (e)=>{
          e.preventDefault(); // évite que le blur de l'input ne ferme la liste avant le clic
          input.value = item.dataset.symbol;
          modalDraft.ticker = item.dataset.symbol;
          modalDraft.displayTicker = item.dataset.symbol.toUpperCase();
          const nameField = document.getElementById('f-name');
          if(nameField && !nameField.value) nameField.value = item.dataset.name;
          const curField = document.getElementById('f-currency');
          if(curField && item.dataset.currency) curField.value = item.dataset.currency;
          list.style.display = 'none';
          list.innerHTML = '';
          runAutoFetch(); // on connaît déjà un ticker valide, autant enchaîner directement
        });
      });
    }, 300);
  });

  input.addEventListener('blur', ()=>{
    setTimeout(()=>{ list.style.display = 'none'; }, 150);
  });
  input.addEventListener('focus', ()=>{
    if(list.innerHTML) list.style.display = 'block';
  });
}

async function runAutoFetch(){
  const statusEl = document.getElementById('autoFetchStatus');
  const ticker = document.getElementById('f-ticker').value.trim();
  if(!ticker){ statusEl.textContent = 'Renseignez d\'abord un ticker.'; statusEl.className='auto-fetch-status err'; return; }
  if(!hasDataSource()){
    statusEl.innerHTML = 'Aucune clé API — ajoutez-en une dans Paramètres, ou complétez les champs à la main.';
    statusEl.className = 'auto-fetch-status err';
    return;
  }
  statusEl.textContent = 'Récupération en cours…';
  statusEl.className = 'auto-fetch-status';
  try{
    const data = await fetchAutoData(ticker);
    if(data.resolvedSymbol){
      document.getElementById('f-ticker').value = data.resolvedSymbol;
      modalDraft.ticker = data.resolvedSymbol;
      modalDraft.displayTicker = data.resolvedSymbol.toUpperCase();
    }
    if(data.name) document.getElementById('f-name').value = data.name;
    if(data.currency) document.getElementById('f-currency').value = data.currency;
    modalDraft.logo = data.logo || modalDraft.logo;
    modalDraft.website = data.website || modalDraft.website;
    if(data.dividend){
      modalDraft.dividend.frequency = data.dividend.frequency;
      const last = data.dividend.history[data.dividend.history.length-1];
      if(last){
        document.getElementById('f-div-amount').value = last.amount || '';
        const m = monthOf(last.payDate || last.exDate);
        if(m) document.getElementById('f-div-month').value = String(m);
        document.getElementById('f-div-freq').value = data.dividend.frequency;
      }
    }
    if(data.earnings){
      modalDraft.earnings.frequency = data.earnings.frequency;
      const last = data.earnings.history[data.earnings.history.length-1];
      if(last){
        const m = monthOf(last.date);
        if(m) document.getElementById('f-earn-month').value = String(m);
        document.getElementById('f-earn-freq').value = data.earnings.frequency;
      }
    }
    statusEl.textContent = data.resolvedSymbol
      ? `✓ ISIN résolu en ${data.resolvedSymbol}. Données récupérées, vérifiez et complétez si besoin.`
      : '✓ Données récupérées. Vérifiez et complétez si besoin.';
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
  d.account = document.getElementById('f-account').value;

  const divAmount = parseFloat(document.getElementById('f-div-amount').value);
  d.dividend.lastAmount = isNaN(divAmount) ? null : divAmount;
  d.dividend.frequency = document.getElementById('f-div-freq').value;
  const divMonthVal = document.getElementById('f-div-month').value;
  d.dividend.anchorMonth = divMonthVal ? Number(divMonthVal) : null;
  const divDayVal = document.getElementById('f-div-day').value;
  d.dividend.payDay = divDayVal ? Number(divDayVal) : null;

  const earnMonthVal = document.getElementById('f-earn-month').value;
  d.earnings.anchorMonth = earnMonthVal ? Number(earnMonthVal) : null;
  d.earnings.frequency = document.getElementById('f-earn-freq').value;

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
        <span class="hint">${state.settings.apiKey ? `Clé actuellement enregistrée : ${state.settings.apiKey.length} caractères.` : 'Aucune clé enregistrée pour le moment.'}</span>
        <span class="hint">Clé gratuite disponible sur <a href="https://site.financialmodelingprep.com/developer/docs" target="_blank" rel="noopener">financialmodelingprep.com</a>. Sans clé, vous pouvez toujours saisir vos dividendes et résultats manuellement.</span>
      </div>
      <div class="field">
        <button class="btn btn-ghost btn-sm" id="testApiKeyBtn" type="button">Tester la clé maintenant</button>
        <span class="auto-fetch-status" id="testApiKeyStatus"></span>
      </div>
      <div class="field">
        <label>Adresse du relais Yahoo (actions européennes, gratuit)</label>
        <input type="text" id="f-relay" value="${escapeHtml(state.settings.relayUrl||'')}" placeholder="https://dividendes-relais.votre-nom.workers.dev" />
        <span class="hint">Utilisé quand FMP ne couvre pas un titre. Mode d'emploi : dossier <code>relay</code> du dépôt GitHub.</span>
        <button class="btn btn-ghost btn-sm" id="testRelayBtn" type="button" style="margin-top:6px;">Tester le relais</button>
        <span class="auto-fetch-status" id="testRelayStatus"></span>
      </div>
      <div class="section-title">Dates de versement (API)</div>
      <p class="notif-status" id="syncStatus">${state.settings.apiKey ? 'Les dates de paiement sont mises à jour automatiquement une fois par jour.' : 'Ajoutez votre clé API ci-dessus pour récupérer automatiquement les dates de paiement.'}</p>
      <div class="notif-actions"><button class="btn btn-ghost btn-sm" id="syncNowBtn" type="button">Actualiser les dates maintenant</button></div>
      <div class="section-title">Rappels de versement</div>
      <p class="notif-status" id="notifStatus">${escapeHtml(notifStatusText())}</p>
      <div class="notif-actions">
        <button class="btn btn-primary btn-sm" id="notifEnableBtn" type="button">Activer les rappels</button>
        <button class="btn btn-ghost btn-sm" id="notifTestBtn" type="button">Envoyer un test</button>
        <button class="btn btn-ghost btn-sm" id="icsBtn" type="button">Ajouter à l'agenda du téléphone (.ics)</button>
      </div>
      <p class="notif-status">Le résumé du mois arrive à la première ouverture de l'app chaque mois (et en arrière-plan sur Android si le navigateur l'autorise). Pour le recevoir même app fermée, importez le fichier .ics dans l'agenda du téléphone : un événement le 1er de chaque mois pendant 12 mois, alarme à 9 h.</p>
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
  document.getElementById('syncNowBtn').onclick = async ()=>{
    const st = document.getElementById('syncStatus');
    const key = cleanApiKey(document.getElementById('f-apikey').value);
    if(key && key !== state.settings.apiKey){ state.settings.apiKey = key; saveState(); }
    if(!state.settings.apiKey){ st.textContent = "Collez d'abord votre clé API."; return; }
    st.textContent = 'Mise à jour en cours…';
    const r = await autoSyncDates(true);
    if(!r) st.textContent = 'Mise à jour impossible (hors ligne ou déjà en cours).';
    else if(r.auth) st.textContent = 'Clé refusée par FMP (401/403).';
    else if(r.rate) st.textContent = `Quota API atteint (429) après ${r.ok} ligne(s). Réessayez demain.`;
    else st.textContent = `${r.ok} ligne(s) mise(s) à jour${r.fail?`, ${r.fail} sans données`:''}.`;
  };
  document.getElementById('notifEnableBtn').onclick = async ()=>{
    await enableNotifications();
    const st = document.getElementById('notifStatus'); if(st) st.textContent = notifStatusText();
  };
  document.getElementById('notifTestBtn').onclick = async ()=>{
    if(!notifSupported() || Notification.permission !== 'granted'){ toast('Activez d\'abord les rappels.'); return; }
    try{ await showLocalNotification({ title:'💰 Test — Calendrier Dividendes', body:'Les rappels fonctionnent sur cet appareil.', tag:'test' }); }
    catch(e){ toast('Échec de la notification de test.'); }
  };
  document.getElementById('icsBtn').onclick = downloadICS;
  document.getElementById('setCancel').onclick = closeModal;
  document.getElementById('setOverlay').addEventListener('click', (e)=>{ if(e.target.id==='setOverlay') closeModal(); });
  document.getElementById('setSave').onclick = ()=>{
    // On retire tous les espaces (y compris ceux collés par erreur au milieu),
    // les clés API ne contiennent jamais d'espace ni de saut de ligne.
    state.settings.apiKey = cleanApiKey(document.getElementById('f-apikey').value);
    state.settings.relayUrl = cleanRelayUrl(document.getElementById('f-relay').value);
    saveState();
    closeModal();
    toast('Paramètres enregistrés.');
  };
  document.getElementById('testRelayBtn').onclick = async ()=>{
    const statusEl = document.getElementById('testRelayStatus');
    const url = cleanRelayUrl(document.getElementById('f-relay').value);
    if(!url){ statusEl.textContent = "Collez une adresse commençant par https:// avant de tester."; statusEl.className = 'auto-fetch-status err'; return; }
    state.settings.relayUrl = url; saveState();
    statusEl.textContent = 'Test en cours…'; statusEl.className = 'auto-fetch-status';
    try{
      const d = await fetchYahooData('AI.PA');
      statusEl.textContent = `✓ Relais OK — ${d.name || 'AI.PA'} : ${d.dividend ? d.dividend.history.length + ' dividende(s) trouvé(s)' : 'aucun dividende'}.`;
      statusEl.className = 'auto-fetch-status ok';
    }catch(e){
      statusEl.textContent = '✗ ' + e.message; statusEl.className = 'auto-fetch-status err';
    }
  };
  document.getElementById('testApiKeyBtn').onclick = async ()=>{
    const statusEl = document.getElementById('testApiKeyStatus');
    const key = cleanApiKey(document.getElementById('f-apikey').value);
    if(!key){ statusEl.textContent = 'Collez une clé avant de tester.'; statusEl.className = 'auto-fetch-status err'; return; }
    statusEl.textContent = 'Test en cours…';
    statusEl.className = 'auto-fetch-status';
    try{
      const r = await fetch(`https://financialmodelingprep.com/stable/profile?symbol=AAPL&apikey=${key}`);
      const data = await r.json().catch(()=>null);
      if(r.status === 401 || r.status === 403){
        statusEl.textContent = `✗ Clé refusée par FMP (code ${r.status}). Vérifiez qu'elle est complète et que le plan est bien activé sur votre tableau de bord FMP.`;
        statusEl.className = 'auto-fetch-status err';
      }else if(r.status === 429){
        statusEl.textContent = '✗ Quota dépassé (429). La clé est valide, réessayez plus tard.';
        statusEl.className = 'auto-fetch-status err';
      }else if(data && data['Error Message']){
        statusEl.textContent = `✗ ${data['Error Message']}`;
        statusEl.className = 'auto-fetch-status err';
      }else if(Array.isArray(data) && data[0] && data[0].symbol){
        statusEl.textContent = `✓ Clé valide — réponse reçue pour ${data[0].symbol}.`;
        statusEl.className = 'auto-fetch-status ok';
      }else{
        statusEl.textContent = `Réponse inattendue (code ${r.status}) — voir la console (F12) pour le détail.`;
        statusEl.className = 'auto-fetch-status err';
        console.log('Réponse test clé API FMP :', data);
      }
    }catch(e){
      statusEl.textContent = "✗ Échec réseau (CORS ou connexion bloquée) — le navigateur n'a pas pu contacter financialmodelingprep.com.";
      statusEl.className = 'auto-fetch-status err';
    }
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
  renderTabs();
  renderToolbar();
  renderAccountSwitch();
  renderNotifBanner();
  renderUpcoming();
  renderCalendar();
  renderHoldingsList();
  renderSummary();
  renderStats();
}

function initEvents(){
  document.getElementById('addStockBtn').onclick = ()=> openStockModal(null);
  document.querySelectorAll('.tabbar [data-tab]').forEach(b=>{ b.addEventListener('click', ()=> setTab(b.dataset.tab)); });
  document.addEventListener('visibilitychange', ()=>{ if(document.visibilityState === 'visible') checkNotifications(); });
  document.getElementById('accountsBtn').onclick = openAccountsModal;
  document.getElementById('settingsBtn').onclick = openSettingsModal;

  document.querySelectorAll('#viewSwitch button').forEach(b=>{
    b.addEventListener('click', ()=>{ view.mode = b.dataset.mode; renderAll(); });
  });
  document.getElementById('prevBtn').onclick = ()=>{
    view.cursor = view.mode === 'month' ? addMonths(view.cursor, -1) : addMonths(view.cursor, -12);
    renderAll();
  };
  document.getElementById('nextBtn').onclick = ()=>{
    view.cursor = view.mode === 'month' ? addMonths(view.cursor, 1) : addMonths(view.cursor, 12);
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

  document.getElementById('brokerImportBtn').onclick = ()=> document.getElementById('brokerImportFile').click();
  document.getElementById('brokerImportFile').onchange = (e)=>{
    if(e.target.files[0]) handleBrokerFile(e.target.files[0]);
    e.target.value = '';
  };
  document.getElementById('bulkFetchBtn').onclick = runBulkAutoFetch;

  document.addEventListener('keydown', (e)=>{ if(e.key === 'Escape') closeModal(); });
}

initEvents();
renderAll();
ensureFxRates().then(()=> renderAll());
if('serviceWorker' in navigator && location.protocol.indexOf('http') === 0){
  navigator.serviceWorker.register('sw.js').then(()=>{ snapshotForWorker(); checkNotifications(); }).catch(()=>{});
}
setTimeout(()=> autoSyncDates(false), 1500);
document.addEventListener('visibilitychange', ()=>{ if(document.visibilityState === 'visible') autoSyncDates(false); });
