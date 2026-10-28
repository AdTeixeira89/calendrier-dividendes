/* ==================================================================
   pages.js — Accueil, Mon portefeuille, Calendrier, Historique, Statistiques.
   ================================================================== */

const FREQ_LABEL = { monthly: 'Mensuelle', quarterly: 'Trimestrielle', semiannual: 'Semestrielle', annual: 'Annuelle', irregular: 'Irrégulière', none: 'Aucune' };
const freqLabel = (f) => FREQ_LABEL[f] || '—';

function pageHead(title, sub, actions) {
  if (view.page === 'dividends') return '<div class="page-head page-head-sub"><div>' + (sub ? '<div class="sub">' + sub + '</div>' : '') + '</div><div class="btn-row">' + (actions || '') + '</div></div>';   // dans les onglets Dividendes, l'onglet fait office de titre
  return '<div class="page-head"><div><h1>' + esc(title) + '</h1>' + (sub ? '<div class="sub">' + sub + '</div>' : '') + '</div><div class="btn-row">' + (actions || '') + '</div></div>';
}
function modeSeg() {
  const m = incomeMode();
  return '<div class="seg" role="group" aria-label="Revenus bruts ou nets"><button type="button" data-mode="gross" class="' + (m === 'gross' ? 'on' : '') + '">Bruts</button><button type="button" data-mode="net" class="' + (m === 'net' ? 'on' : '') + '">Nets</button></div>';
}
function wireMode(host) {
  $$('[data-mode]', host).forEach((b) => b.onclick = () => { state.settings.incomeMode = b.dataset.mode; saveState(); renderPage(); });
}
const money = (v, d) => fmtMoney(v, baseCur(), d === undefined ? {} : { d });
function missingNote(arr) {
  return arr && arr.length ? '<div class="notice" style="margin-top:10px">Taux de change indisponible pour ' + arr.map(esc).join(', ') + ' : ces montants ne sont pas inclus dans les totaux convertis.</div>' : '';
}
function emptyPortfolio() {
  return '<div class="card empty"><h3>Bienvenue — commencez par ajouter vos actifs</h3><p>Importez un relevé de votre courtier (CSV / Excel) ou ajoutez un actif à la main.<br>Les prévisions de dividendes se calculent automatiquement.</p>' +
    '<div class="btn-row" style="justify-content:center"><button class="btn primary" type="button" data-do="add">' + icon('plus') + 'Ajouter un actif</button><button class="btn" type="button" data-do="import">' + icon('upload') + 'Importer un relevé</button></div></div>';
}
function wireDo(host) {
  $$('[data-do]', host).forEach((b) => b.addEventListener('click', () => {
    const a = b.dataset.do;
    if (a === 'add') openHoldingModal(null);
    else if (a === 'import') openImportPositions();
    else if (a === 'import-tx') openImportTransactions();
    else if (a === 'import-degiro') openImportDegiro();
    else if (a === 'new-account') openNewAccountModal();
    else if (a === 'check-history') openDiagnostic();
    else if (a === 'export-csv') openCsvExport();
    else if (a === 'refresh') refreshMarket(visibleHoldings());
    else if (a === 'add-payment') openPaymentModal(null);
    else if (a === 'settings') go('settings');
    else if (a === 'prefill') runPrefill();
    else if (a === 'div-history') runDividendHistory();
    else if (a === 'validate-all') runValidateAll();
  }));
}
function holdingById(id) { return state.holdings.find((h) => h.id === id); }
function marketLine() {
  const t = state.meta.lastMarketUpdate;
  return t ? 'Données de marché mises à jour le ' + fmtDateTime(t) : 'Données de marché : jamais actualisées';
}

/* ===============================================================
   ACCUEIL
   =============================================================== */
let tickerRaf = null;
/* Défilement continu en boucle (le contenu est dupliqué) ; la main reprend à tout moment : toucher, molette,
   survol ou clavier mettent l'animation en pause quelques secondes. Respecte « réduire les animations ». */
function startTickerScroll(track) {
  cancelAnimationFrame(tickerRaf);
  if (!track || !track.children.length) return;
  const kids = Array.from(track.children);
  if (track.scrollWidth > track.clientWidth + 10) {
    kids.forEach((k) => { const c = k.cloneNode(true); c.setAttribute('aria-hidden', 'true'); c.tabIndex = -1; track.appendChild(c); });
    track.dataset.loop = '1';
  }
  if (track.dataset.loop !== '1') return;
  const loopW = track.children[kids.length].offsetLeft - track.children[0].offsetLeft;
  track.addEventListener('scroll', () => { if (track.scrollLeft < 1) track.scrollLeft += loopW; else if (track.scrollLeft >= loopW + 1) track.scrollLeft -= loopW; }, { passive: true });
  if (!state.settings.tickerAuto || (window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches)) return;
  let pausedUntil = 0, pos = track.scrollLeft;
  const pause = () => { pausedUntil = Date.now() + 4000; };
  ['pointerdown', 'touchstart', 'wheel', 'mouseenter', 'focusin'].forEach((e) => track.addEventListener(e, pause, { passive: true }));
  const step = () => {
    if (!track.isConnected) return;
    if (Date.now() < pausedUntil) pos = track.scrollLeft;
    else { pos += 0.55; if (pos >= loopW) pos -= loopW; track.scrollLeft = pos; }
    tickerRaf = requestAnimationFrame(step);
  };
  tickerRaf = requestAnimationFrame(step);
}

/* Pastilles d'une ligne : logo, ticker, total estimé, date (≈ = estimé). Détail au survol (souris) ou au toucher. */
function tickerHtml(next, mask) {
  const mode = incomeMode();
  if (!next.length) return '<div class="card card-pad muted">Aucun versement attendu dans les 4 prochains mois. Vérifiez que vos actifs ont des données de dividende.</div>';
  return '<div class="ticker-track" id="tickerTrack" role="list" aria-label="Prochains versements, défilement horizontal">' + next.slice(0, 30).map((e, i) => {
    const a = Engine.amount(e, mode);
    const tip = [e.name || e.ticker, mask ? 'Montants masqués' : fmtNum(e.qty) + ' titre(s) × ' + fmtMoney(e.perShare, e.currency, { d: 3 }) + ' = ' + fmtMoney(a.v, e.currency) + (a.fallback ? ' (brut)' : ''), fmtDate(e.date) + ' · ' + kindLabel(e.dateKind, e.status), STATUS_LABEL[e.status]].join('\n');
    return '<button type="button" role="listitem" class="tk-chip ' + e.status + '" data-i="' + i + '" data-tip="' + esc(tip) + '" data-tip-hover>' + avatar(e.ticker, e.logo, 'xs', e.isin) + '<b>' + esc(e.ticker) + '</b><span class="tk-amt">' + fmtMoney(a.v, e.currency) + (e.status === 'forecast' ? ' ≈' : '') + '</span><span class="tk-d">' + esc(fmtDate(e.date, { day: 'numeric', month: 'short' })) + '</span></button>';
  }).join('') + '</div>';
}

const kpiCard = (label, val, sub, cls) => '<div class="card kpi"><div class="lbl">' + label + '</div><div class="val ' + (cls || '') + '">' + val + '</div><div class="sub">' + (sub || '') + '</div></div>';

/* Indicateurs de dividendes (onglet Dividendes → Statistiques) */
function dividendKpisHtml() {
  const today = new Date(), mode = incomeMode(), ids = visibleIds(), y = today.getFullYear();
  const next = Engine.nextEvents(state, today, 120, ids);
  const run = Engine.runRate(state, mode, convert, ids);
  const rec = Engine.receivedBetween(state, y + '-01-01', Engine.toISO(today), mode, convert, ids);
  const mEvs = Engine.buildEvents(state, new Date(y, today.getMonth(), 1), new Date(y, today.getMonth() + 1, 0), today, ids).filter((e) => e.status !== 'unrecorded');
  const mSum = Engine.sumEvents(mEvs, mode, convert);
  const mReceived = mEvs.filter((e) => e.status === 'received').length;
  const yoc = Engine.yieldOnCost(state, convert, ids);
  const yo = Engine.yoy(state, today, mode, convert, ids);
  // Réconciliation : le « annuel estimé » est un rythme sur 12 mois ; ici, le total de l'année civile en cours.
  const yEvs = Engine.buildEvents(state, new Date(y, 0, 1), new Date(y, 11, 31), today, ids);
  const yRec = Engine.sumEvents(yEvs.filter((e) => e.status === 'received'), mode, convert);
  const yUp = Engine.sumEvents(yEvs.filter((e) => e.status === 'forecast' || e.status === 'confirmed'), mode, convert);
  const anyUnver = state.payments.some((p) => p.verified === false);
  const hs = visibleHoldings();
  const payers = hs.filter((h) => Engine.isPayer(h)).length;
  const missing = hs.filter((h) => Engine.dividendStatus(h) === 'missing');
  const first = next[0];
  const fa = first ? Engine.amount(first, mode) : null;
  const allMissing = Array.from(new Set([].concat(run.missing, rec.missing, mSum.missing)));
  const netNote = mode === 'net' && (run.fallbacks || mSum.fallbacks) ? 'Net inconnu pour ' + (run.fallbacks) + ' actif(s) : brut utilisé' : '';

  const kpi = kpiCard;
  const kpis = [
    kpi('Dividendes annuels estimés', money(run.total), 'Rythme sur 12 mois à dividendes actuels (estimation)<br>Année ' + y + ' : ' + money(yRec.total) + ' reçus + ' + money(yUp.total) + ' à venir = ' + money(yRec.total + yUp.total) + (netNote ? '<br>' + netNote : ''), 'income'),
    kpi('Reçus depuis le 1er janvier', rec.count ? money(rec.verified.total) : '—', rec.count ? (rec.count - rec.unverified) + ' versement(s) vérifié(s)' + (rec.unverified ? '<br>+ ' + money(rec.unverifiedSum.total) + ' à vérifier (' + rec.unverified + ', générés d\'après l\'historique de marché : voir Historique)' : '') : 'Aucun versement enregistré (voir Historique)', rec.verified.count ? 'income' : ''),
    kpi('Estimés pour ' + MOIS[today.getMonth()].toLowerCase(), money(mSum.total), mEvs.length ? mReceived + ' reçu(s) sur ' + mEvs.length + ' versement(s)' : 'Aucun versement attendu ce mois-ci', 'income'),
    kpi('Prochain dividende', first ? (convert(fa.v, first.currency) === null ? fmtMoney(fa.v, first.currency) : money(convert(fa.v, first.currency))) : '—', first ? esc(first.name || first.ticker) + ' · ' + esc(fmtDate(first.date, { day: 'numeric', month: 'short' })) + '<br>' + esc(kindLabel(first.dateKind, first.status)) : 'Aucun dans les 4 mois', first ? 'income' : ''),
    kpi('Rendement sur coût', yoc.rate === null ? '—' : fmtPct(yoc.rate, 2), yoc.rate === null ? 'Renseignez le prix de revient de vos actifs' : 'Calculé sur ' + yoc.withCost + ' / ' + yoc.payers + ' actif(s) avec prix de revient'),
    kpi('Actifs détenus', String(hs.length), payers + ' versent un dividende' + (missing.length ? ' · ' + missing.length + ' sans données' : '')),
    kpi('Évolution vs année précédente', yo.hasPrev ? fmtPct(yo.pct, 1, true) : '—', yo.hasPrev ? 'Revenus reçus depuis le 1er janvier, comparés à la même période de ' + (y - 1) + (anyUnver ? ' (inclut des versements à vérifier)' : '') : 'Données insuffisantes (historique ' + (y - 1) + ' absent)', yo.hasPrev && yo.pct >= 0 ? 'income' : '')
  ].join('');

  return '<div class="grid kpis">' + kpis + '</div>' + missingNote(allMissing);
}

/* ===============================================================
   MON PORTEFEUILLE
   =============================================================== */
function nextByHolding() {
  const m = {}, today = new Date();
  Engine.nextEvents(state, today, 400, null).forEach((e) => { if (!m[e.holdingId]) m[e.holdingId] = e; });
  return m;
}
/* +/- value d'une ligne (devise de base) ; null si le cours ou le prix de revient manque. */
function gainOf(h) {
  const v = Engine.value(h), i = Engine.invested(h); if (v === null || i === null) return null;
  const cv = convert(v, h.currency), ci = convert(i, Engine.costCur(h)); return cv === null || ci === null ? null : cv - ci;
}
function gainPct(h) {
  const v = Engine.value(h), i = Engine.invested(h); if (v === null || i === null) return null;
  const cv = convert(v, h.currency), ci = convert(i, Engine.costCur(h)); return cv === null || !ci ? null : (cv - ci) / ci;
}
function portfolioColumns(nextMap, wMap, names) {
  const cur = (h, v, d) => v === null || v === undefined ? '—' : fmtMoney(v, h.currency, d === undefined ? {} : { d });
  return [
    { key: 'asset', label: 'Actif', essential: true, sort: (h) => (h.name || h.displayTicker || h.ticker || '').toLowerCase(),
      // logo / initiales seuls (plus de place pour les chiffres) ; le nom reste en infobulle et pour les lecteurs d'écran. Section « À classer » : nom visible.
      html: (h) => { const nm = h.name || h.displayTicker || h.ticker, tk = h.displayTicker || h.ticker; return '<button class="asset' + (names ? '' : ' asset-only') + '" type="button" data-open="' + esc(h.id) + '" title="' + esc(nm + (tk && tk !== nm ? ' · ' + tk : '')) + '">' + avatar(tk, h.logo, '', h.isin) +
        (names ? '<span><span class="nm">' + esc(nm) + '</span><span class="tkr">' + esc(tk) + '</span></span>' : '<span class="sr">' + esc(nm) + '</span>') + '</button>'; } },
    { key: 'account', label: 'Compte', sort: (h) => accountName(h.account), html: (h) => esc(accountName(h.account)) },
    { key: 'type', label: 'Type', sort: (h) => h.type, html: (h) => esc(Engine.TYPES[h.type] || 'Action') },
    { key: 'qty', label: 'Quantité', essential: true, align: 'r', sort: (h) => h.quantity, html: (h) => fmtNum(h.quantity) },
    { key: 'cost', label: 'Prix de revient', align: 'r', sort: (h) => h.avgCost, html: (h) => h.avgCost == null ? '—' : fmtMoney(h.avgCost, Engine.costCur(h)) },
    { key: 'invested', label: 'Investi', essential: true, align: 'r', sort: (h) => Engine.invested(h), html: (h) => Engine.invested(h) == null ? '—' : fmtMoney(Engine.invested(h), Engine.costCur(h)) },
    { key: 'price', label: 'Cours', align: 'r', sort: (h) => h.price, html: (h) => h.price > 0 ? '<span title="' + esc(h.priceAt ? 'Cours du ' + fmtDate(h.priceAt.slice(0, 10)) : '') + '">' + fmtMoney(h.price, h.currency) + '</span>' : '—' },
    { key: 'value', label: 'Valeur', essential: true, align: 'r', sort: (h) => { const v = Engine.value(h); return v === null ? null : convert(v, h.currency); }, html: (h) => cur(h, Engine.value(h)) },
    { key: 'weight', label: 'Poids', align: 'r', sort: (h) => (wMap[h.id] === undefined ? null : wMap[h.id]), html: (h) => wMap[h.id] > 0 ? fmtPct(wMap[h.id], 1) : '—' },
    { key: 'gain', label: '+/- value', align: 'r', sort: (h) => gainOf(h), html: (h) => { const g = gainOf(h); return g === null ? '—' : '<span class="' + (g >= 0 ? 'pos' : 'neg') + '">' + (g >= 0 ? '+' : '') + fmtMoney(g, baseCur()) + '</span>'; } },
    { key: 'gainpct', label: '+/- value (%)', essential: true, align: 'r', sort: (h) => gainPct(h), html: (h) => { const g = gainPct(h); return g === null ? '—' : '<span class="' + (g >= 0 ? 'pos' : 'neg') + '">' + fmtPct(g, 1, true) + '</span>'; } },
    { key: 'yprice', label: 'Rendement / cours', align: 'r', sort: (h) => { const v = Engine.value(h); return v && Engine.isPayer(h) ? Engine.annualPerShare(h) * h.quantity / v : null; }, html: (h) => { const v = Engine.value(h); return v && Engine.isPayer(h) ? fmtPct(Engine.annualPerShare(h) * h.quantity / v, 2) : '—'; } },
    { key: 'currency', label: 'Devise', sort: (h) => h.currency, html: (h) => esc(h.currency) },
    { key: 'perShare', label: 'Dividende / titre', align: 'r', sort: (h) => (h.dividend || {}).lastAmount, html: (h) => cur(h, (h.dividend || {}).lastAmount, 3) },
    { key: 'freq', label: 'Fréquence', sort: (h) => (h.dividend || {}).frequency, html: (h) => Engine.isPayer(h) ? esc(freqLabel(h.dividend.frequency)) : '—' },
    { key: 'annual', label: 'Dividendes annuels est.', essential: true, align: 'r', sort: (h) => Engine.annualPerShare(h) * h.quantity, html: (h) => Engine.isPayer(h) ? '<span class="pos">' + cur(h, Engine.annualPerShare(h) * h.quantity) + '</span>' : '—' },
    { key: 'next', label: 'Prochain versement', essential: true, sort: (h) => nextMap[h.id] ? nextMap[h.id].date : '9999', html: (h) => { const e = nextMap[h.id]; return e ? esc(fmtDate(e.date)) + ' <span class="muted">· ' + esc(kindLabel(e.dateKind, e.status)) + '</span>' : '—'; } },
    { key: 'yoc', label: 'Rendement / coût', align: 'r', sort: (h) => { const i = Engine.invested(h); return i && Engine.isPayer(h) ? Engine.annualPerShare(h) * h.quantity / i : null; }, html: (h) => { const i = Engine.invested(h); return i && Engine.isPayer(h) ? fmtPct(Engine.annualPerShare(h) * h.quantity / i, 2) : '—'; } },
    { key: 'tax', label: 'Retenue (%)', align: 'r', sort: (h) => Engine.taxRate(h), html: (h) => Engine.taxRate(h) === null ? '—' : fmtNum(Engine.taxRate(h), 1) + ' %' },
    { key: 'status', label: 'Données dividende', sort: (h) => Engine.dividendStatus(h), html: (h) => divStatusBadge(Engine.dividendStatus(h)) },
    { key: 'updated', label: 'Mise à jour', sort: (h) => (h.dividend || {}).updatedAt || '', html: (h) => (h.dividend || {}).updatedAt ? esc(fmtDate(h.dividend.updatedAt)) : '—' }
  ];
}
function filteredHoldings() {
  const q = view.port.q.trim().toLowerCase();
  return visibleHoldings().filter((h) => {
    if (q && !((h.name || '') + ' ' + (h.ticker || '') + ' ' + (h.displayTicker || '') + ' ' + (h.isin || '')).toLowerCase().includes(q)) return false;
    if (view.port.type !== 'all' && h.type !== view.port.type) return false;
    if (view.port.div !== 'all') {
      const s = Engine.dividendStatus(h);
      if (view.port.div === 'payer' && s !== 'payer' && s !== 'irregular') return false;
      if (view.port.div === 'none' && s !== 'none' && s !== 'accumulating') return false;
      if (view.port.div === 'missing' && s !== 'missing') return false;
      if (view.port.div === 'accumulating' && s !== 'accumulating') return false;
    }
    return true;
  });
}

/* Bandeau de synthèse : valeur, investi, plus-value (PRU) et rendement total (plus-value + dividendes perçus vérifiés). */
function portfolioSummaryHtml(perf) {
  const ids = visibleIds(), pv = Engine.portfolioValue(state, convert, ids), inv = Engine.investedTotal(state, convert, ids);
  const rec = Engine.receivedBetween(state, '2000-01-01', todayISO(), 'gross', convert, ids), div = rec.verified.total;
  const tr = perf.count && perf.cost > 0 ? (perf.gain + div) / perf.cost : null;
  const cls = (v) => (v >= 0 ? 'pos' : 'neg');
  const mask = !!state.settings.hideNumbers;
  return '<div class="grid kpis sum-strip' + (mask ? ' hide-nums' : '') + '" style="margin-bottom:12px">' +
    kpiCard('Valeur', pv.count ? money(pv.total, 0) : '—', pv.count + ' / ' + visibleHoldings().length + ' actif(s) valorisé(s)') +
    kpiCard('Investi (PRU)', inv.count ? money(inv.cost, 0) : '—', inv.count + ' actif(s) avec PRU') +
    kpiCard('Plus / moins-value', perf.count ? (perf.gain >= 0 ? '+' : '') + money(perf.gain, 0) : '—', perf.count ? fmtPct(perf.pct, 1, true) + ' sur ' + perf.count + ' actif(s) (PRU + cours)' : 'Nécessite le PRU et le cours', perf.count ? cls(perf.gain) === 'pos' ? 'income' : 'neg' : '') +
    kpiCard('Rendement total', tr === null ? '—' : fmtPct(tr, 1, true), tr === null ? 'Plus-value + dividendes perçus' : 'Plus-value + ' + money(div, 0) + ' de dividendes perçus (vérifiés)', tr !== null ? (tr >= 0 ? 'income' : 'neg') : '') + '</div>';
}

/* Bandeau d'alerte : anomalies de l'historique (positions fantômes, quantités négatives, écarts avec les positions réelles…). */
function diagBannerHtml() {
  if (!state.transactions.length) return '';
  const d = Ledger.diagnose(state, { today: todayISO() }), n = d.counts.error;
  return n ? '<div class="notice warn" style="margin-bottom:12px"><span><b>' + n + ' anomalie(s)</b> dans l\'historique des transactions (position absente de vos positions réelles, quantité négative ou écart de quantité).</span><button class="btn sm" type="button" data-do="check-history">Contrôler l\'historique</button></div>' : '';
}
/* Performance des SEULES positions cochées dans les tableaux (sans les autres actifs) : gain de marché + dividendes, apports séparés ; % seulement si l'historique est complet. */
function selectedPortfolioIds() { const out = new Set(); Object.keys(view.tables || {}).forEach((k) => { if (k.indexOf('portfolio-') === 0 && view.tables[k].sel) view.tables[k].sel.forEach((id) => out.add(id)); }); return out; }
function drawSelPerf(host) {
  const box = $('#selPerf', host); if (!box) return;
  const ids = new Set(Array.from(selectedPortfolioIds()).filter((id) => holdingById(id)));
  if (!ids.size) { box.innerHTML = ''; return; }
  const per = view.port.selPer === undefined ? 12 : view.port.selPer, today = new Date(), hist = Engine.portfolioHistory(state, cvAtFor(today), { months: per, today, ids });
  const names = Array.from(ids).map((id) => { const h = holdingById(id); return h.name || h.displayTicker || h.ticker; }), scope = ids.size + ' position' + (ids.size > 1 ? 's' : '') + ' sélectionnée' + (ids.size > 1 ? 's' : '');
  const pf = perfStripHtml({ ids, per, scope, hist, today, showPct: true });
  box.innerHTML = '<section class="card card-pad sel-perf" style="margin-bottom:14px"><div class="card-head"><h3>Performance de la sélection</h3><span class="muted" style="font-size:12px">' + esc(names.slice(0, 4).join(', ')) + (names.length > 4 ? ' et ' + (names.length - 4) + ' autre(s)' : '') + ' · sans les autres actifs</span></div>' +
    '<div class="seg" id="selPerSeg" role="group" aria-label="Période de la sélection" style="margin:2px 0 4px">' + HOME_PERIODS.map((q) => '<button type="button" data-sper="' + q[0] + '" class="' + (per === q[0] ? 'on' : '') + '">' + q[1] + '</button>').join('') + '</div>' + pf.html.replace('<div class="perf-strip"', '<div class="perf-strip" style="border-top:0;padding-top:4px"') + '</section>';
  $$('#selPerSeg [data-sper]', box).forEach((b) => b.onclick = () => { view.port.selPer = Number(b.dataset.sper); drawSelPerf(host); });
}
function renderPortfolio(host) {
  if (view.port.tab === 'ops') return renderOperations(host);
  if (view.port.tab === 'closed') return renderClosed(host);
  if (!state.holdings.length && !(state.archive || []).length && !state.transactions.length) { host.innerHTML = pageHead('Mon portefeuille', 'Vos actifs, quantités et prix de revient') + emptyPortfolio(); wireDo(host); return; }
  const nextMap = nextByHolding();
  const perfAll = Engine.performance(state, convert, visibleIds()), wMap = {}; perfAll.rows.forEach((r) => { if (r.weight !== null) wMap[r.id] = r.weight; });
  const cols = portfolioColumns(nextMap, wMap, false), colsU = portfolioColumns(nextMap, wMap, true);
  colsU.splice(1, 0, { key: 'category', label: 'Classer en', sort: (h) => Engine.category(h), html: (h) => '<select class="cat-sel" data-cat="' + esc(h.id) + '" aria-label="Catégorie de ' + esc(h.name || h.ticker) + '">' + (Engine.category(h) === 'unknown' ? '<option value="" selected>À classer…</option>' : '') +
      Object.keys(Engine.TYPES).map((k) => '<option value="' + k + '"' + (Engine.category(h) !== 'unknown' && h.type === k ? ' selected' : '') + '>' + Engine.TYPES[k] + '</option>').join('') + '</select>' });
  const footer = (rows) => {
    const inv = Engine.investedTotal({ holdings: rows }, convert, null);
    const run = Engine.runRate({ holdings: rows }, 'gross', convert, null);
    const pv = Engine.portfolioValue({ holdings: rows }, convert, null), un = Engine.unrealized({ holdings: rows }, convert, null);
    return { asset: rows.length + ' actif(s)', invested: money(inv.cost, 0), value: money(pv.total, 0), gain: un.count ? '<span class="' + (un.gain >= 0 ? 'pos' : 'neg') + '">' + (un.gain >= 0 ? '+' : '') + money(un.gain, 0) + '</span>' : '—', gainpct: un.pct === null ? '—' : fmtPct(un.pct, 1, true), annual: money(run.total, 0) };
  };
  // trois sections : à classer (si besoin), ETF, actions — la catégorie vient de l'actif (marché, nom) ou de votre choix manuel, jamais « action » par défaut
  const all = filteredHoldings(), SECS = [['unknown', 'À classer', 'Type non identifié : choisissez Action ou ETF dans la colonne « Classer en » (enregistré, jamais écrasé par un import). Cette colonne disparaît une fois l\'actif classé.'], ['etf', 'ETF', ''], ['stock', 'Actions', '']];
  const cfgs = SECS.map((s) => {
    const rows = all.filter((h) => Engine.category(h) === s[0]);
    return { key: s[0], title: s[1], note: s[2], rows, cfg: { id: 'portfolio-' + s[0], prefId: 'portfolio', forceKeys: s[0] === 'unknown' ? ['category'] : [], columns: s[0] === 'unknown' ? colsU : cols, rows, getId: (h) => h.id, selectable: true, sortKey: 'asset', pageSize: 100, deleteLabel: 'Supprimer la sélection',
      onOpen: (id) => openHoldingModal(id), onBulkDelete: (ids) => confirmDeleteHoldings(ids), onSelection: () => drawSelPerf(host), footer,
      empty: '<div class="card empty"><h3>' + (s[0] === 'etf' ? 'Aucun ETF détenu' : 'Aucune action détenue') + '</h3><p>' + (state.holdings.length ? 'Aucun actif de cette catégorie pour les filtres actuels.' : '') + '</p></div>' } };
  }).filter((x) => x.key !== 'unknown' || x.rows.length);
  const secH = (x) => { const pv = Engine.portfolioValue({ holdings: x.rows }, convert, null); return '<section class="port-sec"><div class="port-sec-h"><h2>' + esc(x.title) + '</h2><span class="muted">' + x.rows.length + ' position(s)' + (pv.count ? ' · ' + money(pv.total, 0) : '') + '</span></div>' + (x.note ? '<div class="notice info" style="margin-bottom:8px">' + esc(x.note) + '</div>' : '') + '<div id="tblHost-' + x.key + '"></div></section>'; };
  host.innerHTML = pageHead('Mon portefeuille', state.holdings.length + ' actif(s) · ' + esc(marketLine()),
    '<button class="btn" type="button" data-do="new-account">' + icon('plus') + 'Nouveau portefeuille</button><button class="btn" type="button" data-do="export-csv">' + icon('download') + 'Exporter</button><button class="btn" type="button" data-do="import">' + icon('upload') + 'Importer</button><button class="btn" type="button" data-do="refresh">' + icon('refresh') + 'Actualiser</button><button class="btn primary" type="button" data-do="add">' + icon('plus') + 'Ajouter un actif</button>') +
    diagBannerHtml() + portfolioSummaryHtml(perfAll) +
    '<div class="toolbar">' + portTabsHtml() + '<input type="search" id="pq" placeholder="Rechercher un actif, un ticker, un ISIN…" value="' + esc(view.port.q) + '">' +
    '<select id="pt" aria-label="Type"><option value="all">Tous les types</option>' + Object.keys(Engine.TYPES).map((k) => '<option value="' + k + '" ' + (view.port.type === k ? 'selected' : '') + '>' + Engine.TYPES[k] + '</option>').join('') + '</select>' +
    '<select id="pd" aria-label="Dividendes"><option value="all">Tous les actifs</option><option value="payer">Versent un dividende</option><option value="none">Sans dividende / capitalisants</option><option value="missing">Données manquantes</option></select>' +
    '<span class="grow"></span>' + Tbl.menuHtml(cfgs[cfgs.length - 1].cfg) + '</div><div id="selPerf"></div>' + cfgs.map(secH).join('');
  $('#pd', host).value = view.port.div;
  const draw = () => { const a2 = filteredHoldings(); cfgs.forEach((x) => { x.cfg.rows = a2.filter((h) => Engine.category(h) === x.key); Tbl.render($('#tblHost-' + x.key), x.cfg); }); Tbl.inst['portfolio'] = Tbl.inst[cfgs[cfgs.length - 1].cfg.id]; };
  let t; $('#pq', host).oninput = (e) => { view.port.q = e.target.value; clearTimeout(t); t = setTimeout(draw, 160); };
  $('#pt', host).onchange = (e) => { view.port.type = e.target.value; draw(); };
  $('#pd', host).onchange = (e) => { view.port.div = e.target.value; draw(); };
  wirePortTabs(host); draw(); wireDo(host); drawSelPerf(host);
  // catégorie choisie à la main : enregistrée (typeLocked) et protégée des imports et des actualisations
  host.onchange = (e) => {
    const sel = e.target.closest && e.target.closest('[data-cat]'); if (!sel) return;
    const h = holdingById(sel.dataset.cat); if (!h || !sel.value) return;
    h.type = sel.value; h.typeLocked = true; h.typeSource = 'user'; if (sel.value === 'etf_acc') { h.dividend = h.dividend || {}; h.dividend.none = true; h.dividend.lastAmount = null; h.dividend.frequency = 'none'; }
    saveState(); toast((h.name || h.ticker) + ' : catégorie enregistrée (' + Engine.TYPES[sel.value] + ').'); renderPortfolio(host);
  };
}

/* ===============================================================
   CALENDRIER DES DIVIDENDES
   =============================================================== */
function calEvents(from, to) {
  let evs = Engine.buildEvents(state, from, to, new Date(), visibleIds());
  if (view.cal.asset !== 'all') evs = evs.filter((e) => e.holdingId === view.cal.asset || (e.ticker === view.cal.asset));
  if (view.cal.status !== 'all') evs = evs.filter((e) => e.status === view.cal.status);
  return evs;
}
function eventRowHtml(e) {
  const a = Engine.amount(e, incomeMode());
  return '<div class="list-row">' + avatar(e.ticker, e.logo, '', e.isin) + '<div class="grow"><div><b>' + esc(e.name || e.ticker) + '</b> <span class="muted">' + esc(e.ticker) + '</span></div>' +
    '<div class="muted" style="font-size:12.5px">' + esc(fmtDate(e.date)) + ' · ' + esc(kindLabel(e.dateKind, e.status)) + ' · ' + fmtNum(e.qty) + ' × ' + fmtMoney(e.perShare, e.currency, { d: 3 }) + '</div></div>' +
    '<div style="text-align:right"><div class="amt pos">' + fmtMoney(a.v, e.currency) + '</div>' + statusBadge(e.status, e.verified === false) + '</div></div>';
}
function openDay(dateISO, evs) {
  const m = openModal('<h2>' + esc(fmtDate(dateISO, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })) + '</h2><div class="sub">' + evs.length + ' versement(s)</div>' +
    (evs.length ? evs.map((e, i) => eventRowHtml(e) + (e.status === 'forecast' || e.status === 'unrecorded' || e.status === 'confirmed' ? '<div style="margin:-4px 0 8px 46px"><button class="link-btn" type="button" data-rec="' + i + '">Enregistrer comme reçu</button></div>' : '')).join('') : '<div class="empty">Aucun versement ce jour-là.</div>'));
  $$('[data-rec]', m).forEach((b) => b.onclick = () => { const e = evs[Number(b.dataset.rec)]; closeModal(); openPaymentModal(null, { holdingId: e.holdingId, payDate: e.dateKind === 'pay' ? e.date : '', exDate: e.dateKind === 'ex' ? e.date : '', perShare: e.perShare, qty: e.qty }); });
}
function renderCalendar(host) {
  const c = view.cal, y = c.cursor.getFullYear(), mo = c.cursor.getMonth();
  if (!state.holdings.length) { host.innerHTML = pageHead('Calendrier des dividendes') + emptyPortfolio(); wireDo(host); return; }
  const assets = visibleHoldings().slice().sort((a, b) => (a.name || a.ticker).localeCompare(b.name || b.ticker));
  const head = pageHead('Calendrier des dividendes', 'Versements passés et à venir — les prévisions sont des estimations') +
    '<div class="cal-head"><div class="seg" id="calMode"><button type="button" data-m="month" class="' + (c.mode === 'month' ? 'on' : '') + '">Mois</button><button type="button" data-m="year" class="' + (c.mode === 'year' ? 'on' : '') + '">Année</button><button type="button" data-m="logos" class="' + (c.mode === 'logos' ? 'on' : '') + '">Logos</button></div>' +
    '<div class="btn-row"><button class="btn icon" type="button" id="cPrev" aria-label="Précédent">‹</button><span class="period">' + (c.mode === 'month' ? MOIS[mo] + ' ' + y : y) + '</span><button class="btn icon" type="button" id="cNext" aria-label="Suivant">›</button><button class="btn" type="button" id="cToday">Aujourd\'hui</button></div>' +
    '<span style="flex:1"></span><select id="cAsset" aria-label="Actif" style="width:auto;max-width:200px"><option value="all">Tous les actifs</option>' + assets.map((h) => '<option value="' + esc(h.id) + '">' + esc(h.name || h.displayTicker || h.ticker) + '</option>').join('') + '</select>' +
    '<select id="cStatus" aria-label="Statut" style="width:auto"><option value="all">Tous les statuts</option><option value="received">Reçus</option><option value="confirmed">Confirmés</option><option value="forecast">Estimés</option><option value="unrecorded">Non enregistrés</option></select></div>';
  let body = '';
  if (c.mode === 'month') {
    const evs = calEvents(new Date(y, mo, 1), new Date(y, mo + 1, 0));
    const byDay = {}; evs.forEach((e) => { (byDay[e.date] = byDay[e.date] || []).push(e); });
    const off = (new Date(y, mo, 1).getDay() + 6) % 7, dim = new Date(y, mo + 1, 0).getDate(), t = todayISO();
    let cells = JOURS.map((j) => '<div class="mdow">' + j + '</div>').join('');
    for (let i = 0; i < off; i++) cells += '<div class="mday pad"></div>';
    for (let d = 1; d <= dim; d++) {
      const iso = y + '-' + pad2(mo + 1) + '-' + pad2(d), es = byDay[iso] || [];
      cells += '<button type="button" class="mday ' + (iso === t ? 'today' : '') + '" data-d="' + iso + '"><span class="dn">' + d + '</span><span class="chips">' + es.slice(0, 3).map((e) => '<span class="chip ' + e.status + '" data-tip-hover data-tip="' + esc((e.name || e.ticker) + '\n' + fmtMoney(Engine.amount(e, incomeMode()).v, e.currency) + ' · ' + STATUS_LABEL[e.status] + '\n' + kindLabel(e.dateKind, e.status)) + '">' + avatar(e.ticker, e.logo, 'xs', e.isin) + '<span class="ct">' + esc(e.ticker) + '</span></span>').join('') + (es.length > 3 ? '<span class="muted" style="font-size:11px">+' + (es.length - 3) + '</span>' : '') + '</span></button>';
    }
    const sum = Engine.sumEvents(evs, incomeMode(), convert);
    body = '<div class="month-grid">' + cells + '</div>' +
      '<section class="card card-pad section-gap"><div class="page-head" style="margin-bottom:4px"><h3 style="margin:0">Versements de ' + MOIS[mo].toLowerCase() + '</h3><b class="pos">' + money(sum.total) + '</b></div>' +
      (evs.length ? evs.map(eventRowHtml).join('') : '<div class="empty">Aucun versement ce mois-ci avec ces filtres.</div>') + missingNote(sum.missing) + '</section>';
    host.innerHTML = head + body;
    $$('.mday[data-d]', host).forEach((b) => b.onclick = () => openDay(b.dataset.d, byDay[b.dataset.d] || []));
  } else if (c.mode === 'year') {
    const evs = calEvents(new Date(y, 0, 1), new Date(y, 11, 31)), byDay = {};
    evs.forEach((e) => { (byDay[e.date] = byDay[e.date] || []).push(e); });
    const t = todayISO();
    body = '<div class="year-grid">' + MOIS.map((nm, m) => {
      const off = (new Date(y, m, 1).getDay() + 6) % 7, dim = new Date(y, m + 1, 0).getDate();
      let cells = JOURS.map((j) => '<div class="d" style="font-weight:700">' + j[0] + '</div>').join('') + '<div></div>'.repeat(off);
      let tot = 0;
      for (let d = 1; d <= dim; d++) {
        const iso = y + '-' + pad2(m + 1) + '-' + pad2(d), es = byDay[iso] || [];
        const onlyF = es.length && es.every((e) => e.status === 'forecast');
        cells += '<div class="d ' + (es.length ? 'has ' : '') + (onlyF ? 'forecast ' : '') + (iso === t ? 'today' : '') + '" ' + (es.length ? 'data-d="' + iso + '"' : '') + '>' + d + (es.length ? '<span class="dl">' + es.slice(0, 2).map((e) => avatar(e.ticker, e.logo, 'xs', e.isin)).join('') + '</span>' : '') + '</div>';
      }
      const ms = Engine.sumEvents(evs.filter((e) => Number(e.date.slice(5, 7)) === m + 1), incomeMode(), convert);
      return '<div class="card mini" data-month="' + m + '"><h4><span>' + nm + '</span><span class="pos">' + (ms.count ? money(ms.total, 0) : '') + '</span></h4><div class="mini-grid">' + cells + '</div></div>';
    }).join('') + '</div>';
    host.innerHTML = head + body;
    $$('.mini', host).forEach((el) => el.addEventListener('click', (e) => { const d = e.target.closest('[data-d]'); if (d) { openDay(d.dataset.d, byDay[d.dataset.d] || []); return; } c.mode = 'month'; c.cursor = new Date(y, Number(el.dataset.month), 1); renderCalendar(host); }));
  } else {
    const evs = calEvents(new Date(y, 0, 1), new Date(y, 11, 31)), byM = Array.from({ length: 12 }, () => []);
    evs.forEach((e) => byM[Number(e.date.slice(5, 7)) - 1].push(e));
    body = '<div class="logo-grid">' + MOIS.map((nm, m) => '<div class="card logo-month"><h4>' + nm + '</h4>' + (byM[m].length ? '<div class="logo-items">' + byM[m].map((e, i) => '<span class="' + (e.status === 'forecast' ? 'forecast' : '') + '" data-d="' + e.date + '" data-tip-hover data-tip="' + esc((e.name || e.ticker) + '\n' + fmtMoney(Engine.amount(e, incomeMode()).v, e.currency) + '\n' + fmtDate(e.date) + ' · ' + STATUS_LABEL[e.status]) + '">' + avatar(e.ticker, e.logo, '', e.isin) + '</span>').join('') + '</div>' : '<div class="muted">Aucun versement</div>') + '</div>').join('') + '</div>';
    host.innerHTML = head + body;
    const byDay = {}; evs.forEach((e) => { (byDay[e.date] = byDay[e.date] || []).push(e); });
    $$('.logo-items [data-d]', host).forEach((b) => b.onclick = () => openDay(b.dataset.d, byDay[b.dataset.d] || []));
  }
  $$('#calMode [data-m]', host).forEach((b) => b.onclick = () => { c.mode = b.dataset.m; renderCalendar(host); });
  const nav = (n) => { c.cursor = c.mode === 'month' ? new Date(y, mo + n, 1) : new Date(y + n, mo, 1); renderCalendar(host); };
  $('#cPrev', host).onclick = () => nav(-1); $('#cNext', host).onclick = () => nav(1);
  $('#cToday', host).onclick = () => { c.cursor = new Date(); renderCalendar(host); };
  $('#cAsset', host).value = c.asset; $('#cStatus', host).value = c.status;
  $('#cAsset', host).onchange = (e) => { c.asset = e.target.value; renderCalendar(host); };
  $('#cStatus', host).onchange = (e) => { c.status = e.target.value; renderCalendar(host); };
  wireDo(host);
}

/* ===============================================================
   HISTORIQUE (versements reçus + opérations)
   =============================================================== */
function paymentRows() {
  const ids = visibleIds(), h = view.hist;
  return state.payments.filter((p) => {
    if (ids && !ids.has(p.holdingId)) return false;
    const d = p.payDate || p.exDate || '';
    if (h.year !== 'all' && d.slice(0, 4) !== h.year) return false;
    if (h.month !== 'all' && d.slice(5, 7) !== h.month) return false;
    if (h.asset !== 'all' && p.holdingId !== h.asset) return false;
    if (h.status === 'verified' && (p.verified === false || p.estimated)) return false;
    if (h.status === 'received' && (p.verified === false || p.estimated)) return false;
    if (h.status === 'estimated' && !p.estimated) return false;
    if (h.status === 'unverified' && p.verified !== false) return false;
    return true;
  });
}
function paymentColumns() {
  const c = (p, v) => v === null || v === undefined ? '—' : fmtMoney(v, p.currency);
  return [
    { key: 'date', label: 'Date de paiement', essential: true, sort: (p) => p.payDate || p.exDate || '', html: (p) => p.payDate ? esc(fmtDate(p.payDate)) : '<span class="muted">' + esc(fmtDate(p.exDate)) + ' (détach.)</span>' },
    { key: 'asset', label: 'Actif', essential: true, sort: (p) => (p.name || p.ticker || '').toLowerCase(), html: (p) => { const h = holdingById(p.holdingId); return '<button class="asset" type="button" data-open="' + esc(p.id) + '">' + avatar(p.ticker, h && h.logo, 'sm', h && h.isin) + '<span><span class="nm">' + esc(p.name || p.ticker) + '</span><span class="tkr">' + esc(p.ticker) + '</span></span></button>'; } },
    { key: 'qty', label: 'Quantité', align: 'r', sort: (p) => p.qty, html: (p) => fmtNum(p.qty) },
    { key: 'perShare', label: 'Par titre', align: 'r', sort: (p) => p.perShare, html: (p) => p.perShare ? fmtMoney(p.perShare, p.currency, { d: 4 }) : '—' },
    { key: 'gross', label: 'Brut', essential: true, align: 'r', sort: (p) => p.gross, html: (p) => c(p, p.gross) },
    { key: 'tax', label: 'Retenue', align: 'r', sort: (p) => p.tax, html: (p) => c(p, p.tax) },
    { key: 'fees', label: 'Frais', align: 'r', sort: (p) => p.fees, html: (p) => c(p, p.fees) },
    { key: 'net', label: 'Net', essential: true, align: 'r', sort: (p) => p.net, html: (p) => p.net == null ? '<span class="muted" title="Net inconnu">—</span>' : '<b class="pos">' + c(p, p.net) + '</b>' },
    { key: 'ex', label: 'Détachement', sort: (p) => p.exDate || '', html: (p) => esc(fmtDate(p.exDate)) },
    { key: 'currency', label: 'Devise', sort: (p) => p.currency, html: (p) => esc(p.currency) },
    { key: 'status', label: 'Statut', essential: true, sort: (p) => (p.verified === false ? 1 : 0), html: (p) => (p.estimated && p.verified === false ? '<span class="badge warn" title="Estimation non confirmée par le relevé de compte : ne compte pas dans vos revenus">À vérifier</span>' : p.estimated ? '<span class="badge warn" title="Reconstitué d\'après vos opérations et l\'historique de marché : date de paiement et retenues non confirmées">Estimé</span>' : statusBadge('received', p.verified === false)) },
    { key: 'source', label: 'Source', sort: (p) => p.source, html: (p) => esc({ manual: 'Saisie', csv: 'Import CSV', degiro: 'Relevé DEGIRO (confirmé)', auto: 'Historique de marché', 'market-history': 'Historique de marché (estimé)' }[p.source] || p.source || '—') }
  ];
}
function txRows() {
  const ids = visibleIds(), h = view.hist;
  return state.transactions.filter((t) => {
    if (ids && !ids.has(t.holdingId)) return false;
    if (h.year !== 'all' && (t.date || '').slice(0, 4) !== h.year) return false;
    if (h.month !== 'all' && (t.date || '').slice(5, 7) !== h.month) return false;
    if (h.asset !== 'all' && t.holdingId !== h.asset) return false;
    return true;
  });
}
function txColumns() {
  return [
    { key: 'date', label: 'Date', essential: true, sort: (t) => t.date, html: (t) => esc(fmtDate(t.date)) },
    { key: 'type', label: 'Opération', essential: true, sort: (t) => t.type, html: (t) => t.opening ? '<span class="badge info" title="Quantité détenue au prix de revient saisi">Ouverture</span>' : t.corp ? '<span class="badge info">' + (t.type === 'buy' ? 'Livraison gratuite' : 'Retrait de titres') + '</span>' : t.type === 'buy' ? '<span class="badge received">Achat</span>' : '<span class="badge warn">Vente</span>' },
    { key: 'asset', label: 'Actif', essential: true, sort: (t) => (t.name || t.ticker || '').toLowerCase(), html: (t) => { const h = holdingById(t.holdingId); return '<span class="asset">' + avatar(t.ticker, h && h.logo, 'sm', h && h.isin) + '<span><span class="nm">' + esc(t.name || t.ticker) + '</span><span class="tkr">' + esc(t.ticker) + '</span></span></span>'; } },
    { key: 'qty', label: 'Quantité', essential: true, align: 'r', sort: (t) => t.qty, html: (t) => fmtNum(t.qty) },
    { key: 'price', label: 'Prix', align: 'r', sort: (t) => t.price, html: (t) => (t.price == null ? '<span class="muted" title="Prix non saisi">—</span>' : fmtMoney(t.price, t.currency, { d: 4 })) },
    { key: 'amount', label: 'Montant', essential: true, align: 'r', sort: (t) => (t.price == null ? null : t.qty * t.price), html: (t) => (t.price == null ? '<span class="muted">—</span>' : fmtMoney(t.qty * t.price, t.currency)) },
    { key: 'fees', label: 'Frais', align: 'r', sort: (t) => t.fees, html: (t) => t.fees ? fmtMoney(t.fees, t.currency) : '—' },
    { key: 'currency', label: 'Devise', html: (t) => esc(t.currency) },
    { key: 'source', label: 'Source', html: (t) => esc(t.source === 'csv' ? 'Import CSV' : 'Saisie') }
  ];
}

function renderHistory(host) {
  const h = view.hist;
  const years = Array.from(new Set(state.payments.map((p) => (p.payDate || p.exDate || '').slice(0, 4)).concat(state.transactions.map((t) => (t.date || '').slice(0, 4))).filter(Boolean))).sort().reverse();
  const assets = visibleHoldings().slice().sort((a, b) => (a.name || a.ticker).localeCompare(b.name || b.ticker));
  const isPay = h.tab === 'payments';
  const cfg = isPay
    ? { id: 'history', columns: paymentColumns(), rows: paymentRows(), getId: (p) => p.id, selectable: true, sortKey: 'date', sortDir: -1, deleteLabel: 'Supprimer la sélection', onOpen: (id) => openPaymentModal(id), onBulkDelete: (ids) => confirmDeletePayments(ids),
      empty: '<div class="card empty"><h3>Aucun versement enregistré</h3><p>Saisissez vos dividendes reçus, importez vos transactions (Trade Republic…) ou pré-remplissez l\'historique d\'après les dates passées.</p><div class="btn-row" style="justify-content:center"><button class="btn primary" data-do="add-payment" type="button">' + icon('plus') + 'Ajouter un versement</button><button class="btn" data-do="import-tx" type="button">' + icon('upload') + 'Importer des transactions</button><button class="btn" data-do="prefill" type="button">Pré-remplir depuis l\'historique</button></div></div>',
      footer: (rows) => {
        const ev = rows.map((p) => ({ currency: p.currency || 'EUR', gross: Number(p.gross) || 0, net: p.net == null ? null : Number(p.net), tax: p.tax }));
        const g = Engine.sumEvents(ev, 'gross', convert), n = Engine.sumEvents(ev, 'net', convert);
        const tx = Engine.sumEvents(rows.filter((p) => p.tax != null).map((p) => ({ currency: p.currency || 'EUR', gross: Math.abs(Number(p.tax)) })), 'gross', convert);
        return { date: rows.length + ' versement(s)', gross: money(g.total), tax: money(tx.total), net: money(n.total) + (n.fallbacks ? '*' : '') };
      } }
    : { id: 'transactions', columns: txColumns(), rows: txRows(), getId: (t) => t.id, selectable: true, sortKey: 'date', sortDir: -1, deleteLabel: 'Supprimer la sélection', onBulkDelete: (ids) => confirmDeleteTransactions(ids),
      empty: '<div class="card empty"><h3>Aucune opération enregistrée</h3><p>Importez vos transactions (CSV Trade Republic ou autre) pour reconstituer vos achats, ventes et prix de revient.</p><button class="btn primary" data-do="import-tx" type="button">' + icon('upload') + 'Importer des transactions</button></div>' };
  const unver = state.payments.filter((p) => p.verified === false).length;
  host.innerHTML = pageHead('Historique', 'Dividendes effectivement reçus et opérations associées',
    '<button class="btn" type="button" data-do="import-tx">' + icon('upload') + 'Importer</button>' + (isPay ? '<button class="btn primary" type="button" data-do="add-payment">' + icon('plus') + 'Ajouter un versement</button>' : '')) +
    '<div class="toolbar"><div class="seg" id="hTab"><button type="button" data-t="payments" class="' + (isPay ? 'on' : '') + '">Dividendes reçus</button><button type="button" data-t="transactions" class="' + (!isPay ? 'on' : '') + '">Opérations</button></div>' +
    '<select id="hYear" aria-label="Année" style="width:auto"><option value="all">Toutes les années</option>' + years.map((y) => '<option value="' + y + '">' + y + '</option>').join('') + '</select>' +
    '<select id="hMonth" aria-label="Mois" style="width:auto"><option value="all">Tous les mois</option>' + MOIS.map((m, i) => '<option value="' + pad2(i + 1) + '">' + m + '</option>').join('') + '</select>' +
    '<select id="hAsset" aria-label="Actif" style="width:auto;max-width:180px"><option value="all">Tous les actifs</option>' + assets.map((a) => '<option value="' + esc(a.id) + '">' + esc(a.name || a.displayTicker || a.ticker) + '</option>').join('') + '</select>' +
    (isPay ? '<select id="hStatus" aria-label="Statut" style="width:auto"><option value="all">Tous les statuts</option><option value="verified">Effectivement reçus (confirmés)</option><option value="estimated">Estimés (historique de marché)</option><option value="unverified">À vérifier</option></select>' : '') +
    '<span class="grow"></span>' + (isPay ? '<button class="btn" type="button" data-do="div-history">' + icon('refresh') + 'Rechercher les dividendes passés</button><button class="btn" type="button" data-do="prefill">Pré-remplir</button>' : '') + Tbl.menuHtml(cfg) + '</div>' +
    (isPay && state.transactions.some((t) => t.type === 'buy') && state.settings.relayUrl && !state.payments.some((p) => p.estimated || p.source === 'degiro') ? '<div class="notice info" style="margin-bottom:10px"><span><b>Complétez vos dividendes passés.</b> L\'application connaît vos achats et ventes datés : elle peut retrouver les dividendes versés aux dates où vous déteniez chaque titre (positions détenues et clôturées) et les ajouter après votre vérification.</span><button class="btn sm primary" type="button" data-do="div-history">Rechercher les dividendes passés</button></div>' : '') +
    (isPay && unver ? '<div class="notice info" style="margin-bottom:10px">' + unver + ' versement(s) générés d\'après l\'historique de marché sont marqués « À vérifier » : ouvrez-les pour confirmer le montant réel (retenue, frais), ou acceptez-les tels quels : <button class="btn sm" type="button" data-do="validate-all" style="margin-left:6px">Tout valider</button></div>' : '') +
    '<div id="tblHost"></div>' + (isPay ? '<p class="hint" style="margin-top:8px">Le net marqué * est incomplet : les versements sans net connu sont comptés en brut.</p>' : '');
  $('#hYear', host).value = h.year; $('#hMonth', host).value = h.month; $('#hAsset', host).value = h.asset; if (isPay) $('#hStatus', host).value = h.status;
  ['hYear:year', 'hMonth:month', 'hAsset:asset', 'hStatus:status'].forEach((x) => { const [id, k] = x.split(':'); const el = $('#' + id, host); if (el) el.onchange = (e) => { h[k] = e.target.value; renderHistory(host); }; });
  $$('#hTab [data-t]', host).forEach((b) => b.onclick = () => { h.tab = b.dataset.t; renderHistory(host); });
  Tbl.render($('#tblHost'), cfg); wireDo(host);
}

/* ===============================================================
   STATISTIQUES
   =============================================================== */
function renderStats(host) {
  if (!state.holdings.length) { host.innerHTML = pageHead('Statistiques', 'Évolution des revenus et prévisions') + emptyPortfolio(); wireDo(host); return; }
  const today = new Date(), mode = incomeMode(), ids = visibleIds(), y = view.stats.year;
  const series = Engine.monthlySeries(state, y, mode, convert, today, ids);
  const dist = Engine.distribution(state, mode, convert, ids, 9);
  const f12 = Engine.forecast12(state, mode, convert, today, ids);
  const yearly = Engine.yearlySeries(state, mode, convert, ids);
  const run = Engine.runRate(state, mode, convert, ids);
  const f12Total = f12.reduce((s, x) => s + x.value, 0);
  const top = run.per.slice().sort((a, b) => b.value - a.value).slice(0, 10);
  const acc = visibleHoldings().filter((h) => Engine.isAccumulating(h));
  host.innerHTML = pageHead('Statistiques', 'Évolution des revenus et prévisions · montants en ' + esc(baseCur()), modeSeg()) +
    dividendKpisHtml() + '<div class="grid two even section-gap">' +
    '<section class="card card-pad"><div class="page-head" style="margin-bottom:6px"><h3 style="margin:0">Revenus mensuels ' + y + '</h3><div class="btn-row"><button class="btn sm icon" type="button" data-yr="-1" aria-label="Année précédente">‹</button><button class="btn sm icon" type="button" data-yr="1" aria-label="Année suivante">›</button></div></div>' +
    stackedBars({ labels: MOIS_C, cur: baseCur(), title: 'Revenus mensuels', layers: [{ name: 'Reçus', color: 'var(--chart-1)', values: series.received }, { name: 'À vérifier', color: 'var(--chart-3)', values: series.unverified }, { name: 'À venir (estimés / confirmés)', color: 'var(--chart-1)', faded: true, values: series.upcoming }, { name: 'Non enregistrés', color: 'var(--warn)', dashed: true, values: series.unrecorded }] }) + '</section>' +
    '<section class="card card-pad"><h3>Répartition par actif (revenu annuel estimé)</h3>' + (dist.total ? donut(dist.items, baseCur()) : '<div class="muted">Aucune prévision disponible.</div>') + '</section></div>' +
    '<div class="grid two even section-gap">' +
    '<section class="card card-pad"><h3>Prévision des 12 prochains mois <span class="muted" style="font-weight:500">· ' + money(f12Total, 0) + '</span></h3>' +
    stackedBars({ labels: f12.map((m) => MOIS_C[m.month]), cur: baseCur(), title: 'Prévision 12 mois', layers: [{ name: 'Confirmé / reçu', color: 'var(--chart-1)', values: f12.map((m) => m.confirmed) }, { name: 'Estimé', color: 'var(--chart-1)', faded: true, values: f12.map((m) => m.value - m.confirmed) }] }) + '</section>' +
    '<section class="card card-pad"><h3>Dividendes reçus par année</h3>' + (yearly.length ? stackedBars({ labels: yearly.map((x) => String(x.year)), cur: baseCur(), title: 'Dividendes reçus par année', layers: [{ name: 'Reçus (vérifiés)', color: 'var(--chart-1)', values: yearly.map((x) => x.verified) }, { name: 'À vérifier', color: 'var(--chart-3)', values: yearly.map((x) => x.unverified) }] }) : '<div class="muted">Aucun versement enregistré : saisissez-les ou importez vos transactions (Historique).</div>') + '</section></div>' +
    missingNote(run.missing) +
    '<section class="card card-pad section-gap"><h3>Principaux contributeurs</h3>' + (top.length ? '<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Actif</th><th class="r">Revenu annuel est.</th><th class="r">Part</th></tr></thead><tbody>' + top.map((t) => '<tr><td><b>' + esc(t.name || t.ticker) + '</b> <span class="muted">' + esc(t.ticker) + '</span></td><td class="r">' + money(t.value) + '</td><td class="r">' + fmtPct(run.total ? t.value / run.total : 0, 1) + '</td></tr>').join('') + '</tbody></table></div>' : '<div class="muted">Aucun actif ne verse de dividende.</div>') + '</section>' +
    (acc.length ? '<section class="card card-pad section-gap"><h3>ETF capitalisants (aucun dividende versé)</h3><div class="muted">' + acc.map((h) => esc(h.name || h.displayTicker || h.ticker)).join(' · ') + '</div></section>' : '');
  wireMode(host); wireDo(host);
  $$('[data-yr]', host).forEach((b) => b.onclick = () => { view.stats.year += Number(b.dataset.yr); renderStats(host); });
}
