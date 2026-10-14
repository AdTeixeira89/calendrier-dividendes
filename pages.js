/* ==================================================================
   pages.js — Accueil, Mon portefeuille, Calendrier, Historique, Statistiques.
   ================================================================== */

const FREQ_LABEL = { monthly: 'Mensuelle', quarterly: 'Trimestrielle', semiannual: 'Semestrielle', annual: 'Annuelle', irregular: 'Irrégulière', none: 'Aucune' };
const freqLabel = (f) => FREQ_LABEL[f] || '—';

function pageHead(title, sub, actions) {
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
    else if (a === 'refresh') refreshMarket(visibleHoldings());
    else if (a === 'add-payment') openPaymentModal(null);
    else if (a === 'settings') go('settings');
    else if (a === 'prefill') runPrefill();
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

function renderHome(host) {
  const today = new Date(), mode = incomeMode(), ids = visibleIds(), y = today.getFullYear();
  if (!state.holdings.length) { host.innerHTML = pageHead('Accueil', 'Résumé de votre portefeuille de dividendes') + emptyPortfolio(); wireDo(host); return; }
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
  const mask = !!state.settings.hideNumbers;
  const hs = visibleHoldings();
  const payers = hs.filter((h) => Engine.isPayer(h)).length;
  const missing = hs.filter((h) => Engine.dividendStatus(h) === 'missing');
  const first = next[0];
  const fa = first ? Engine.amount(first, mode) : null;
  const allMissing = Array.from(new Set([].concat(run.missing, rec.missing, mSum.missing)));
  const netNote = mode === 'net' && (run.fallbacks || mSum.fallbacks) ? 'Net inconnu pour ' + (run.fallbacks) + ' actif(s) : brut utilisé' : '';

  const kpi = (label, val, sub, cls) => '<div class="card kpi"><div class="lbl">' + label + '</div><div class="val ' + (cls || '') + '">' + val + '</div><div class="sub">' + (sub || '') + '</div></div>';
  const kpis = [
    kpi('Dividendes annuels estimés', money(run.total), 'Rythme sur 12 mois à dividendes actuels (estimation)<br>Année ' + y + ' : ' + money(yRec.total) + ' reçus + ' + money(yUp.total) + ' à venir = ' + money(yRec.total + yUp.total) + (netNote ? '<br>' + netNote : ''), 'income'),
    kpi('Reçus depuis le 1er janvier', rec.count ? money(rec.verified.total) : '—', rec.count ? (rec.count - rec.unverified) + ' versement(s) vérifié(s)' + (rec.unverified ? '<br>+ ' + money(rec.unverifiedSum.total) + ' à vérifier (' + rec.unverified + ', générés d\'après l\'historique de marché : voir Historique)' : '') : 'Aucun versement enregistré (voir Historique)', rec.verified.count ? 'income' : ''),
    kpi('Estimés pour ' + MOIS[today.getMonth()].toLowerCase(), money(mSum.total), mEvs.length ? mReceived + ' reçu(s) sur ' + mEvs.length + ' versement(s)' : 'Aucun versement attendu ce mois-ci', 'income'),
    kpi('Prochain dividende', first ? (convert(fa.v, first.currency) === null ? fmtMoney(fa.v, first.currency) : money(convert(fa.v, first.currency))) : '—', first ? esc(first.name || first.ticker) + ' · ' + esc(fmtDate(first.date, { day: 'numeric', month: 'short' })) + '<br>' + esc(kindLabel(first.dateKind, first.status)) : 'Aucun dans les 4 mois', first ? 'income' : ''),
    kpi('Rendement sur coût', yoc.rate === null ? '—' : fmtPct(yoc.rate, 2), yoc.rate === null ? 'Renseignez le prix de revient de vos actifs' : 'Calculé sur ' + yoc.withCost + ' / ' + yoc.payers + ' actif(s) avec prix de revient'),
    kpi('Actifs détenus', String(hs.length), payers + ' versent un dividende' + (missing.length ? ' · ' + missing.length + ' sans données' : '')),
    kpi('Évolution vs année précédente', yo.hasPrev ? fmtPct(yo.pct, 1, true) : '—', yo.hasPrev ? 'Revenus reçus depuis le 1er janvier, comparés à la même période de ' + (y - 1) + (anyUnver ? ' (inclut des versements à vérifier)' : '') : 'Données insuffisantes (historique ' + (y - 1) + ' absent)', yo.hasPrev && yo.pct >= 0 ? 'income' : '')
  ].join('');

  const pv = Engine.portfolioValue(state, convert, ids), un = Engine.unrealized(state, convert, ids), yp = Engine.yieldOnPrice(state, convert, ids);
  const priced = pv.count ? '' : ' — actualisez les données pour obtenir les cours';
  const kpisV = [
    kpi('Valeur du portefeuille', pv.count ? money(pv.total, 0) : '—', pv.count ? (pv.latest ? 'Cours du ' + esc(fmtDate(pv.latest.slice(0, 10))) + ' · ' : '') + pv.count + ' / ' + pv.of + ' actif(s) valorisé(s)' : 'Aucun cours disponible' + priced),
    kpi('Plus / moins-value latente', un.count ? (un.gain >= 0 ? '+' : '') + money(un.gain, 0) : '—', un.count ? fmtPct(un.pct, 1, true) + ' sur ' + money(un.cost, 0) + ' investis (' + un.count + ' actif(s) avec PRU et cours)' : 'Nécessite le prix de revient et le cours', un.count ? (un.gain >= 0 ? 'income' : 'neg') : ''),
    kpi('Rendement sur cours', yp.rate === null ? '—' : fmtPct(yp.rate, 2), yp.rate === null ? 'Nécessite des cours et des dividendes' : 'Dividendes annuels estimés ÷ valeur actuelle (' + yp.count + ' actif(s))')
  ].join('');
  const series = Engine.monthlySeries(state, view.home.year, mode, convert, today, ids);
  const dist = Engine.distribution(state, mode, convert, ids, 7);
  const warn = missing.length ? '<div class="notice"><span><b>' + missing.length + ' actif(s) sans données de dividende</b> (' + missing.slice(0, 4).map((h) => esc(h.displayTicker || h.ticker)).join(', ') + (missing.length > 4 ? '…' : '') + '). Ils ne sont pas comptés dans les prévisions.</span><button class="btn sm" type="button" data-do="refresh">' + icon('refresh') + 'Actualiser les données</button></div>' : '';

  host.innerHTML = pageHead('Accueil', esc(marketLine()) + ' · montants en ' + esc(baseCur()), '<button class="btn icon" type="button" id="eyeBtn" aria-pressed="' + mask + '" title="' + (mask ? 'Afficher les chiffres' : 'Masquer les chiffres') + '" aria-label="' + (mask ? 'Afficher les chiffres' : 'Masquer les chiffres') + '">' + icon(mask ? 'eyeoff' : 'eye') + '</button>' + modeSeg()) +
    '<div class="home-body' + (mask ? ' hide-nums' : '') + '"><section class="ticker"><div class="ticker-head"><h2>Prochains versements</h2><span class="muted">≈ estimé · survolez ou touchez un versement pour le détail</span></div>' + tickerHtml(next, mask) + '</section>' +
    '<div class="grid two section-gap">' +
    '<section class="card card-pad"><div class="page-head" style="margin-bottom:6px"><h3 style="margin:0">Revenus mensuels ' + view.home.year + '</h3><div class="btn-row"><button class="btn sm icon" type="button" data-yr="-1" aria-label="Année précédente">‹</button><button class="btn sm icon" type="button" data-yr="1" aria-label="Année suivante">›</button></div></div>' +
    stackedBars({ labels: MOIS_C, cur: baseCur(), title: 'Revenus mensuels', mask, layers: [{ name: 'Reçus', color: 'var(--chart-1)', values: series.received }, { name: 'À vérifier', color: 'var(--chart-3)', values: series.unverified }, { name: 'À venir (estimés / confirmés)', color: 'var(--chart-1)', faded: true, values: series.upcoming }, { name: 'Non enregistrés', color: 'var(--warn)', dashed: true, values: series.unrecorded }] }) + '</section>' +
    '<section class="card card-pad"><h3>Répartition du revenu annuel estimé</h3>' + (dist.total ? donut(dist.items, baseCur(), mask) : '<div class="muted">Aucune prévision disponible.</div>') + '</section></div>' +
    '<div class="grid kpis section-gap">' + kpis + '</div><h2 class="section-h">Valeur du portefeuille</h2><div class="grid kpis">' + kpisV + '</div>' + missingNote(allMissing.concat(pv.missing)) + (warn ? '<div class="section-gap">' + warn + '</div>' : '') +
    '</div>';
  wireMode(host); wireDo(host);
  $$('[data-yr]', host).forEach((b) => b.onclick = () => { view.home.year += Number(b.dataset.yr); renderHome(host); });
  $('#eyeBtn', host).onclick = () => { state.settings.hideNumbers = !state.settings.hideNumbers; saveState(); renderHome(host); };
  const tr = $('#tickerTrack', host);
  if (tr) tr.addEventListener('click', (e) => { const c = e.target.closest('.tk-chip'); if (!c) return; const ev = next[Number(c.dataset.i)]; if (ev) openDay(ev.date, next.filter((x) => x.date === ev.date)); });
  startTickerScroll(tr);
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
function portfolioColumns(nextMap) {
  const cur = (h, v, d) => v === null || v === undefined ? '—' : fmtMoney(v, h.currency, d === undefined ? {} : { d });
  return [
    { key: 'asset', label: 'Actif', essential: true, sort: (h) => (h.name || h.displayTicker || h.ticker || '').toLowerCase(),
      html: (h) => '<button class="asset" type="button" data-open="' + esc(h.id) + '">' + avatar(h.displayTicker || h.ticker, h.logo, '', h.isin) + '<span><span class="nm">' + esc(h.name || h.displayTicker || h.ticker) + '</span><span class="tkr">' + esc(h.displayTicker || h.ticker) + '</span></span></button>' },
    { key: 'account', label: 'Compte', sort: (h) => accountName(h.account), html: (h) => esc(accountName(h.account)) },
    { key: 'type', label: 'Type', sort: (h) => h.type, html: (h) => esc(Engine.TYPES[h.type] || 'Action') },
    { key: 'qty', label: 'Quantité', essential: true, align: 'r', sort: (h) => h.quantity, html: (h) => fmtNum(h.quantity) },
    { key: 'cost', label: 'Prix de revient', align: 'r', sort: (h) => h.avgCost, html: (h) => h.avgCost == null ? '—' : fmtMoney(h.avgCost, Engine.costCur(h)) },
    { key: 'invested', label: 'Investi', essential: true, align: 'r', sort: (h) => Engine.invested(h), html: (h) => Engine.invested(h) == null ? '—' : fmtMoney(Engine.invested(h), Engine.costCur(h)) },
    { key: 'price', label: 'Cours', align: 'r', sort: (h) => h.price, html: (h) => h.price > 0 ? '<span title="' + esc(h.priceAt ? 'Cours du ' + fmtDate(h.priceAt.slice(0, 10)) : '') + '">' + fmtMoney(h.price, h.currency) + '</span>' : '—' },
    { key: 'value', label: 'Valeur', essential: true, align: 'r', sort: (h) => { const v = Engine.value(h); return v === null ? null : convert(v, h.currency); }, html: (h) => cur(h, Engine.value(h)) },
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

function renderPortfolio(host) {
  if (!state.holdings.length) { host.innerHTML = pageHead('Mon portefeuille', 'Vos actifs, quantités et prix de revient') + emptyPortfolio(); wireDo(host); return; }
  const nextMap = nextByHolding();
  const cols = portfolioColumns(nextMap);
  const cfg = { id: 'portfolio', columns: cols, rows: [], getId: (h) => h.id, selectable: true, sortKey: 'asset', pageSize: 100, deleteLabel: 'Supprimer la sélection',
    onOpen: (id) => openHoldingModal(id), onBulkDelete: (ids) => confirmDeleteHoldings(ids),
    empty: '<div class="card empty"><h3>Aucun actif ne correspond</h3><p>Modifiez la recherche ou les filtres.</p></div>',
    footer: (rows) => {
      const inv = Engine.investedTotal({ holdings: rows }, convert, null);
      const run = Engine.runRate({ holdings: rows }, 'gross', convert, null);
      const pv = Engine.portfolioValue({ holdings: rows }, convert, null), un = Engine.unrealized({ holdings: rows }, convert, null);
      return { asset: rows.length + ' actif(s)', invested: money(inv.cost, 0), value: money(pv.total, 0), gain: un.count ? '<span class="' + (un.gain >= 0 ? 'pos' : 'neg') + '">' + (un.gain >= 0 ? '+' : '') + money(un.gain, 0) + '</span>' : '—', gainpct: un.pct === null ? '—' : fmtPct(un.pct, 1, true), annual: money(run.total, 0) };
    } };
  cfg.rows = filteredHoldings();
  host.innerHTML = pageHead('Mon portefeuille', state.holdings.length + ' actif(s) · ' + esc(marketLine()),
    '<button class="btn" type="button" data-do="import">' + icon('upload') + 'Importer</button><button class="btn" type="button" data-do="refresh">' + icon('refresh') + 'Actualiser</button><button class="btn primary" type="button" data-do="add">' + icon('plus') + 'Ajouter</button>') +
    '<div class="toolbar"><input type="search" id="pq" placeholder="Rechercher un actif, un ticker, un ISIN…" value="' + esc(view.port.q) + '">' +
    '<select id="pt" aria-label="Type"><option value="all">Tous les types</option>' + Object.keys(Engine.TYPES).map((k) => '<option value="' + k + '" ' + (view.port.type === k ? 'selected' : '') + '>' + Engine.TYPES[k] + '</option>').join('') + '</select>' +
    '<select id="pd" aria-label="Dividendes"><option value="all">Tous les actifs</option><option value="payer">Versent un dividende</option><option value="none">Sans dividende / capitalisants</option><option value="missing">Données manquantes</option></select>' +
    '<span class="grow"></span>' + Tbl.menuHtml(cfg) + '</div><div id="tblHost"></div>';
  $('#pd', host).value = view.port.div;
  let t; $('#pq', host).oninput = (e) => { view.port.q = e.target.value; clearTimeout(t); t = setTimeout(() => { cfg.rows = filteredHoldings(); Tbl.render($('#tblHost'), cfg); }, 160); };
  $('#pt', host).onchange = (e) => { view.port.type = e.target.value; cfg.rows = filteredHoldings(); Tbl.render($('#tblHost'), cfg); };
  $('#pd', host).onchange = (e) => { view.port.div = e.target.value; cfg.rows = filteredHoldings(); Tbl.render($('#tblHost'), cfg); };
  Tbl.render($('#tblHost'), cfg); wireDo(host);
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
    if (h.status === 'verified' && p.verified === false) return false;
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
    { key: 'status', label: 'Statut', essential: true, sort: (p) => (p.verified === false ? 1 : 0), html: (p) => statusBadge('received', p.verified === false) },
    { key: 'source', label: 'Source', sort: (p) => p.source, html: (p) => esc({ manual: 'Saisie', csv: 'Import CSV', auto: 'Historique de marché' }[p.source] || p.source || '—') }
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
    { key: 'type', label: 'Opération', essential: true, sort: (t) => t.type, html: (t) => t.type === 'buy' ? '<span class="badge received">Achat</span>' : '<span class="badge warn">Vente</span>' },
    { key: 'asset', label: 'Actif', essential: true, sort: (t) => (t.name || t.ticker || '').toLowerCase(), html: (t) => { const h = holdingById(t.holdingId); return '<span class="asset">' + avatar(t.ticker, h && h.logo, 'sm', h && h.isin) + '<span><span class="nm">' + esc(t.name || t.ticker) + '</span><span class="tkr">' + esc(t.ticker) + '</span></span></span>'; } },
    { key: 'qty', label: 'Quantité', essential: true, align: 'r', sort: (t) => t.qty, html: (t) => fmtNum(t.qty) },
    { key: 'price', label: 'Prix', align: 'r', sort: (t) => t.price, html: (t) => fmtMoney(t.price, t.currency, { d: 4 }) },
    { key: 'amount', label: 'Montant', essential: true, align: 'r', sort: (t) => t.qty * t.price, html: (t) => fmtMoney(t.qty * t.price, t.currency) },
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
    (isPay ? '<select id="hStatus" aria-label="Statut" style="width:auto"><option value="all">Tous les statuts</option><option value="verified">Vérifiés</option><option value="unverified">À vérifier</option></select>' : '') +
    '<span class="grow"></span>' + (isPay ? '<button class="btn" type="button" data-do="prefill">Pré-remplir</button>' : '') + Tbl.menuHtml(cfg) + '</div>' +
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
function regionOf(h) {
  const t = String(h.ticker || ''), isin = String(h.isin || '').toUpperCase();
  if (isin.startsWith('US') || (!t.includes('.') && h.currency === 'USD')) return 'États-Unis';
  if (/\.(PA|AS|DE|F|MI|MC|BR|LS|L|SW|ST|CO|HE|OL|VI|IR)$/i.test(t) || /^(FR|DE|NL|IT|ES|BE|PT|GB|CH|SE|DK|FI|NO|AT|IE)/.test(isin)) return 'Europe';
  return 'Autres';
}
function groupRunRate(groupFn) {
  const out = {};
  visibleHoldings().forEach((h) => {
    const g = groupFn(h);
    const v = Engine.annualPerShare(h) * h.quantity; if (!v) return;
    const c = convert(v, h.currency);
    out[g] = out[g] || { conv: 0, missing: false, native: {} };
    if (c === null) out[g].missing = true; else out[g].conv += c;
    out[g].native[h.currency] = (out[g].native[h.currency] || 0) + v;
  });
  return out;
}
function groupTable(title, data, native) {
  const keys = Object.keys(data).sort((a, b) => data[b].conv - data[a].conv);
  const tot = keys.reduce((s, k) => s + data[k].conv, 0);
  if (!keys.length) return '<section class="card card-pad"><h3>' + title + '</h3><div class="muted">Aucune donnée.</div></section>';
  return '<section class="card card-pad"><h3>' + title + '</h3><div class="tbl-wrap"><table class="tbl"><thead><tr><th>Groupe</th>' + (native ? '<th class="r">Montant d\'origine</th>' : '') + '<th class="r">Revenu annuel est.</th><th class="r">Part</th></tr></thead><tbody>' +
    keys.map((k) => '<tr><td>' + esc(k) + '</td>' + (native ? '<td class="r">' + Object.keys(data[k].native).map((c) => fmtMoney(data[k].native[c], c)).join(' + ') + '</td>' : '') + '<td class="r">' + (data[k].missing ? '<span class="badge warn">taux manquant</span>' : money(data[k].conv)) + '</td><td class="r">' + (tot ? fmtPct(data[k].conv / tot, 1) : '—') + '</td></tr>').join('') + '</tbody></table></div></section>';
}
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
  const accounts = {}; state.accounts.forEach((a) => { accounts[a.name] = null; });
  const byAcc = groupRunRate((h) => accountName(h.account));
  const byCur = groupRunRate((h) => h.currency || '—');
  const byReg = groupRunRate(regionOf);
  const byType = groupRunRate((h) => Engine.TYPES[h.type] || 'Action');
  const acc = visibleHoldings().filter((h) => Engine.isAccumulating(h));
  host.innerHTML = pageHead('Statistiques', 'Évolution des revenus et prévisions · montants en ' + esc(baseCur()), modeSeg()) +
    '<div class="grid two even">' +
    '<section class="card card-pad"><div class="page-head" style="margin-bottom:6px"><h3 style="margin:0">Revenus mensuels ' + y + '</h3><div class="btn-row"><button class="btn sm icon" type="button" data-yr="-1" aria-label="Année précédente">‹</button><button class="btn sm icon" type="button" data-yr="1" aria-label="Année suivante">›</button></div></div>' +
    stackedBars({ labels: MOIS_C, cur: baseCur(), title: 'Revenus mensuels', layers: [{ name: 'Reçus', color: 'var(--chart-1)', values: series.received }, { name: 'À vérifier', color: 'var(--chart-3)', values: series.unverified }, { name: 'À venir (estimés / confirmés)', color: 'var(--chart-1)', faded: true, values: series.upcoming }, { name: 'Non enregistrés', color: 'var(--warn)', dashed: true, values: series.unrecorded }] }) + '</section>' +
    '<section class="card card-pad"><h3>Répartition par actif (revenu annuel estimé)</h3>' + (dist.total ? donut(dist.items, baseCur()) : '<div class="muted">Aucune prévision disponible.</div>') + '</section></div>' +
    '<div class="grid two even section-gap">' +
    '<section class="card card-pad"><h3>Prévision des 12 prochains mois <span class="muted" style="font-weight:500">· ' + money(f12Total, 0) + '</span></h3>' +
    stackedBars({ labels: f12.map((m) => MOIS_C[m.month]), cur: baseCur(), title: 'Prévision 12 mois', layers: [{ name: 'Confirmé / reçu', color: 'var(--chart-1)', values: f12.map((m) => m.confirmed) }, { name: 'Estimé', color: 'var(--chart-1)', faded: true, values: f12.map((m) => m.value - m.confirmed) }] }) + '</section>' +
    '<section class="card card-pad"><h3>Dividendes reçus par année</h3>' + (yearly.length ? stackedBars({ labels: yearly.map((x) => String(x.year)), cur: baseCur(), title: 'Dividendes reçus par année', layers: [{ name: 'Reçus (vérifiés)', color: 'var(--chart-1)', values: yearly.map((x) => x.verified) }, { name: 'À vérifier', color: 'var(--chart-3)', values: yearly.map((x) => x.unverified) }] }) : '<div class="muted">Aucun versement enregistré : saisissez-les ou importez vos transactions (Historique).</div>') + '</section></div>' +
    missingNote(run.missing) +
    '<div class="grid two even section-gap">' + groupTable('Par compte', byAcc) + groupTable('Par devise', byCur, true) + groupTable('Par zone', byReg) + groupTable('Par type d\'actif', byType) + '</div>' +
    '<section class="card card-pad section-gap"><h3>Principaux contributeurs</h3>' + (top.length ? '<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Actif</th><th class="r">Revenu annuel est.</th><th class="r">Part</th></tr></thead><tbody>' + top.map((t) => '<tr><td><b>' + esc(t.name || t.ticker) + '</b> <span class="muted">' + esc(t.ticker) + '</span></td><td class="r">' + money(t.value) + '</td><td class="r">' + fmtPct(run.total ? t.value / run.total : 0, 1) + '</td></tr>').join('') + '</tbody></table></div>' : '<div class="muted">Aucun actif ne verse de dividende.</div>') + '</section>' +
    (acc.length ? '<section class="card card-pad section-gap"><h3>ETF capitalisants (aucun dividende versé)</h3><div class="muted">' + acc.map((h) => esc(h.name || h.displayTicker || h.ticker)).join(' · ') + '</div></section>' : '');
  wireMode(host); wireDo(host);
  $$('[data-yr]', host).forEach((b) => b.onclick = () => { view.stats.year += Number(b.dataset.yr); renderStats(host); });
}
