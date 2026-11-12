/* ==================================================================
   Suivi des dividendes — noyau : état, stockage, comptes, synchronisation,
   navigation. Les pages sont dans pages.js, les formulaires dans forms.js,
   les réglages dans settings.js.
   ================================================================== */

/* ---------------------------------------------------------------
   ÉTAT
   --------------------------------------------------------------- */
const CFG = (window.APP_CONFIG || {});

function defaultState() {
  return {
    v: 2,
    meta: { uid: null, remoteBase: 0, dirty: false, lastMarketUpdate: null },
    holdings: [], payments: [], transactions: [], archive: [],
    accounts: [{ id: 'main', name: 'Mon portefeuille' }],
    settings: { relayUrl: '', baseCurrency: 'EUR', incomeMode: 'gross', theme: 'auto', bg: 'aurore', autoLogos: true, tickerAuto: true, autoRefresh: true, notify: false, columns: {} },
    sent: { days: {}, months: {} }
  };
}
let state = defaultState();
let view = {
  page: 'home', account: 'all', tables: {},
  divTab: 'calendar', alloc: { basis: 'value' },
  cal: { mode: 'month', cursor: new Date(), asset: 'all', status: 'all' },
  hist: { tab: 'payments', year: 'all', month: 'all', asset: 'all', status: 'all' },
  port: { q: '', type: 'all', div: 'all', tab: 'positions' }, ops: { asset: 'all', type: 'all', from: '', to: '' },
  stats: { year: new Date().getFullYear() },
  home: { year: new Date().getFullYear(), period: 12, perfPeriod: 12 },
  sync: { state: 'local', msg: '', at: 0 }
};

function clone(o) { return JSON.parse(JSON.stringify(o)); }
function hasData(s) { return !!(s.holdings.length || s.payments.length || s.transactions.length || (s.archive && s.archive.length)); }

/* Migration de l'ancien format (v1) : aucune donnée n'est supprimée, sauf les
   résultats trimestriels (fonction abandonnée) et l'ancienne clé de l'API FMP. */
function migrateHolding(h) {
  h.id = h.id || uid();
  h.dividend = h.dividend || {};
  const d = h.dividend;
  if (!d.anchorMonth) {
    const last = d.lastPayDate || d.lastExDate || (d.history && d.history.length && (d.history[d.history.length - 1].payDate || d.history[d.history.length - 1].exDate));
    if (last) d.anchorMonth = Number(String(last).slice(5, 7)) || null;
  }
  if (d.frequency === 'none' && !d.lastAmount) { d.none = true; }
  if (!d.dateKind) d.dateKind = 'pay';
  // calendrier sur la date de PAIEMENT (ancien calendrier : mois de détachement) : converti d'après l'historique des détachements + délai
  if (d.dateKind === 'ex' && !d.none && Array.isArray(d.history) && d.history.length) { try { Market.deriveSchedule(h, todayISO()); } catch (e) { /* inchangé */ } }
  if (!h.type) h.type = 'stock';
  if (h.avgCost === undefined) h.avgCost = null;
  if (!h.isin && Market.isISIN(h.ticker)) h.isin = String(h.ticker).toUpperCase();
  h.currency = h.currency || 'EUR';
  h.quantity = Number(h.quantity) || 0;
  delete h.earnings; delete h.exchange; delete h.website;
  return h;
}
function hydrateState(parsed) {
  try {
    const base = defaultState(), p = parsed || {};
    const s = Object.assign(base, p);
    s.v = 2;
    s.meta = Object.assign(defaultState().meta, p.meta || {});
    s.settings = Object.assign(defaultState().settings, p.settings || {});
    delete s.settings.apiKey;                    // ancienne API supprimée
    if (!s.settings.relayUrl) s.settings.relayUrl = CFG.relayUrl || '';
    s.settings.columns = s.settings.columns || {};
    s.holdings = Array.isArray(s.holdings) ? s.holdings : [];
    s.payments = Array.isArray(s.payments) ? s.payments : [];
    s.transactions = Array.isArray(s.transactions) ? s.transactions : [];
    s.corp = Array.isArray(s.corp) ? s.corp : []; s.imports = Array.isArray(s.imports) ? s.imports : []; if (!s.isinAlias || typeof s.isinAlias !== 'object') s.isinAlias = {}; if (!s.ignored || typeof s.ignored !== 'object' || Array.isArray(s.ignored)) s.ignored = {};
    s.archive = Array.isArray(s.archive) ? s.archive : [];  if (!s.notices || typeof s.notices !== 'object') s.notices = { handled: {} }; if (!s.notices.handled || typeof s.notices.handled !== 'object') s.notices.handled = {}; s.estimates = Array.isArray(s.estimates) ? s.estimates : []; s.migrations = Array.isArray(s.migrations) ? s.migrations : []; s.dividendImports = Array.isArray(s.dividendImports) ? s.dividendImports : [];            // positions entièrement vendues (leurs opérations restent dans l'historique)
    if (!s.undo || typeof s.undo !== 'object') delete s.undo;
    if (!Array.isArray(s.accounts) || !s.accounts.length) s.accounts = defaultState().accounts;
    s.holdings.forEach((h) => { if (!h.account || !s.accounts.some((a) => a.id === h.account)) h.account = s.accounts[0].id; migrateHolding(h); if (h.source === 'degiro' && h.derived === undefined) h.derived = true; });   // positions calculées par l'import d'historique
    s.sent = s.sent || { days: {}, months: {} };
    return s;
  } catch (e) { return defaultState(); }
}

/* Enregistrement : local (localStorage + IndexedDB, chiffré si code) puis cloud (différé). */
function saveState(o) {
  o = o || {};
  if (!o.remote) { state.meta.dirty = true; state.meta.localAt = Date.now(); }
  Vault.write(JSON.stringify(state));
  if (!o.remote) scheduleSync();
  snapshotForWorker();
}
function snapshotForWorker() {
  try {
    if (!('caches' in window)) return;
    if (Vault.hasPin()) { caches.open('dividendes-data').then((c) => c.delete('state.json')); return; }
    caches.open('dividendes-data').then((c) => c.put('state.json', new Response(JSON.stringify({
      holdings: state.holdings, settings: { notify: !!state.settings.notify }, sent: state.sent
    }))));
  } catch (e) { /* silencieux */ }
}

/* ---------------------------------------------------------------
   DEVISES (taux BCE via Frankfurter, sans clé, en cache 1 jour)
   --------------------------------------------------------------- */
let fx = { rates: null, date: null };
let fxPrev = { rates: null, date: null };          // taux de la séance précédente (effet de change de la variation journalière)
const fxPrevRate = (cur) => { if (!cur || cur === 'EUR') return 1; return (fxPrev.rates || {})[cur] || null; };
async function ensureFxPrev() {
  try {
    if (!fx.date) return;
    const raw = localStorage.getItem('fxPrev_v1'); if (raw) { const c = JSON.parse(raw); if (c.for === fx.date && c.rates) { fxPrev = { rates: c.rates, date: c.date }; return; } }
    const d = new Date(fx.date + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() - 1);
    const r = await fetch('https://api.frankfurter.dev/v1/' + d.toISOString().slice(0, 10) + '?base=EUR'); if (!r.ok) return;
    const j = await r.json(); if (!j || !j.rates || !(j.date < fx.date)) return;
    fxPrev = { rates: Object.assign({ EUR: 1 }, j.rates), date: j.date }; localStorage.setItem('fxPrev_v1', JSON.stringify({ for: fx.date, date: j.date, rates: fxPrev.rates })); renderPageSoft();
  } catch (e) { /* sans taux de la veille : variation calculée au taux actuel */ }
}
async function ensureFx() {
  try {
    const raw = localStorage.getItem('fxRatesCache_v2');
    if (raw) { const c = JSON.parse(raw); if (c.day === todayISO()) { fx = { rates: c.rates, date: c.date }; ensureFxPrev(); return; } if (c.rates) fx = { rates: c.rates, date: c.date }; }
    const r = await fetch('https://api.frankfurter.dev/v1/latest?base=EUR');
    if (!r.ok) return;
    const d = await r.json();
    if (d && d.rates) { fx = { rates: Object.assign({ EUR: 1 }, d.rates), date: d.date }; localStorage.setItem('fxRatesCache_v2', JSON.stringify({ day: todayISO(), date: d.date, rates: fx.rates })); renderPageSoft(); ensureFxPrev(); }
  } catch (e) { /* les totaux restent affichés dans leur devise d'origine si possible */ }
}
/* Taux de change HISTORIQUES (fin de chaque mois), pour valoriser le passé au bon taux. Une seule requête
   (Frankfurter, données BCE) mise en cache pour la journée ; sans réseau on retombe sur le taux actuel. */
let fxHist = null;
async function ensureFxHistory() {
  try {
    const arch = state.archive || [];
    const curs = Array.from(new Set(state.holdings.flatMap((h) => [h.currency, Engine.costCur(h)]).concat(arch.map((x) => x.currency), state.transactions.map((t) => t.acctCur), [baseCur()]))).filter((c) => c && c !== 'EUR').sort();
    if (!curs.length) { fxHist = {}; return; }
    let from = state.holdings.concat(arch).reduce((m, h) => (h.hist && h.hist.from < m ? h.hist.from : m), Engine.addYM(Engine.ymOf(new Date()), -60));
    const firstTx = state.transactions.reduce((m, t) => (t.date && t.date.slice(0, 7) < m ? t.date.slice(0, 7) : m), '9999-99'); if (firstTx < from) from = firstTx;
    from += '-01';
    const raw = localStorage.getItem('fxHist_v1');
    if (raw) { const c = JSON.parse(raw); if (c.day === todayISO() && c.from <= from && curs.every((x) => c.curs.indexOf(x) >= 0)) { fxHist = c.rates; return; } }
    const r = await fetch('https://api.frankfurter.dev/v1/' + from + '..' + todayISO() + '?base=EUR&symbols=' + curs.join(','));
    if (!r.ok) return;
    const d = await r.json(), out = {};
    Object.keys(d.rates || {}).sort().forEach((day) => { Object.keys(d.rates[day]).forEach((c) => { (out[c] = out[c] || {})[day.slice(0, 7)] = d.rates[day][c]; }); });   // le dernier jour du mois l'emporte
    fxHist = out;
    localStorage.setItem('fxHist_v1', JSON.stringify({ day: todayISO(), from, curs, rates: out }));
    renderPageSoft();
  } catch (e) { /* silencieux : taux actuel utilisé à la place */ }
}
function rateAt(cur, ym) {
  if (!cur || cur === 'EUR') return 1;
  const m = fxHist && fxHist[cur];
  if (m) {
    if (m[ym]) return m[ym];
    let best = null; Object.keys(m).sort().forEach((k) => { if (k <= ym) best = m[k]; });
    if (best) return best; const ks = Object.keys(m).sort(); if (ks.length) return m[ks[0]];
  }
  return fxNow(cur);
}
/* Montant dans sa devise → devise de base, au taux de fin de mois ym. */
function convertAt(amount, cur, ym) {
  const a = rateAt(cur, ym), b = rateAt(baseCur(), ym);
  return a && b ? amount / a * b : null;
}
const baseCur = () => state.settings.baseCurrency || 'EUR';
/* Taux du jour (1 EUR = x devise) : officiel (BCE) d'abord ; à défaut, taux saisi à la main ; sinon null (jamais de faux chiffre). */
function fxNow(cur) { if (!cur || cur === 'EUR') return 1; return (fx.rates || {})[cur] || ((state.settings || {}).fxManual || {})[cur] || null; }
/* Convertit vers la devise de base ; null si le taux est indisponible (jamais de faux chiffre). */
function convert(amount, cur) {
  const b = baseCur();
  if (!cur || cur === b) return amount;
  const rc = fxNow(cur), rb = fxNow(b);
  return rc && rb ? amount / rc * rb : null;
}

/* ---------------------------------------------------------------
   FILTRES GLOBAUX
   --------------------------------------------------------------- */
function visibleHoldings() { return view.account === 'all' ? state.holdings : state.holdings.filter((h) => h.account === view.account); }
function visibleIds() { return view.account === 'all' ? null : new Set(visibleHoldings().map((h) => h.id).concat((state.archive || []).filter((x) => x.account === view.account).map((x) => x.id))); }
function accountName(id) { const a = state.accounts.find((x) => x.id === id); return a ? a.name : '—'; }
const incomeMode = () => state.settings.incomeMode === 'net' ? 'net' : 'gross';

/* ---------------------------------------------------------------
   DONNÉES DE MARCHÉ (relais Yahoo)
   --------------------------------------------------------------- */
const market = Market.makeClient({ getRelay: () => state.settings.relayUrl });
let refreshing = false, refreshCancel = false;

async function refreshMarket(list, o) {
  o = o || {};
  if (refreshing) { toast('Une actualisation est déjà en cours.'); return null; }
  if (!state.settings.relayUrl) { if (!o.silent) toast('Aucun relais de données configuré (Paramètres → Données de marché).', { error: true }); return null; }
  list = list || state.holdings;
  if (!list.length) { if (!o.silent) toast('Aucun actif à actualiser.'); return null; }
  refreshing = true; refreshCancel = false;
  let modal = null;
  if (!o.silent) {
    modal = openModal('<h2>Actualisation des données</h2><div class="sub" id="rfMsg">Préparation…</div><div class="progress"><i id="rfBar"></i></div>' +
      '<div class="modal-actions"><span></span><button class="btn" type="button" id="rfStop">Arrêter</button></div>', { sticky: true });
    $('#rfStop', modal).onclick = () => { refreshCancel = true; };
  }
  const nowISO = todayISO();
  const res = await Market.refreshMany(market, list, nowISO, {
    cancelled: () => refreshCancel, quick: !!o.quick,
    progress: (i, n, h) => { if (modal) { const m = $('#rfMsg'), b = $('#rfBar'); if (m) m.textContent = i + ' / ' + n + ' — ' + (h.displayTicker || h.ticker); if (b) b.style.width = (100 * i / n) + '%'; } }
  });
  // positions entièrement vendues : leurs cours passés servent à reconstituer la courbe de valeur
  let ares = null;
  if (!refreshCancel && !res.stopped && (list === state.holdings || list.length === visibleHoldings().length)) {
    const accs = new Set(list.map((h) => h.account)), arch = (state.archive || []).filter((x) => accs.has(x.account) && !x.statementOnly && x.listing !== 'delisted' && !x.marketOff && (o.quick ? (!x.hist && !(x.listingSuspect && x.listingSuspect.at === nowISO)) : (!x.hist || x.marketAt !== nowISO)));      // légère : positions clôturées seulement si leur historique manque
    if (arch.length) { const mm = modal && $('#rfMsg'); if (mm) mm.textContent = 'Positions clôturées (' + arch.length + ')…'; ares = await refreshArchive(arch, nowISO); }
  }
  refreshing = false;
  updateMarketNotices(res);
  (res.started || []).forEach((s) => Notify.push({ level: 'info', title: s.name + ' commence à verser un dividende', body: 'Premier dividende connu : <b>' + esc(fmtNum(s.amount, 4)) + ' ' + esc(s.currency) + '</b> par titre (détachement le ' + esc(fmtDate(s.ex)) + '). La position est désormais marquée « verse un dividende » et entre dans les prévisions et le calendrier. Pour les versements déjà passés, lancez l\'analyse des dividendes.', accept: { label: 'Analyser cette position', run: () => runDividendAnalysis({ ids: new Set([s.id]) }), ack: false } }));
  if (res.ok || (ares && ares.ok)) { Dividends.learnPayLags(state, Market, nowISO); state.meta.lastMarketUpdate = Date.now(); saveState(); ensureFxHistory(); }   // rien à enregistrer (ni à synchroniser) si tout a échoué
  if (modal) closeModal();
  if (!o.silent) renderPage(); else if (res.ok) renderPageSoft();
  if (!o.silent) {
    const parts = [res.ok + ' actif(s) mis à jour'];
    if (ares && (ares.ok || ares.fail)) parts.push(ares.ok + ' position(s) clôturée(s)' + (ares.fail ? ' (' + ares.fail + ' sans cours)' : ''));
    if (res.fail) parts.push(res.fail + ' échec(s)' + (res.errors[0] ? ' — ' + res.errors[0].message : ''));
    toast(parts.join(', ') + '.', { error: !!res.fail && !res.ok, ms: 6000 });
  }
  return res;
}
/* Notifications d'actualisation, recalculées depuis l'ÉTAT des actifs (une correction les fait donc disparaître) :
   une par société probablement plus cotée (avec l'option « Marquer comme plus cotée »), une pour les autres échecs. */
function updateMarketNotices(res) {
  Notify.set('relay', market.relayVersion() === null ? [{ id: 'relay:cache', level: 'warn', title: 'Relais de données à mettre à jour : cours en retard possible', body: 'Votre relais Cloudflare garde les cours en mémoire <b>6 heures</b> : même après actualisation, un prix peut avoir plusieurs heures de retard (et la plus-value du jour s\'en écarte). La nouvelle version rafraîchit les cours toutes les minutes.', accept: { label: 'Comment faire ?', run: () => openRelayUpdateHelp(), ack: false } }] : []);
  const out = [], live = state.holdings.concat((state.archive || []).filter((x) => !x.statementOnly)).filter((h) => h.listing !== 'delisted' && !h.marketOff);
  const nm = (h) => h.name || h.displayTicker || h.ticker;
  const susp = live.filter((h) => h.listingSuspect);
  if (susp.length > 5) {
    out.push({ id: 'mkt:bulk', level: 'warn', title: susp.length + ' positions probablement plus cotées en bourse', body: 'Yahoo Finance ne trouve plus ces titres (radiation, liquidation, rachat…). Vous pouvez : <b>exporter la liste en PDF</b> pour la faire vérifier (dates de radiation), puis <b>importer le fichier de résultats</b> ; ou tout marquer « plus cotées » d\'un coup. Rien n\'est supprimé : achats, ventes et dividendes restent enregistrés.',
      accept: { label: 'Ouvrir la liste…', run: () => openFailingHoldings(), ack: false }, more: [{ label: 'Exporter la liste (PDF)', run: () => exportDelistPdf() }, { label: 'Importer les dates de radiation…', run: () => importDelistFile() }, { label: 'Copier la liste (texte)', run: () => copyDelistText() }, { label: 'Tout marquer plus cotées…', run: () => markAllDelisted() }] });
  }
  (susp.length > 5 ? [] : susp).forEach((h) => {
    const s = h.listingSuspect, days = s.since ? Math.round((Date.now() - Date.parse(s.since)) / 86400000) : null;
    const why = s.kind === 'stale' ? 'Dernière cotation le ' + esc(fmtDate(s.since)) + (days ? ' (il y a ' + days + ' jours)' : '') + ' : cotation arrêtée ou suspendue.' : esc(s.msg || 'Yahoo Finance ne connaît plus ce titre.');
    out.push({ id: 'mkt:delist:' + h.id, level: 'warn', title: nm(h) + ' — probablement plus cotée en bourse', body: why + ' Si la société a été radiée, liquidée ou rachetée, marquez-la « plus cotée » : l\'actualisation s\'arrête pour ce titre et l\'erreur ne revient plus. Si le symbole est simplement faux, corrigez-le.',
      accept: { label: 'Marquer comme plus cotée', run: () => openDelistModal(h.id), ack: false }, more: [{ label: 'Corriger le symbole / l\'ISIN…', run: () => openInstrumentFix(h.id) }], edit: { label: 'Ouvrir la fiche', run: () => openInstrumentFix(h.id) } });
  });
  const stale = state.holdings.filter((h) => h.marketOff && Number(h.quantity) > 0 && (!h.priceAt || (Date.now() - Date.parse(String(h.priceAt).slice(0, 10))) > 30 * 86400000));
  if (stale.length) out.push({ id: 'mkt:manual', level: 'warn', title: 'Cours saisi à la main à mettre à jour (' + stale.length + ')', body: stale.slice(0, 4).map((h) => '<b>' + esc(nm(h)) + '</b> : ' + (h.priceAt ? 'cours du ' + esc(fmtDate(String(h.priceAt).slice(0, 10))) : 'aucun cours saisi')).join('<br>') + (stale.length > 4 ? '<br>…' : '') + '<br>Ces titres ne sont pas actualisés automatiquement : ressaisissez leur cours pour que la valeur et les plus-values restent justes.',
    accept: { label: 'Saisir le cours…', run: () => setMarketOff(stale[0].id), ack: false }, more: stale.slice(1, 4).map((h) => ({ label: nm(h) + '…', run: () => setMarketOff(h.id) })) });
  const other = live.filter((h) => h.marketError && !h.listingSuspect);
  if (other.length) out.push({ id: 'market:fail', level: 'warn', title: 'Actualisation incomplète', body: other.length + ' actif(s) non actualisé(s) : ' + other.slice(0, 3).map((h) => esc(nm(h)) + ' (' + esc(h.marketError) + ')').join(' ; ') + (other.length > 3 ? ' …' : '') + '. Les dernières données connues sont conservées. <b>Si ce titre n\'existe pas chez Yahoo</b> (fonds, ligne technique du courtier, petite valeur non cotée en continu), choisissez « Ne plus actualiser » : vous saisissez son cours à la main et l\'erreur disparaît.',
    accept: { label: 'Réessayer', run: () => runFullRefresh('button'), ack: false }, edit: { label: 'Corriger les actifs…', run: () => openFailingHoldings() } });
  Notify.set('market', out);
}
async function refreshArchive(entries, nowISO) {
  const out = { ok: 0, fail: 0 };
  for (let i = 0; i < entries.length; i++) {
    const a = entries[i];
    try { const f = await market.fetchAsset(a.ticker || a.isin, a.name, { needSector: false }); Market.applyToArchive(a, f, nowISO); out.ok++; }
    catch (e) { a.marketError = e.message; out.fail++; if (e.delisted || e.notFound) a.listingSuspect = { kind: e.delisted ? 'delisted' : 'notfound', at: nowISO, msg: e.message }; if (e.rate || e.fatal) break; }
    await new Promise((r) => setTimeout(r, 150));
  }
  return out;
}
const REFRESH_EVERY_H = 12;      // actualisation automatique : deux fois par jour au plus (à l'ouverture et au retour au premier plan)
function staleMarket() { const t = state.meta.lastMarketUpdate; return !t || Date.now() - t > REFRESH_EVERY_H * 3600 * 1000; }
let lastAutoTry = 0;
/* Une fois par mois (par appareil) : recherche automatique des dividendes de toutes les positions (société qui commence à verser, nouveaux versements dus, baisses, interruptions). Résultat dans la cloche. */
const DIV_ANALYSIS_EVERY_DAYS = 30;
function autoDivAnalysisIfDue() {
  const last = Number(state.meta.lastDivAnalysisAt) || 0;
  if ((navigator.webdriver && !window.__divAutoTest) || !state.settings.relayUrl || !navigator.onLine || !state.holdings.length || Date.now() - last < DIV_ANALYSIS_EVERY_DAYS * 86400000 || (typeof lastDivAutoTry !== 'undefined' && Date.now() - lastDivAutoTry < 3600000)) return;
  lastDivAutoTry = Date.now();
  runDividendAnalysis({ auto: true, ids: null }).then(() => { state.meta.lastDivAnalysisAt = Date.now(); saveState(); }).catch((e) => console.error(e));
}
let lastDivAutoTry = 0;
function autoRefreshIfStale() {
  if (!state.settings.autoRefresh || !state.settings.relayUrl || !state.holdings.length || refreshing || !navigator.onLine || !staleMarket() || Date.now() - lastAutoTry < 10 * 60 * 1000) return;
  lastAutoTry = Date.now(); refreshMarket(null, { silent: true, quick: true });
}
/* Délais « détachement → paiement » appris des versements réels (sert au calendrier) : à rappeler après un import, une saisie ou une actualisation. */
function refreshPayLags() { try { if (Dividends.learnPayLags(state, Market, todayISO())) saveState(); } catch (e) { console.error(e); } }

/* ---------------------------------------------------------------
   SYNCHRONISATION CLOUD
   --------------------------------------------------------------- */
let syncTimer = null, syncing = false, syncQueued = false;
function setSync(st, msg) { view.sync = { state: st, msg: msg || '', at: Date.now() }; renderSyncChip(); Notify.set('sync', st === 'err' ? [{ id: 'sync:err', level: 'error', title: 'Synchronisation en erreur', body: esc(msg || 'La synchronisation a échoué.'), accept: { label: 'Réessayer', run: () => { try { pullIfChanged(); } catch (e) { /* ignoré */ } }, ack: false } }] : []); }

/* Version envoyée au compte : sans données de marché (chaque appareil actualise les siennes), sans annulation locale. */
function cloudPayload() {
  const c = Sync.slim(state);
  c.meta = { uid: state.meta.uid };
  return c;
}
const withoutMeta = (p) => { const x = clone(p); delete x.meta; return x; };
function scheduleSync() {
  if (!Cloud.user()) return;
  clearTimeout(syncTimer);
  setSync('syncing', 'Modifications en attente…');
  syncTimer = setTimeout(syncNow, 1800);
}

/* Fusion AUTOMATIQUE avec la version du compte (aucune question) :
   - déjà synchronisé une fois (base connue) : fusion élément par élément, ajouts / suppressions / modifications de chaque appareil (Sync.merge3) ;
   - premier échange avec des données des deux côtés : union sans doublon (mergeStates). */
function mergeWithRemote(remote) {
  const base = state.meta.syncBase || null, localSlim = Sync.slim(state), pl = (state.meta.localAt || 0) >= (remote.updatedAt || 0);
  let m;
  if (base) m = Sync.merge3(base, localSlim, remote.state, pl);
  else if (hasData(state)) m = mergeStates(state, remote.state);
  else m = clone(remote.state);
  const baseIds = new Set([].concat(base ? (base.holdings || []).concat(base.archive || []) : []).map((h) => h.id));
  m = Sync.dedupe(m, baseIds).merged; Sync.reattach(m, state);
  m.meta = clone(state.meta); if (state.undo) m.undo = state.undo;
  const full = hydrateState(m); full.meta = Object.assign({}, state.meta);
  return { full, slim: withoutMeta(Object.assign(Sync.slim(full), { meta: {} })), localSlim };
}
/* Applique un résultat de fusion à l'état local, sans perdre ce qui a été modifié ici pendant l'échange avec le compte. */
function adoptMerged(res, remoteAt, uidv, stamp) {
  let next = res.full;
  if ((state.meta.localAt || 0) !== stamp) {                  // modifié pendant l'échange : on rejoue ces modifications par-dessus la version fusionnée
    const again = Sync.merge3(res.localSlim, Sync.slim(state), res.slim, true);
    Sync.reattach(again, state); again.meta = clone(state.meta); if (state.undo) again.undo = state.undo; next = hydrateState(again); next.meta = Object.assign({}, state.meta);
    next.meta.dirty = true;
  } else next.meta.dirty = false;
  state = next; state.meta.uid = uidv; state.meta.remoteBase = remoteAt; state.meta.syncBase = res.slim;
  saveState({ remote: true }); if (state.meta.dirty) scheduleSync();
}
async function syncNow() {
  const u = Cloud.user(); if (!u) return false;
  if (syncing) { syncQueued = true; return false; }
  if (!navigator.onLine) { setSync('offline', 'Hors-ligne : synchronisation à la reconnexion.'); return false; }
  syncing = true; setSync('syncing', 'Synchronisation…');
  try {
    for (let tries = 0; tries < 4; tries++) {
      const stamp = state.meta.localAt || 0, v = await Cloud.remoteVersion();
      if (v === state.meta.remoteBase) {                      // rien de nouveau dans le compte : envoi direct des modifications de cet appareil
        const payload = cloudPayload(), r = await Cloud.push(payload, v).catch((e) => { if (e.conflict) return null; throw e; });
        if (!r) continue;
        state.meta.uid = u.uid; state.meta.remoteBase = r.updatedAt; state.meta.syncBase = withoutMeta(payload); state.meta.dirty = (state.meta.localAt || 0) !== stamp;
        saveState({ remote: true }); if (state.meta.dirty) scheduleSync(); else setSync('ok', 'Synchronisé');
        return true;
      }
      const remote = await Cloud.fetchRemote();
      if (!remote.exists || !remote.state) {                  // compte vide : on y envoie simplement cet appareil
        const payload = cloudPayload(), r = await Cloud.push(payload, remote.updatedAt || 0).catch((e) => { if (e.conflict) return null; throw e; });
        if (!r) continue;
        state.meta.uid = u.uid; state.meta.remoteBase = r.updatedAt; state.meta.syncBase = withoutMeta(payload); state.meta.dirty = false; saveState({ remote: true }); setSync('ok', 'Synchronisé'); return true;
      }
      const res = mergeWithRemote(remote), payload = Object.assign(clone(res.slim), { meta: { uid: u.uid } });
      const r = await Cloud.push(payload, remote.updatedAt).catch((e) => { if (e.conflict) return null; throw e; });
      if (!r) continue;                                       // le compte a encore changé pendant la fusion : on recommence
      adoptMerged(res, r.updatedAt, u.uid, stamp); renderPageSoft(); setSync('ok', 'Synchronisé');
      return true;
    }
    setSync('err', 'Synchronisation retardée : le compte change sans cesse, nouvel essai bientôt.'); setTimeout(() => scheduleSync(), 8000);
    return false;
  } catch (e) {
    setSync('err', Cloud.friendly(e));
    return false;
  } finally {
    syncing = false;
    if (syncQueued) { syncQueued = false; if (state.meta.dirty) scheduleSync(); }
  }
}
/* Le compte a changé (autre appareil) : on reprend ses ajouts, suppressions et modifications automatiquement ; vos propres modifications non envoyées sont conservées. */
async function pullIfChanged() {
  const u = Cloud.user(); if (!u || syncing || !navigator.onLine) return;
  try {
    const v = await Cloud.remoteVersion();
    if (v === state.meta.remoteBase) { if (state.meta.dirty) scheduleSync(); return; }
    if (state.meta.dirty) { await syncNow(); return; }
    syncing = true;
    try {
      const stamp = state.meta.localAt || 0, remote = await Cloud.fetchRemote();
      if (!remote.exists || !remote.state) return;
      const before = Sync.st(Sync.slim(state)), res = mergeWithRemote(remote);
      adoptMerged(res, remote.updatedAt, u.uid, stamp); renderPageSoft(); setSync('ok', 'Synchronisé');
      if (Sync.st(res.slim) !== before) toast('Mis à jour avec les modifications de votre autre appareil.');
    } finally { syncing = false; }
  } catch (e) { setSync('err', Cloud.friendly(e)); }
}

/* Fusion de deux appareils : ajoute à la version cloud ce qui n'y est pas encore (ni écrasement, ni doublon, rien de perdu).
   - positions détenues ET clôturées rapprochées par compte + ISIN (ou ticker / nom) ;
   - versements et opérations : identifiant d'import stable d'abord, sinon rapprochement « en multi-ensemble » (même position, date, devise, montant) : deux versements
     légitimes identiques sur un appareil restent deux, mais un versement importé séparément sur les deux appareils n'est compté qu'une fois. */
function mergeStates(local, remote) {
  const out = clone(remote), cents = (v) => Math.round((Number(v) || 0) * 100);
  ['holdings', 'archive', 'payments', 'transactions', 'estimates', 'migrations', 'imports', 'dividendImports', 'corp'].forEach((k) => { out[k] = Array.isArray(out[k]) ? out[k] : []; });
  const accMap = {}, byName = new Map(out.accounts.map((a) => [a.name.trim().toLowerCase(), a.id]));
  local.accounts.forEach((a) => {
    if (out.accounts.some((x) => x.id === a.id)) { accMap[a.id] = a.id; return; }
    const same = byName.get(a.name.trim().toLowerCase());
    if (same) { accMap[a.id] = same; return; }
    out.accounts.push(clone(a)); accMap[a.id] = a.id;
  });
  const hkey = (h) => h.account + '|' + String(h.isin || h.ticker || h.name || '').toUpperCase();
  const have = new Map(out.holdings.concat(out.archive).map((h) => [hkey(h), h]));
  const idMap = {};
  const addInst = (list, h) => {
    const lh = clone(h); lh.account = accMap[lh.account] || lh.account;
    const ex = have.get(hkey(lh)) || out.holdings.concat(out.archive).find((x) => x.id === lh.id);
    if (ex) { idMap[h.id] = ex.id; return; }
    list.push(lh); have.set(hkey(lh), lh); idMap[h.id] = lh.id;
  };
  (local.holdings || []).forEach((h) => addInst(out.holdings, h));
  (local.archive || []).forEach((h) => addInst(out.archive, h));
  const bag = (list, keyOf) => { const m = new Map(); list.forEach((x) => { const k = keyOf(x); m.set(k, (m.get(k) || 0) + 1); }); return m; };
  const pkey = (p) => [p.holdingId, p.payDate || p.exDate || '', p.currency || '', cents(p.gross), p.source === 'auto' || p.estimated ? 'est' : 'reel'].join('|');
  const payBag = bag(out.payments, pkey), payExt = new Set(out.payments.map((x) => x.extId).filter(Boolean)), payIds = new Set(out.payments.map((x) => x.id));
  (local.payments || []).forEach((p) => {
    const lp = clone(p); lp.holdingId = idMap[lp.holdingId] || lp.holdingId;
    if (payIds.has(lp.id) || (lp.extId && payExt.has(lp.extId))) return;
    const k = pkey(lp), n = payBag.get(k) || 0; if (n > 0) { payBag.set(k, n - 1); return; }
    out.payments.push(lp);
  });
  const tkey = (t) => [t.holdingId, t.date || '', t.type, Number(t.qty) || 0, t.price == null ? '' : Number(t.price)].join('|');
  const txBag = bag(out.transactions, tkey), txExt = new Set(out.transactions.map((x) => x.extId).filter(Boolean)), txIds = new Set(out.transactions.map((x) => x.id));
  (local.transactions || []).forEach((t) => {
    const lt = clone(t); lt.holdingId = idMap[lt.holdingId] || lt.holdingId;
    if (txIds.has(lt.id) || (lt.extId && txExt.has(lt.extId))) return;
    const k = tkey(lt), n = txBag.get(k) || 0; if (n > 0) { txBag.set(k, n - 1); return; }
    out.transactions.push(lt);
  });
  // estimations rangées, opérations sur titres, journaux : réunis sans doublon d'identifiant
  const union = (k, idOf) => { const ids = new Set(out[k].map(idOf)); (local[k] || []).forEach((x) => { if (!ids.has(idOf(x))) out[k].push(clone(x)); }); };
  union('estimates', (x) => x.id); union('dividendImports', (x) => x.id); union('imports', (x) => x.id); union('corp', (x) => [x.isin, x.date, x.kind, x.ratio].join('|'));
  const hand = Object.assign({}, (local.notices || {}).handled || {}, (out.notices || {}).handled || {}); out.notices = { handled: hand };
  out.isinAlias = Object.assign({}, local.isinAlias || {}, out.isinAlias || {});
  out.settings = Object.assign({}, local.settings, out.settings);
  out.settings.columns = Object.assign({}, local.settings.columns || {}, out.settings.columns || {});
  return out;
}

/* Après connexion : récupère / envoie les données sans jamais en perdre. */
async function afterLogin(user) {
  // Appareil déjà connu : on affiche tout de suite les données locales, la synchronisation se fait en arrière-plan.
  if (state.meta.uid === user.uid && hasData(state) && !$('#authRoot').classList.contains('on')) {
    startApp(); setSync('syncing', 'Synchronisation…');
    try { await syncNow(); } catch (e) { setSync('err', Cloud.friendly(e)); }
    return;
  }
  showAuthBusy('Synchronisation de vos données…');
  try {
    if (state.meta.uid && state.meta.uid !== user.uid) { state = defaultState(); state.settings.relayUrl = CFG.relayUrl || ''; }   // données d'un autre compte : jamais mélangées
    const remote = await Cloud.fetchRemote();
    if (!remote.exists || !remote.state) {                    // compte vide : il reçoit les données de cet appareil
      state.meta.uid = user.uid; state.meta.remoteBase = 0;
      const had = hasData(state), payload = cloudPayload();
      const r = await Cloud.push(payload, remote.updatedAt || 0);
      state.meta.remoteBase = r.updatedAt; state.meta.syncBase = withoutMeta(payload); state.meta.dirty = false; saveState({ remote: true });
      hideAuth(); startApp();
      if (had) toast('Vos données locales ont été enregistrées dans votre compte.');
      setSync('ok', 'Synchronisé');
      return;
    }
    const hadLocal = hasData(state);
    // appareil vide, ou premier branchement avec des données des deux côtés : fusion automatique, sans question (ajouts de chaque côté réunis, sans doublon)
    const stamp = state.meta.localAt || 0, res = mergeWithRemote(remote), payload = Object.assign(clone(res.slim), { meta: { uid: user.uid } });
    const r = hadLocal ? await Cloud.push(payload, remote.updatedAt) : { updatedAt: remote.updatedAt };
    adoptMerged(res, r.updatedAt, user.uid, stamp);
    hideAuth(); startApp(); setSync('ok', 'Synchronisé');
    if (hadLocal) toast('Données de cet appareil et de votre compte réunies automatiquement.', { ms: 6000 });
    if (!hadLocal || state.meta.dirty) autoRefreshIfStale();
  } catch (e) {
    hideAuth(); startApp();
    setSync('err', Cloud.friendly(e)); toast(Cloud.friendly(e), { error: true });
  }
}

async function doLogout() {
  clearTimeout(syncTimer);
  if (state.meta.dirty) {
    const ok = await syncNow();
    if (!ok && state.meta.dirty) {
      const c = await confirmDialog({ title: 'Modifications non synchronisées', body: "Certaines modifications n'ont pas pu être envoyées à votre compte. Se déconnecter les supprimera de cet appareil. Exportez d'abord une sauvegarde si besoin.", confirmLabel: 'Se déconnecter quand même', danger: true });
      if (!c.ok) return;
    }
  }
  try { await Cloud.signOut(); } catch (e) { /* ignoré */ }
  state = defaultState(); state.settings.relayUrl = CFG.relayUrl || '';
  Vault.write(JSON.stringify(state));
  localStorage.removeItem('dca_guest');
  setSync('local', '');
  showAuth();
}

/* ---------------------------------------------------------------
   ÉCRAN DE CONNEXION
   --------------------------------------------------------------- */
function showAuthBusy(msg) {
  const r = $('#authRoot'); r.classList.add('on');
  r.innerHTML = '<div class="card card-pad auth-card"><div class="brand"><img src="logo.svg" alt="">StockPilot</div><p class="tag">' + esc(msg) + '</p><div class="progress"><i style="width:60%"></i></div></div>';
}
function hideAuth() { const r = $('#authRoot'); r.classList.remove('on'); r.innerHTML = ''; }
function showAuth(mode) {
  mode = mode || 'in';
  const r = $('#authRoot'); r.classList.add('on');
  const configured = Cloud.configured();
  r.innerHTML = '<div class="card card-pad auth-card"><div class="brand"><img src="logo.svg" alt="">StockPilot</div>' +
    '<p class="tag">Suivez vos dividendes et retrouvez vos données sur tous vos appareils.</p>' +
    (configured ? '<div class="auth-tabs"><div class="seg"><button type="button" data-m="in" class="' + (mode === 'in' ? 'on' : '') + '">Connexion</button><button type="button" data-m="up" class="' + (mode === 'up' ? 'on' : '') + '">Créer un compte</button></div></div>' +
      '<form id="authForm" novalidate>' +
      '<div class="field"><label for="aEmail">Adresse e-mail</label><input id="aEmail" type="email" autocomplete="email" inputmode="email" required></div>' +
      '<div class="field"><label for="aPwd">Mot de passe</label><input id="aPwd" type="password" autocomplete="' + (mode === 'up' ? 'new-password' : 'current-password') + '" required>' + (mode === 'up' ? '<span class="hint">8 caractères minimum.</span>' : '') + '</div>' +
      (mode === 'up' ? '<div class="field"><label for="aPwd2">Confirmer le mot de passe</label><input id="aPwd2" type="password" autocomplete="new-password" required></div>' : '') +
      '<div id="authErr" class="notice err hide" role="alert"></div>' +
      '<button class="btn primary" style="width:100%;min-height:44px;margin-top:6px" type="submit">' + (mode === 'up' ? 'Créer mon compte' : 'Se connecter') + '</button>' +
      (mode === 'in' ? '<div style="text-align:center;margin-top:8px"><button class="link-btn" type="button" id="aForgot">Mot de passe oublié ?</button></div>' : '') +
      '</form>'
      : '<div class="notice info">La synchronisation par compte n\'est pas encore activée sur cette installation (configuration Firebase manquante, voir le README). Vous pouvez utiliser l\'application dès maintenant : vos données restent sur cet appareil.</div>') +
    '<div style="text-align:center;margin-top:14px"><button class="link-btn" type="button" id="aGuest">' + (configured ? 'Continuer sans compte (données sur cet appareil)' : 'Ouvrir l\'application') + '</button></div></div>';
  $$('[data-m]', r).forEach((b) => b.onclick = () => showAuth(b.dataset.m));
  $('#aGuest', r).onclick = () => { localStorage.setItem('dca_guest', '1'); hideAuth(); startApp(); };
  const err = (m) => { const e = $('#authErr', r); if (!e) return; e.textContent = m; e.classList.toggle('hide', !m); };
  if (!configured) return;
  const form = $('#authForm', r);
  form.onsubmit = async (ev) => {
    ev.preventDefault(); err('');
    const email = $('#aEmail', r).value.trim(), pwd = $('#aPwd', r).value;
    if (!/^\S+@\S+\.\S+$/.test(email)) return err('Adresse e-mail invalide.');
    if (mode === 'up') {
      if (pwd.length < 8) return err('Le mot de passe doit comporter au moins 8 caractères.');
      if (pwd !== $('#aPwd2', r).value) return err('Les deux mots de passe ne correspondent pas.');
    } else if (!pwd) return err('Saisissez votre mot de passe.');
    const btn = $('button[type=submit]', form); btn.disabled = true;
    try {
      if (mode === 'up') { await Cloud.signUp(email, pwd); Cloud.sendVerification().catch(() => {}); } else await Cloud.signIn(email, pwd);
      localStorage.removeItem('dca_guest');
      // la suite est déclenchée par onAuthChange → afterLogin
    } catch (e) { err(Cloud.friendly(e)); btn.disabled = false; }
  };
  const fg = $('#aForgot', r);
  if (fg) fg.onclick = async () => {
    const email = $('#aEmail', r).value.trim();
    if (!/^\S+@\S+\.\S+$/.test(email)) return err("Saisissez d'abord votre adresse e-mail ci-dessus.");
    try { await Cloud.resetPassword(email); err(''); toast('Si un compte existe pour cette adresse, un e-mail de réinitialisation vient d\'être envoyé.', { ms: 6000 }); }
    catch (e) { err(Cloud.friendly(e)); }
  };
}

/* ---------------------------------------------------------------
   NAVIGATION
   --------------------------------------------------------------- */
const PAGES = {
  home: { label: 'Accueil', icon: 'home', render: (h) => renderHome(h) },
  portfolio: { label: 'Mon portefeuille', short: 'Portefeuille', icon: 'wallet', render: (h) => renderPortfolio(h) },
  allocation: { label: 'Répartition', icon: 'pie', render: (h) => renderAllocation(h) },
  dividends: { label: 'Dividendes', icon: 'coins', render: (h) => renderDividends(h) },
  settings: { label: 'Paramètres', short: 'Réglages', icon: 'settings', render: (h) => renderSettings(h) }
};
const SLUG = { home: 'accueil', portfolio: 'portefeuille', allocation: 'repartition', dividends: 'dividendes', settings: 'parametres' };
const DIV_SLUG = { calendar: 'calendrier', history: 'historique', stats: 'statistiques' };
/* Anciens liens conservés : #/calendrier, #/historique, #/statistiques ouvrent l'onglet correspondant des Dividendes. */
function go(page) {
  if (page === 'calendar' || page === 'history' || page === 'stats') { view.divTab = page; page = 'dividends'; }
  if (!PAGES[page]) page = 'home';
  view.page = page;
  const slug = '#/' + SLUG[page] + (page === 'dividends' ? '/' + DIV_SLUG[view.divTab || 'calendar'] : '');
  if (location.hash !== slug) history.replaceState(null, '', slug);
  renderPage(); window.scrollTo(0, 0);
}
function pageFromHash() {
  const parts = location.hash.replace('#/', '').split('/'), s = parts[0];
  const old = Object.keys(DIV_SLUG).find((k) => DIV_SLUG[k] === s);
  if (old) { view.divTab = old; return 'dividends'; }
  const page = Object.keys(SLUG).find((k) => SLUG[k] === s) || 'home';
  if (page === 'dividends' && parts[1]) { const t = Object.keys(DIV_SLUG).find((k) => DIV_SLUG[k] === parts[1]); if (t) view.divTab = t; }
  return page;
}

function buildShell() {
  const nav = Object.keys(PAGES).map((k) => '<button class="nav-link" type="button" data-go="' + k + '">' + icon(PAGES[k].icon) + '<span>' + PAGES[k].label.replace('Calendrier des dividendes', 'Calendrier') + '</span></button>').join('');
  const tabs = Object.keys(PAGES).map((k) => '<button type="button" data-go="' + k + '">' + icon(PAGES[k].icon) + '<span>' + (PAGES[k].short || PAGES[k].label) + '</span></button>').join('');
  $('#app').innerHTML = '<aside class="sidebar"><div class="brand"><img src="logo.svg" alt="">StockPilot</div>' + nav + '<div class="spacer"></div>' +
    '<div class="side-foot"><div id="syncChipSide"></div><div class="muted" style="font-size:12px;padding:0 4px" id="whoSide"></div></div></aside>' +
    '<div class="main-col"><header class="topbar"><div class="brand-m"><img src="logo.svg" alt=""><span class="t">StockPilot</span></div><span class="grow"></span><button class="rf-btn bell-btn" type="button" id="bellBtn" aria-haspopup="dialog" aria-expanded="false" aria-label="Notifications">' + icon('bell') + '<span class="bell-badge hide"></span></button><button class="rf-btn" type="button" data-rf-btn aria-label="Actualiser">' + icon('refresh') + '</button>' +
    '<label class="sr" for="acctSel">Portefeuille</label><select id="acctSel" style="min-height:36px"></select><span id="syncChipTop"></span></header>' +
    '<main id="page" tabindex="-1"></main></div><nav class="tabbar" aria-label="Navigation">' + tabs + '</nav>';
  $$('[data-go]').forEach((b) => b.addEventListener('click', () => go(b.dataset.go)));
  Notify.init();
  $('#acctSel').onchange = (e) => { if (e.target.value === '__new__') { e.target.value = view.account; openNewAccountModal(); return; } view.account = e.target.value; renderPage(); };
  $$('#syncChipSide,#syncChipTop').forEach((c) => c.addEventListener('click', () => go('settings')));
}
function renderSyncChip() {
  if (!Cloud.configured()) { const a0 = $('#syncChipSide'), b0 = $('#syncChipTop'); if (a0) a0.innerHTML = ''; if (b0) b0.innerHTML = ''; return; }   // comptes désactivés : pas d'indicateur de synchronisation
  const s = view.sync, user = Cloud.user();
  const cls = { ok: 'ok', syncing: 'busy', err: 'err', offline: 'off', local: '' }[s.state] || '';
  const label = !user ? (Cloud.configured() ? 'Hors compte' : 'Local') : ({ ok: 'Synchronisé', syncing: 'Synchronisation…', err: 'Erreur de synchro', offline: 'Hors-ligne' }[s.state] || 'Compte');
  const html = '<button type="button" class="sync-chip ' + cls + '" title="' + esc(s.msg || label) + '"><i></i>' + label + '</button>';
  const a = $('#syncChipSide'), b = $('#syncChipTop'); if (a) a.innerHTML = html; if (b) b.innerHTML = html;
  const w = $('#whoSide'); if (w) w.textContent = user ? user.email : '';
}
/* Apparence : mode clair / sombre / auto et thème de fond (copie locale pour éviter tout flash au démarrage). */
function applyAppearance() {
  const h = document.documentElement, t = state.settings.theme || 'auto', b = state.settings.bg || 'aurore';
  if (t === 'auto') h.removeAttribute('data-theme'); else h.setAttribute('data-theme', t);
  h.setAttribute('data-bg', b);
  try { localStorage.setItem('dca_look', JSON.stringify({ theme: t, bg: b })); } catch (e) { /* ignoré */ }
}
function renderShell() {
  applyAppearance();
  $$('[data-go]').forEach((b) => b.classList.toggle('active', b.dataset.go === view.page));
  const sel = $('#acctSel');
  if (sel) { sel.innerHTML = '<option value="all">Tous les portefeuilles</option>' + state.accounts.map((a) => '<option value="' + esc(a.id) + '">' + esc(a.name) + '</option>').join('') + '<option value="__new__">+ Nouveau portefeuille…</option>'; sel.value = view.account; sel.classList.toggle('hide', false); }
  renderSyncChip();
}
function renderPage() {
  if (!$('#page')) return;
  renderShell();
  try { PAGES[view.page].render($('#page')); }
  catch (e) { console.error(e); $('#page').innerHTML = '<div class="card card-pad"><div class="notice err">Une erreur est survenue en affichant cette page : ' + esc(e.message) + '</div></div>'; Notify.push({ level: 'error', title: 'Erreur d\'affichage', body: esc(e.message) }); }
  clearTimeout(renderPage.gt); renderPage.gt = setTimeout(collectGlobalNotices, 200);      // notifications globales, hors du chemin critique d'affichage
}

/* Rafraîchissement discret (actualisation en arrière-plan, synchro) : ne coupe jamais une saisie ni une fenêtre ouverte. */
function renderPageSoft(tries) {
  const a = document.activeElement, typing = a && /^(INPUT|SELECT|TEXTAREA)$/.test(a.tagName) && a.closest('#page');
  if (($('#modalRoot') && $('#modalRoot').firstChild) || typing) { if ((tries || 0) < 12) setTimeout(() => renderPageSoft((tries || 0) + 1), 1500); return; }
  renderPage();
}

/* ---------------------------------------------------------------
   RAPPELS (notifications locales) — conservé de l'ancienne version
   --------------------------------------------------------------- */
function isIOS() { return /iphone|ipad|ipod/i.test(navigator.userAgent); }
function isStandalone() { return (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true; }
function notifSupported() { return ('Notification' in window) && ('serviceWorker' in navigator); }
function notifStatusText() {
  if (!notifSupported()) return (isIOS() && !isStandalone()) ? "Sur iPhone : ouvrez d'abord l'app depuis l'écran d'accueil (Partager → Sur l'écran d'accueil), puis revenez ici." : 'Les notifications ne sont pas disponibles sur ce navigateur.';
  if (Notification.permission === 'denied') return 'Bloquées par le navigateur : réautorisez-les dans les réglages du site.';
  if (Notification.permission === 'granted' && state.settings.notify) return "Activées : un résumé par mois, avec le montant attendu pour chaque actif concerné.";
  return 'Désactivées.';
}
function mergeSent(other) { if (!other) return; ['days', 'months'].forEach((k) => { state.sent[k] = Object.assign({}, other[k] || {}, state.sent[k] || {}); }); }
async function checkNotifications() {
  if (!state.settings.notify || !notifSupported() || Notification.permission !== 'granted') return;
  try { const c = await caches.open('dividendes-data'); const r = await c.match('state.json'); if (r) mergeSent((await r.json()).sent); } catch (e) { /* ignoré */ }
  const plans = Payouts.notificationPlan(state, new Date());
  for (const pl of plans) {
    try { const reg = await navigator.serviceWorker.ready; await reg.showNotification(pl.title, { body: pl.body, tag: pl.tag, icon: 'icon-192.png', badge: 'icon-192.png' }); Payouts.markSent(state, pl); } catch (e) { /* ignoré */ }
  }
  if (plans.length) saveState();
}
async function enableNotifications() {
  if (!notifSupported()) { toast(notifStatusText()); return false; }
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') { toast('Notifications refusées par le navigateur.'); return false; }
  state.settings.notify = true; saveState();
  try { const reg = await navigator.serviceWorker.ready; if ('periodicSync' in reg) { const st = await navigator.permissions.query({ name: 'periodic-background-sync' }); if (st.state === 'granted') await reg.periodicSync.register('payday-check', { minInterval: 12 * 3600 * 1000 }); } } catch (e) { /* ignoré */ }
  await checkNotifications(); toast('Rappels activés.'); return true;
}
function downloadICS() {
  const { text, count } = Payouts.buildICS({ holdings: state.holdings }, new Date(), 12, 9);
  if (!count) { toast('Aucun versement à exporter.'); return; }
  const url = URL.createObjectURL(new Blob([text], { type: 'text/calendar;charset=utf-8' }));
  const a = document.createElement('a'); a.href = url; a.download = 'dividendes.ics'; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  toast(count + ' rappel(s) prêts à importer dans votre agenda.');
}

/* ---------------------------------------------------------------
   SAUVEGARDE / RESTAURATION (fichier JSON)
   --------------------------------------------------------------- */
async function exportData() {
  const name = 'suivi-dividendes-' + todayISO() + '.json';
  const out = clone(state); delete out.settings.apiKey; delete out.undo;
  const file = new File([JSON.stringify(out, null, 2)], name, { type: 'application/json' });
  try { if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], title: 'Sauvegarde StockPilot' }); return; } }
  catch (e) { if (e && e.name === 'AbortError') return; }
  const url = URL.createObjectURL(file);
  const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
/* ---------------------------------------------------------------
   EXPORT CSV (Excel / Sheets / analyse) : séparateur « ; », décimales « , », UTF-8 avec BOM
   --------------------------------------------------------------- */
function csvCell(v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number') return isFinite(v) ? String(Math.round(v * 1e6) / 1e6).replace('.', ',') : '';
  let s = String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;                      // neutralise les formules dans un tableur
  return /[";\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
function csvText(head, rows) { return '﻿' + [head].concat(rows).map((r) => r.map(csvCell).join(';')).join('\r\n') + '\r\n'; }
function csvPositions() {
  const hs = visibleHoldings(), perf = Engine.performance(state, convert, visibleIds()), pm = {}, cur = baseCur();
  perf.rows.forEach((r) => { pm[r.id] = r; });
  const accName = (id) => (state.accounts.find((a) => a.id === id) || {}).name || '';
  const pct = (x) => (x === null || x === undefined ? null : x * 100);
  const head = ['Portefeuille', 'Ticker', 'ISIN', 'Nom', 'Type', 'Secteur', 'Pays', 'Devise', 'Quantité', 'PRU', 'Devise du PRU', 'Cours', 'Date du cours',
    'Investi (' + cur + ')', 'Valeur (' + cur + ')', 'Plus/moins-value (' + cur + ')', 'Performance (%)', 'Poids (%)', 'Dividende annuel par titre (brut)', 'Dividende annuel (brut, ' + cur + ')',
    'Rendement sur coût (%)', 'Rendement sur cours (%)', 'Fréquence du dividende'];
  const rows = hs.map((h) => {
    const r = pm[h.id] || {}, aps = Engine.annualPerShare(h), div = aps > 0 ? convert(aps * Number(h.quantity || 0), h.currency || 'EUR') : null;
    return [accName(h.account), h.displayTicker || h.ticker, h.isin || '', h.name || '', Engine.TYPES[h.type] || h.type, h.type === 'stock' ? (sectorFr(h.sector) || '') : '', h.country || '',
      h.currency || '', Number(h.quantity) || 0, h.avgCost > 0 ? h.avgCost : null, h.avgCost > 0 ? Engine.costCur(h) : '', h.price > 0 ? h.price : null, h.priceAt || '',
      r.cost, r.value, r.gain, pct(r.pct), pct(r.weight), aps > 0 ? aps : null, div,
      div !== null && r.cost > 0 ? div / r.cost * 100 : null, div !== null && r.value > 0 ? div / r.value * 100 : null,
      aps > 0 ? (FREQ_LABEL[h.dividend.frequency] || h.dividend.frequency || '') : (Engine.isAccumulating(h) ? 'Capitalisant' : 'Aucun')];
  });
  return csvText(head, rows);
}
function csvDividends() {
  const ids = visibleIds();
  const rows = Dividends.realPayments(state).filter((p) => !ids || ids.has(p.holdingId)).slice().sort((x, y) => String(x.payDate || x.exDate).localeCompare(String(y.payDate || y.exDate))).map((p) => {
    const h = holdingById(p.holdingId) || (state.archive || []).find((x) => x.id === p.holdingId), am = Dividends.amounts(p), o = p.origin || {};
    return [p.payDate || '', p.exDate || '', p.ticker || '', p.name || '', accountName(h && h.account), p.qty, p.perShare, am.gross, am.tax, p.fees, am.net, p.currency || '', p.source || '', o.file || '', o.line || '', p.extId || ''];
  });
  return csvText(['Date de paiement', 'Date de détachement', 'Ticker', 'Nom', 'Courtier / compte', 'Quantité', 'Par titre', 'Brut', 'Retenue', 'Frais', 'Net', 'Devise', 'Source', 'Fichier', 'Ligne', 'Identifiant'], rows);
}
function csvTransactions() {
  const ids = visibleIds(), L = { buy: 'Achat', sell: 'Vente' };
  const rows = state.transactions.filter((t) => !ids || ids.has(t.holdingId)).slice().sort((a, b) => String(a.date).localeCompare(String(b.date))).map((t) => [
    t.date || '', t.corp ? (t.type === 'buy' ? 'Livraison gratuite' : 'Retrait de titres') : (L[t.type] || t.type || ''), t.ticker || '', t.name || '', t.qty, t.price, t.fees, t.currency || '', t.source || '']);
  return csvText(['Date', 'Opération', 'Ticker', 'Nom', 'Quantité', 'Prix', 'Frais', 'Devise', 'Source'], rows);
}
async function csvValueSeries() {
  await ensureFxHistory();
  const vs = Engine.valueSeries(state, convertAt, { months: 60, today: new Date(), ids: visibleIds() });
  return { text: csvText(['Mois', 'Valeur du portefeuille (' + baseCur() + ')', 'Actifs valorisés'], vs.points.map((p) => [p.ym, p.value, p.n])), n: vs.points.length, retro: vs.retro };
}
async function saveFile(name, text, mime) {
  const file = new File([text], name, { type: mime });
  try { if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], title: name }); return true; } }
  catch (e) { if (e && e.name === 'AbortError') return false; }
  const url = URL.createObjectURL(file);
  const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  return true;
}
function openCsvExport() {
  const scope = view.account === 'all' ? 'tous les portefeuilles' : 'portefeuille « ' + ((state.accounts.find((a) => a.id === view.account) || {}).name || '') + ' »';
  const item = (k, t, d, dis) => '<button class="btn exp-item" type="button" data-exp="' + k + '"' + (dis ? ' disabled' : '') + '><b>' + t + '</b><small>' + d + '</small></button>';
  const m = openModal('<h2>Exporter en CSV</h2><div class="sub">Données exportées : ' + esc(scope) + '. Fichiers lisibles dans Excel, Numbers ou Google Sheets (séparateur « ; », décimales « , »).</div>' +
    item('positions', 'Portefeuille — positions', 'Une ligne par actif : quantité, PRU, cours, valeur, plus-value, poids, secteur, pays, dividende estimé.', !visibleHoldings().length) +
    item('dividends', 'Dividendes reçus', 'Tous les versements enregistrés : brut, retenue, frais, net, statut (vérifié / à vérifier).', !state.payments.length) +
    item('transactions', 'Transactions', 'Achats et ventes.', !state.transactions.length) +
    item('series', 'Évolution de la valeur (mensuelle)', 'Valeur du portefeuille mois par mois (5 ans max). Nécessite l\'historique de cours.', !state.holdings.some((h) => h.hist && h.hist.c && h.hist.c.length)) +
    '<div class="hint">Le fichier contient vos positions : gardez-le en lieu sûr. Les nombres sont de vrais nombres (pas de symbole monétaire).</div>' +
    '<div class="modal-actions"><span></span><div class="btn-row"><button class="btn" type="button" data-close>Fermer</button></div></div>');
  $$('[data-exp]', m).forEach((b) => b.onclick = async () => {
    const k = b.dataset.exp, d = todayISO(); let text, name, note = '';
    try {
      if (k === 'positions') { text = csvPositions(); name = 'portefeuille-' + d + '.csv'; }
      else if (k === 'dividends') { text = csvDividends(); name = 'dividendes-' + d + '.csv'; }
      else if (k === 'transactions') { text = csvTransactions(); name = 'transactions-' + d + '.csv'; }
      else { const r = await csvValueSeries(); if (!r.n) { toast('Pas d\'historique de cours : actualisez d\'abord les données.', { error: true }); return; } text = r.text; name = 'valeur-portefeuille-' + d + '.csv'; if (r.retro) note = ' (valeur rétrospective de vos positions actuelles)'; }
    } catch (e) { toast('Export impossible : ' + e.message, { error: true }); return; }
    if (await saveFile(name, text, 'text/csv;charset=utf-8')) toast(name + ' exporté' + note + '.');
  });
}
/* Retour arrière d'un import d'historique : photographie des données juste avant la modification (chiffrée avec le reste si un code est défini). */
function snapshotForUndo(label) {
  state.undo = { at: new Date().toISOString(), label: label, holdings: clone(state.holdings), payments: clone(state.payments), transactions: clone(state.transactions), archive: clone(state.archive || []), accounts: clone(state.accounts),
    corp: clone(state.corp || []), estimates: clone(state.estimates || []), migrations: clone(state.migrations || []), isinAlias: clone(state.isinAlias || {}), imports: clone(state.imports || []).map((x) => { delete x.raw; return x; }), reference: state.reference ? clone(state.reference) : null };
}
async function undoLastImport() {
  const u = state.undo; if (!u) return;
  const c = await confirmDialog({ title: 'Annuler la dernière modification ?', body: 'Les positions, opérations, opérations sur titres et versements reviennent à leur état d\'avant « ' + esc(u.label) + ' » (' + esc(fmtDate(u.at.slice(0, 10))) + '). <b>Les modifications faites depuis seront perdues.</b>', confirmLabel: 'Annuler', danger: true });
  if (!c.ok) return;
  state.holdings = u.holdings; state.payments = u.payments; state.transactions = u.transactions; state.archive = u.archive || []; state.estimates = u.estimates || []; state.migrations = u.migrations || []; state.corp = u.corp || []; state.isinAlias = u.isinAlias || {}; if (u.imports) { const rawById = {}; (state.imports || []).forEach((x) => { if (x.raw) rawById[x.id] = x.raw; }); state.imports = u.imports.map((x) => Object.assign(x, rawById[x.id] ? { raw: rawById[x.id] } : {})); } if (u.reference) state.reference = u.reference; else delete state.reference; if (u.accounts) state.accounts = u.accounts; if (view.account !== 'all' && !state.accounts.some((x) => x.id === view.account)) view.account = 'all'; delete state.undo;
  saveState(); renderPage(); toast('Import annulé : données restaurées.');
}
function importBackup(file) {
  const reader = new FileReader();
  reader.onload = async () => {
    try {
      const parsed = JSON.parse(reader.result);
      if (!parsed || !Array.isArray(parsed.holdings)) throw new Error('Format invalide');
      const c = await confirmDialog({ title: 'Restaurer cette sauvegarde ?', body: 'Elle contient <b>' + parsed.holdings.length + '</b> actif(s). Elle <b>remplace</b> les données actuelles de cet appareil' + (Cloud.user() ? ' (et de votre compte après synchronisation)' : '') + '.', confirmLabel: 'Restaurer', danger: true });
      if (!c.ok) return;
      const keep = { uid: state.meta.uid, remoteBase: state.meta.remoteBase };
      state = hydrateState(parsed); state.meta.uid = keep.uid; state.meta.remoteBase = keep.remoteBase;
      saveState(); renderPage(); toast('Sauvegarde restaurée.');
    } catch (e) { toast("Échec de la restauration : fichier invalide.", { error: true }); }
  };
  reader.readAsText(file);
}

/* ---------------------------------------------------------------
   DÉMARRAGE
   --------------------------------------------------------------- */
let appStarted = false;
function startApp() {
  hideAuth();
  if (!appStarted) {
    appStarted = true;
    buildShell();
    view.page = pageFromHash();
    window.addEventListener('hashchange', () => { const tab = view.divTab, p = pageFromHash(); if (p !== view.page || (p === 'dividends' && tab !== view.divTab)) { view.page = p; renderPage(); } });
    window.addEventListener('online', () => { if (Cloud.user()) { pullIfChanged(); if (state.meta.dirty) scheduleSync(); } });
    window.addEventListener('offline', () => { if (Cloud.user()) setSync('offline', 'Hors-ligne'); });
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') { pullIfChanged(); checkNotifications(); setTimeout(autoRefreshIfStale, 1500); setTimeout(autoDivAnalysisIfDue, 20000); } });
    ensureFx(); ensureFxHistory(); initPullRefresh();
    if ('serviceWorker' in navigator && location.protocol.indexOf('http') === 0) navigator.serviceWorker.register('sw.js').then(() => { snapshotForWorker(); checkNotifications(); }).catch(() => {});
    refreshPayLags(); setTimeout(autoRefreshIfStale, 2500); setTimeout(autoDivAnalysisIfDue, 15000);
    setInterval(() => { if (document.visibilityState === 'visible' && Cloud.user() && navigator.onLine) pullIfChanged(); }, 30000);      // modifications d'un autre appareil reprises en moins de 30 s
  }
  renderPage();
}

async function boot() {
  Vault.requestPersistence();
  let raw = null;
  try { raw = await Vault.readRaw(); } catch (e) { raw = null; }
  // Données chiffrées : on attend le bon code (jamais de repli sur un état vide qui écraserait les données).
  const text = raw && Vault.isEnvelope(raw) ? await Vault.promptUnlock(raw) : raw;
  let parsed = {};
  try { parsed = text ? JSON.parse(text) : {}; } catch (e) { parsed = {}; }
  // Assurance : une copie de l'ancien format (v1) est conservée une fois, avant la migration.
  try { if (text && parsed && parsed.v !== 2 && parsed.holdings && !localStorage.getItem('dca_v1_backup')) localStorage.setItem('dca_v1_backup', text); } catch (e) { /* quota */ }
  state = hydrateState(parsed);
  if (text && !Vault.hasPin()) Vault.write(JSON.stringify(state));   // alimente aussi la copie IndexedDB
  Vault.enableAutoLock();

  if (!Cloud.configured()) {
    // Mode local : l'app fonctionne comme avant, sans compte.
    startApp(); setSync('local', 'Données enregistrées sur cet appareil'); return;
  }
  let first = true;
  const noSession = () => { first = false; if (localStorage.getItem('dca_guest') === '1') { startApp(); setSync('local', ''); } else showAuth('in'); };
  Cloud.onAuthChange((user) => {
    if (user) { if (first || !appStarted || $('#authRoot').classList.contains('on')) { first = false; afterLogin(user); } else renderSyncChip(); }
    else if (first) noSession();
  });
  try { await Cloud.init(); }
  catch (e) {
    // SDK injoignable (hors-ligne) : on continue en local, sans perdre les données déjà présentes.
    first = false; startApp(); setSync('offline', 'Synchronisation indisponible pour le moment'); return;
  }
  setTimeout(() => { if (first && !Cloud.user()) noSession(); }, 6000);   // filet de sécurité
}
boot();


/* Contrôle d'intégrité au démarrage : si une partie de l'application manque (fichiers de versions mélangées après une mise à jour interrompue, mauvais réseau),
   le cache est vidé et la page rechargée UNE fois ; si le problème persiste, un message l'explique au lieu d'une page cassée. */
(function integrityCheck() {
  const need = ['holdingByNameAny', 'openActionList', 'runDividendAnalysis', 'openDelistModal', 'openLiquidationModal', 'notifyDuplicates', 'openManualFx', 'Pdf', 'Sync', 'Dividends', 'Ledger', 'Engine', 'Market', 'Notify', 'positionNotices', 'continuityNotices'];
  const missing = need.filter((n) => { try { return new Function('return typeof ' + n)() === 'undefined'; } catch (e) { return true; } });
  if (!missing.length) { try { sessionStorage.removeItem('sp_heal'); } catch (e) { /* ignoré */ } return; }
  let tried = false; try { tried = sessionStorage.getItem('sp_heal') === '1'; sessionStorage.setItem('sp_heal', '1'); } catch (e) { /* ignoré */ }
  if (!tried && typeof caches !== 'undefined') {
    Promise.all([caches.keys().then((ks) => Promise.all(ks.filter((k) => k.indexOf('dividendes-shell') === 0).map((k) => caches.delete(k)))), navigator.serviceWorker ? navigator.serviceWorker.getRegistrations().then((rs) => Promise.all(rs.map((r) => r.unregister()))) : null]).catch(() => {}).then(() => location.reload());
    return;
  }
  window.addEventListener('DOMContentLoaded', () => { const d = document.createElement('div'); d.style.cssText = 'position:fixed;left:12px;right:12px;top:12px;z-index:99999;background:#fff3cd;color:#664d03;border:1px solid #ffecb5;border-radius:10px;padding:12px;font:14px system-ui'; d.textContent = 'Mise à jour incomplète (' + missing.join(', ') + ' manquant). Vérifiez votre connexion puis fermez et rouvrez l\'application.'; document.body.appendChild(d); });
})();
