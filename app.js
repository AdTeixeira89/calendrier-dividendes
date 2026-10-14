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
    holdings: [], payments: [], transactions: [],
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
  port: { q: '', type: 'all', div: 'all' },
  stats: { year: new Date().getFullYear() },
  home: { year: new Date().getFullYear(), period: 12 },
  sync: { state: 'local', msg: '', at: 0 }
};

function clone(o) { return JSON.parse(JSON.stringify(o)); }
function hasData(s) { return !!(s.holdings.length || s.payments.length || s.transactions.length); }

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
    if (!Array.isArray(s.accounts) || !s.accounts.length) s.accounts = defaultState().accounts;
    s.holdings.forEach((h) => { if (!h.account || !s.accounts.some((a) => a.id === h.account)) h.account = s.accounts[0].id; migrateHolding(h); });
    s.sent = s.sent || { days: {}, months: {} };
    return s;
  } catch (e) { return defaultState(); }
}

/* Enregistrement : local (localStorage + IndexedDB, chiffré si code) puis cloud (différé). */
function saveState(o) {
  o = o || {};
  if (!o.remote) state.meta.dirty = true;
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
async function ensureFx() {
  try {
    const raw = localStorage.getItem('fxRatesCache_v2');
    if (raw) { const c = JSON.parse(raw); if (c.day === todayISO()) { fx = { rates: c.rates, date: c.date }; return; } if (c.rates) fx = { rates: c.rates, date: c.date }; }
    const r = await fetch('https://api.frankfurter.dev/v1/latest?base=EUR');
    if (!r.ok) return;
    const d = await r.json();
    if (d && d.rates) { fx = { rates: Object.assign({ EUR: 1 }, d.rates), date: d.date }; localStorage.setItem('fxRatesCache_v2', JSON.stringify({ day: todayISO(), date: d.date, rates: fx.rates })); renderPageSoft(); }
  } catch (e) { /* les totaux restent affichés dans leur devise d'origine si possible */ }
}
/* Taux de change HISTORIQUES (fin de chaque mois), pour valoriser le passé au bon taux. Une seule requête
   (Frankfurter, données BCE) mise en cache pour la journée ; sans réseau on retombe sur le taux actuel. */
let fxHist = null;
async function ensureFxHistory() {
  try {
    const curs = Array.from(new Set(state.holdings.flatMap((h) => [h.currency, Engine.costCur(h)]).concat([baseCur()]))).filter((c) => c && c !== 'EUR').sort();
    if (!curs.length) { fxHist = {}; return; }
    const from = state.holdings.reduce((m, h) => (h.hist && h.hist.from < m ? h.hist.from : m), Engine.addYM(Engine.ymOf(new Date()), -60)) + '-01';
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
  return (fx.rates || {})[cur] || null;
}
/* Montant dans sa devise → devise de base, au taux de fin de mois ym. */
function convertAt(amount, cur, ym) {
  const a = rateAt(cur, ym), b = rateAt(baseCur(), ym);
  return a && b ? amount / a * b : null;
}
const baseCur = () => state.settings.baseCurrency || 'EUR';
/* Convertit vers la devise de base ; null si le taux est indisponible (jamais de faux chiffre). */
function convert(amount, cur) {
  const b = baseCur();
  if (!cur || cur === b) return amount;
  const r = fx.rates || {};
  const eur = cur === 'EUR' ? amount : (r[cur] ? amount / r[cur] : null);
  if (eur === null) return null;
  return b === 'EUR' ? eur : (r[b] ? eur * r[b] : null);
}

/* ---------------------------------------------------------------
   FILTRES GLOBAUX
   --------------------------------------------------------------- */
function visibleHoldings() { return view.account === 'all' ? state.holdings : state.holdings.filter((h) => h.account === view.account); }
function visibleIds() { return view.account === 'all' ? null : new Set(visibleHoldings().map((h) => h.id)); }
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
    cancelled: () => refreshCancel,
    progress: (i, n, h) => { if (modal) { const m = $('#rfMsg'), b = $('#rfBar'); if (m) m.textContent = i + ' / ' + n + ' — ' + (h.displayTicker || h.ticker); if (b) b.style.width = (100 * i / n) + '%'; } }
  });
  refreshing = false;
  if (res.ok) { state.meta.lastMarketUpdate = Date.now(); saveState(); ensureFxHistory(); }   // rien à enregistrer (ni à synchroniser) si tout a échoué
  if (modal) closeModal();
  if (!o.silent) renderPage(); else if (res.ok) renderPageSoft();
  if (!o.silent) {
    const parts = [res.ok + ' actif(s) mis à jour'];
    if (res.fail) parts.push(res.fail + ' échec(s)' + (res.errors[0] ? ' — ' + res.errors[0].message : ''));
    toast(parts.join(', ') + '.', { error: !!res.fail && !res.ok, ms: 6000 });
  }
  return res;
}
function staleMarket() { const t = state.meta.lastMarketUpdate; return !t || Date.now() - t > 24 * 3600 * 1000; }

/* ---------------------------------------------------------------
   SYNCHRONISATION CLOUD
   --------------------------------------------------------------- */
let syncTimer = null, syncing = false, syncQueued = false;
function setSync(st, msg) { view.sync = { state: st, msg: msg || '', at: Date.now() }; renderSyncChip(); }

function cloudPayload() {
  const c = clone(state);
  c.meta = { uid: c.meta.uid, lastMarketUpdate: c.meta.lastMarketUpdate, remoteBase: 0, dirty: false };
  return c;
}
function scheduleSync() {
  if (!Cloud.user()) return;
  clearTimeout(syncTimer);
  setSync('syncing', 'Modifications en attente…');
  syncTimer = setTimeout(syncNow, 1800);
}
async function syncNow() {
  const u = Cloud.user(); if (!u) return false;
  if (syncing) { syncQueued = true; return false; }
  if (!navigator.onLine) { setSync('offline', 'Hors-ligne : synchronisation à la reconnexion.'); return false; }
  syncing = true; setSync('syncing', 'Synchronisation…');
  try {
    const r = await Cloud.push(cloudPayload(), state.meta.remoteBase);
    state.meta.remoteBase = r.updatedAt; state.meta.dirty = false; state.meta.uid = u.uid;
    saveState({ remote: true });
    setSync('ok', 'Synchronisé');
    return true;
  } catch (e) {
    if (e.conflict) { setSync('err', 'Conflit : modifications faites sur un autre appareil.'); await resolveConflict('conflict'); return false; }
    setSync('err', Cloud.friendly(e));
    return false;
  } finally {
    syncing = false;
    if (syncQueued) { syncQueued = false; if (state.meta.dirty) scheduleSync(); }
  }
}
function applyRemote(remote, uidv) {
  state = hydrateState(remote.state);
  state.meta.uid = uidv; state.meta.remoteBase = remote.updatedAt; state.meta.dirty = false;
  saveState({ remote: true });
  renderPageSoft();
}
async function pullIfChanged() {
  const u = Cloud.user(); if (!u || syncing || !navigator.onLine) return;
  try {
    const v = await Cloud.remoteVersion();
    if (v === state.meta.remoteBase) { if (state.meta.dirty) scheduleSync(); return; }
    if (v > state.meta.remoteBase) {
      if (!state.meta.dirty) { const r = await Cloud.fetchRemote(); applyRemote(r, u.uid); toast('Données mises à jour depuis votre compte.'); setSync('ok', 'Synchronisé'); }
      else await resolveConflict('conflict');
    }
  } catch (e) { setSync('err', Cloud.friendly(e)); }
}

/* Fusion : ajoute à la version cloud ce qui n'existe pas encore (ni écrasement, ni doublon). */
function mergeStates(local, remote) {
  const out = clone(remote);
  const accMap = {}, byName = new Map(out.accounts.map((a) => [a.name.trim().toLowerCase(), a.id]));
  local.accounts.forEach((a) => {
    if (out.accounts.some((x) => x.id === a.id)) { accMap[a.id] = a.id; return; }
    const same = byName.get(a.name.trim().toLowerCase());
    if (same) { accMap[a.id] = same; return; }
    out.accounts.push(clone(a)); accMap[a.id] = a.id;
  });
  const hkey = (h) => h.account + '|' + String(h.isin || h.ticker || '').toUpperCase();
  const have = new Map(out.holdings.map((h) => [hkey(h), h]));
  const idMap = {};
  local.holdings.forEach((h) => {
    const lh = clone(h); lh.account = accMap[lh.account] || lh.account;
    const ex = have.get(hkey(lh)) || out.holdings.find((x) => x.id === lh.id);
    if (ex) { idMap[h.id] = ex.id; return; }
    out.holdings.push(lh); have.set(hkey(lh), lh); idMap[h.id] = lh.id;
  });
  const pk = new Set(out.payments.map(Engine.paymentKey));
  local.payments.forEach((p) => {
    const lp = clone(p); lp.holdingId = idMap[lp.holdingId] || lp.holdingId;
    if (out.payments.some((x) => x.id === lp.id) || pk.has(Engine.paymentKey(lp))) return;
    out.payments.push(lp); pk.add(Engine.paymentKey(lp));
  });
  const tk = new Set(out.transactions.map((t) => t.id));
  local.transactions.forEach((t) => { if (tk.has(t.id)) return; const lt = clone(t); lt.holdingId = idMap[lt.holdingId] || lt.holdingId; out.transactions.push(lt); });
  out.settings = Object.assign({}, local.settings, out.settings);
  out.settings.columns = Object.assign({}, local.settings.columns || {}, out.settings.columns || {});
  return out;
}

/* Conflit entre les données de cet appareil et celles du compte. */
async function resolveConflict(reason) {
  const u = Cloud.user(); if (!u) return;
  let remote;
  try { remote = await Cloud.fetchRemote(); } catch (e) { setSync('err', Cloud.friendly(e)); return; }
  if (!remote.exists || !remote.state) {   // le compte n'a (plus) de données : on y renvoie simplement celles de cet appareil
    try { const r = await Cloud.push(cloudPayload(), remote.updatedAt || 0); state.meta.remoteBase = r.updatedAt; state.meta.dirty = false; state.meta.uid = u.uid; saveState({ remote: true }); setSync('ok', 'Synchronisé'); } catch (e) { setSync('err', Cloud.friendly(e)); }
    return;
  }
  return new Promise((resolve) => {
    const nL = state.holdings.length, nR = remote.state ? (remote.state.holdings || []).length : 0;
    const intro = reason === 'migrate'
      ? 'Cet appareil contient déjà des données (<b>' + nL + '</b> actif(s)) et votre compte aussi (<b>' + nR + '</b> actif(s)).'
      : 'Les données ont été modifiées à la fois sur cet appareil (<b>' + nL + '</b> actif(s)) et dans votre compte (<b>' + nR + '</b> actif(s)).';
    const m = openModal('<h2>Quelles données conserver ?</h2><div class="sub">' + intro + ' Rien n\'est supprimé sans votre choix.</div>' +
      '<div class="stack">' +
      '<button class="btn primary" type="button" id="cfMerge">Fusionner les deux (recommandé)</button>' +
      '<div class="hint" style="margin-top:-6px">Ajoute à votre compte les éléments qui n\'y sont pas encore, sans doublon.</div>' +
      '<button class="btn" type="button" id="cfCloud">Utiliser les données du compte</button>' +
      '<div class="hint" style="margin-top:-6px">Les données de cet appareil sont remplacées (exportez-les d\'abord si besoin).</div>' +
      '<button class="btn" type="button" id="cfLocal">Envoyer les données de cet appareil vers le compte</button>' +
      '<div class="hint" style="margin-top:-6px">Les données actuelles du compte sont remplacées.</div>' +
      '<button class="link-btn" type="button" id="cfExport">Exporter une sauvegarde de cet appareil d\'abord</button></div>', { sticky: true });
    const done = () => { closeModal(); resolve(); };
    $('#cfExport', m).onclick = () => exportData();
    $('#cfCloud', m).onclick = () => { applyRemote(remote, u.uid); setSync('ok', 'Synchronisé'); toast('Données du compte chargées.'); done(); };
    $('#cfLocal', m).onclick = async () => {
      try { const r = await Cloud.push(cloudPayload(), remote.updatedAt); state.meta.remoteBase = r.updatedAt; state.meta.dirty = false; state.meta.uid = u.uid; saveState({ remote: true }); setSync('ok', 'Synchronisé'); toast('Votre compte contient maintenant les données de cet appareil.'); }
      catch (e) { toast(Cloud.friendly(e), { error: true }); }
      done();
    };
    $('#cfMerge', m).onclick = async () => {
      try {
        const merged = hydrateState(mergeStates(state, remote.state || defaultState()));
        const r = await Cloud.push(Object.assign(clone(merged), { meta: { uid: u.uid } }), remote.updatedAt);
        state = merged; state.meta.uid = u.uid; state.meta.remoteBase = r.updatedAt; state.meta.dirty = false;
        saveState({ remote: true }); setSync('ok', 'Synchronisé'); renderPage(); toast('Données fusionnées.');
      } catch (e) { toast(Cloud.friendly(e), { error: true }); }
      done();
    };
  });
}

/* Après connexion : récupère / envoie les données sans jamais en perdre. */
async function afterLogin(user) {
  // Appareil déjà connu : on affiche tout de suite les données locales, la synchronisation se fait en arrière-plan.
  if (state.meta.uid === user.uid && hasData(state) && !$('#authRoot').classList.contains('on')) {
    startApp(); setSync('syncing', 'Synchronisation…');
    try { await pullIfChanged(); if (state.meta.dirty) await syncNow(); else if (view.sync.state !== 'err') setSync('ok', 'Synchronisé'); }
    catch (e) { setSync('err', Cloud.friendly(e)); }
    return;
  }
  showAuthBusy('Synchronisation de vos données…');
  try {
    if (state.meta.uid && state.meta.uid !== user.uid) { state = defaultState(); state.settings.relayUrl = CFG.relayUrl || ''; }   // données d'un autre compte : jamais mélangées
    const remote = await Cloud.fetchRemote();
    if (!remote.exists || !remote.state) {
      state.meta.uid = user.uid; state.meta.remoteBase = 0;
      const had = hasData(state);
      const r = await Cloud.push(cloudPayload(), 0);
      state.meta.remoteBase = r.updatedAt; state.meta.dirty = false; saveState({ remote: true });
      hideAuth(); startApp();
      if (had) toast('Vos données locales ont été enregistrées dans votre compte.');
      setSync('ok', 'Synchronisé');
      return;
    }
    if (!hasData(state)) { applyRemote(remote, user.uid); hideAuth(); startApp(); setSync('ok', 'Synchronisé'); return; }
    if (state.meta.uid === user.uid) {
      if (remote.updatedAt === state.meta.remoteBase) { hideAuth(); startApp(); if (state.meta.dirty) scheduleSync(); else setSync('ok', 'Synchronisé'); return; }
      if (!state.meta.dirty) { applyRemote(remote, user.uid); hideAuth(); startApp(); setSync('ok', 'Synchronisé'); return; }
      hideAuth(); startApp(); await resolveConflict('conflict'); return;
    }
    hideAuth(); startApp(); await resolveConflict('migrate');
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
  r.innerHTML = '<div class="card card-pad auth-card"><div class="brand"><img src="logo.svg" alt="">Dividendes</div><p class="tag">' + esc(msg) + '</p><div class="progress"><i style="width:60%"></i></div></div>';
}
function hideAuth() { const r = $('#authRoot'); r.classList.remove('on'); r.innerHTML = ''; }
function showAuth(mode) {
  mode = mode || 'in';
  const r = $('#authRoot'); r.classList.add('on');
  const configured = Cloud.configured();
  r.innerHTML = '<div class="card card-pad auth-card"><div class="brand"><img src="logo.svg" alt="">Dividendes</div>' +
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
  $('#app').innerHTML = '<aside class="sidebar"><div class="brand"><img src="logo.svg" alt="">Dividendes</div>' + nav + '<div class="spacer"></div>' +
    '<div class="side-foot"><div id="syncChipSide"></div><div class="muted" style="font-size:12px;padding:0 4px" id="whoSide"></div></div></aside>' +
    '<div class="main-col"><header class="topbar"><div class="brand-m"><img src="logo.svg" alt=""><span class="t">Dividendes</span></div><span class="grow"></span>' +
    '<label class="sr" for="acctSel">Portefeuille</label><select id="acctSel" style="min-height:36px"></select><span id="syncChipTop"></span></header>' +
    '<main id="page" tabindex="-1"></main></div><nav class="tabbar" aria-label="Navigation">' + tabs + '</nav>';
  $$('[data-go]').forEach((b) => b.addEventListener('click', () => go(b.dataset.go)));
  $('#acctSel').onchange = (e) => { view.account = e.target.value; renderPage(); };
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
  if (sel) { sel.innerHTML = '<option value="all">Tous les portefeuilles</option>' + state.accounts.map((a) => '<option value="' + esc(a.id) + '">' + esc(a.name) + '</option>').join(''); sel.value = view.account; sel.classList.toggle('hide', state.accounts.length < 2 && view.page === 'settings'); }
  renderSyncChip();
}
function renderPage() {
  if (!$('#page')) return;
  renderShell();
  try { PAGES[view.page].render($('#page')); }
  catch (e) { console.error(e); $('#page').innerHTML = '<div class="card card-pad"><div class="notice err">Une erreur est survenue en affichant cette page : ' + esc(e.message) + '</div></div>'; }
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
  const out = clone(state); delete out.settings.apiKey;
  const file = new File([JSON.stringify(out, null, 2)], name, { type: 'application/json' });
  try { if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], title: 'Sauvegarde Suivi des dividendes' }); return; } }
  catch (e) { if (e && e.name === 'AbortError') return; }
  const url = URL.createObjectURL(file);
  const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
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
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') { pullIfChanged(); checkNotifications(); } });
    ensureFx(); ensureFxHistory();
    if ('serviceWorker' in navigator && location.protocol.indexOf('http') === 0) navigator.serviceWorker.register('sw.js').then(() => { snapshotForWorker(); checkNotifications(); }).catch(() => {});
    setTimeout(() => { if (state.settings.autoRefresh && state.settings.relayUrl && state.holdings.length && staleMarket()) refreshMarket(null, { silent: true }); }, 2500);
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
