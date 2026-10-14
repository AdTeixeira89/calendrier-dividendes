/* ==================================================================
   dashboard.js — Accueil (tableau de bord), Répartition, Dividendes (onglets).
   ================================================================== */

const HOME_PERIODS = [[12, '1 an'], [36, '3 ans'], [60, '5 ans']];
const sens = (h) => '<span class="sens">' + h + '</span>';

/* Groupes de répartition : une fonction de clé par axe d'analyse. */
const ALLOC_AXES = {
  sector: { label: 'Secteur', key: (h) => sectorFr(h.sector) || (h.type !== 'stock' ? 'ETF / Fonds' : 'Non classé') },
  country: { label: 'Pays', key: (h) => h.country || 'Non renseigné' },
  currency: { label: 'Devise', key: (h) => h.currency || '—' },
  type: { label: 'Type d\'actif', key: (h) => Engine.TYPES[h.type] || 'Action' },
  account: { label: 'Compte', key: (h) => accountName(h.account) }
};
function allocDonutCard(title, a, mask, extra) {
  if (a.items.length === 1) return '<section class="card card-pad"><h3>' + esc(title) + '</h3><div class="single-cat">Une seule catégorie : <b>' + esc(a.items[0].key) + '</b> (100 %)</div></section>';
  const items = a.items.map((x) => ({ ticker: x.key, value: x.value, count: x.count }));
  const body = a.total > 0 ? donut(items, baseCur(), mask) : '<div class="muted" style="padding:18px 0">Aucune donnée : actualisez les données de marché.</div>';
  return '<section class="card card-pad"><h3>' + esc(title) + '</h3>' + body + (extra || '') + '</section>';
}
function dataGaps(hs) {
  const noPrice = hs.filter((h) => !(h.price > 0)).length, noHist = hs.filter((h) => !(h.hist && h.hist.c && h.hist.c.length)).length;
  const noSector = hs.filter((h) => !h.sector && h.type === 'stock').length, noDiv = hs.filter((h) => Engine.dividendStatus(h) === 'missing').length;
  return { noPrice, noHist, noSector, noDiv, any: noPrice + noHist + noSector + noDiv > 0 };
}

/* ===============================================================
   ACCUEIL
   =============================================================== */
function renderHome(host) {
  if (!state.holdings.length) { host.innerHTML = pageHead('Accueil', 'Votre portefeuille en un coup d\'œil') + emptyPortfolio(); wireDo(host); return; }
  const today = new Date(), mode = incomeMode(), ids = visibleIds(), y = today.getFullYear(), mask = !!state.settings.hideNumbers, hs = visibleHoldings();
  const next = Engine.nextEvents(state, today, 120, ids);
  const pv = Engine.portfolioValue(state, convert, ids), un = Engine.unrealized(state, convert, ids), inv = Engine.investedTotal(state, convert, ids);
  const perf = Engine.performance(state, convert, ids), run = Engine.runRate(state, mode, convert, ids);
  const yoc = Engine.yieldOnCost(state, convert, ids), yp = Engine.yieldOnPrice(state, convert, ids);
  const rec = Engine.receivedBetween(state, y + '-01-01', Engine.toISO(today), mode, convert, ids);
  const yEvs = Engine.buildEvents(state, new Date(y, 0, 1), new Date(y, 11, 31), today, ids);
  const yRec = Engine.sumEvents(yEvs.filter((e) => e.status === 'received'), mode, convert);
  const yUp = Engine.sumEvents(yEvs.filter((e) => e.status === 'forecast' || e.status === 'confirmed'), mode, convert);
  const series = Engine.monthlySeries(state, y, mode, convert, today, ids);
  const vs = Engine.valueSeries(state, convertAt, { months: view.home.period, today, ids });
  const gaps = dataGaps(hs), first = next[0];

  /* --- carte « Valeur du portefeuille » --- */
  const pts = vs.points.map((p) => ({ label: fmtDate(p.ym + '-01', { month: 'short', year: '2-digit' }), value: p.value, tip: fmtDate(p.ym + '-01', { month: 'long', year: 'numeric' }) + (mask ? '\nMontants masqués' : '\n' + fmtMoney(p.value, baseCur(), { d: 0 })) }));
  const change = pts.length > 1 && pts[0].value > 0 ? pts[pts.length - 1].value / pts[0].value - 1 : null;
  const refOk = inv.count > 0 && inv.count === pv.count && pv.count > 0;
  const chart = pv.count && pts.length > 1
    ? lineChart({ points: pts, cur: baseCur(), mask, title: 'Évolution de la valeur du portefeuille', ref: refOk ? { value: inv.cost, label: 'Investi (PRU)' } : null })
    : '<div class="empty" style="padding:28px 8px"><h3>Pas encore d\'historique de cours</h3><p>Actualisez les données de marché pour tracer l\'évolution de la valeur.</p><button class="btn primary" type="button" data-do="refresh">' + icon('refresh') + 'Actualiser les données</button></div>';
  const note = !pv.count ? '' : '<div class="chart-note">' + (vs.retro ? 'Cours passés × quantités <b>actuelles</b> (positions détenues aujourd\'hui, rétrospectif)' : 'Valeur réelle reconstituée à partir de vos opérations') +
    (vs.coverage.missing.length ? ' · <span class="warn-t">' + vs.coverage.missing.length + ' actif(s) sans historique non inclus</span>' : '') + (change !== null ? ' · variation sur la période : <b class="' + (change >= 0 ? 'pos' : 'neg') + ' sens">' + fmtPct(change, 1, true) + '</b>' : '') + '</div>';
  const hero = '<section class="card card-pad hero"><div class="hero-top"><div><div class="lbl">Valeur du portefeuille</div><div class="hero-val">' + sens(pv.count ? money(pv.total, 0) : '—') + '</div>' +
    '<div class="hero-sub">' + (un.count ? sens('<b class="' + (un.gain >= 0 ? 'pos' : 'neg') + '">' + (un.gain >= 0 ? '+' : '') + money(un.gain, 0) + ' (' + fmtPct(un.pct, 1, true) + ')</b>') + ' <span class="muted">depuis l\'achat (PRU)</span>' : '<span class="muted">' + (pv.count ? 'Renseignez le PRU pour suivre la performance' : 'Cours non disponibles') + '</span>') + (pv.latest ? ' <span class="muted">· cours du ' + esc(fmtDate(pv.latest.slice(0, 10))) + '</span>' : '') + '</div></div>' +
    '<div class="seg" id="perSeg" role="group" aria-label="Période">' + HOME_PERIODS.map((p) => '<button type="button" data-per="' + p[0] + '" class="' + (view.home.period === p[0] ? 'on' : '') + '">' + p[1] + '</button>').join('') + '</div></div>' + chart + note + '</section>';

  /* --- carte « Dividendes » --- */
  const divCard = '<section class="card card-pad"><div class="card-head"><h3>Dividendes ' + y + '</h3><button class="link-btn" type="button" data-goto="calendar">Calendrier →</button></div>' +
    '<div class="mini-kv"><div><span>Perçus</span>' + sens('<b class="pos">' + (rec.count ? money(rec.verified.total, 0) : '—') + '</b>') + (rec.unverified ? '<small class="sens">+ ' + money(rec.unverifiedSum.total, 0) + ' à vérifier</small>' : '') + '</div>' +
    '<div><span>À venir</span>' + sens('<b>' + money(yUp.total, 0) + '</b>') + '</div><div><span>Prochain</span><b>' + (first ? esc(first.ticker) + '</b><small>' + esc(fmtDate(first.date, { day: 'numeric', month: 'short' })) + '</small>' : '—</b>') + '</div></div>' +
    stackedBars({ labels: MOIS_C, cur: baseCur(), title: 'Dividendes perçus et à venir', mask, h: 170, layers: [{ name: 'Perçus', color: 'var(--chart-1)', values: series.received }, { name: 'À vérifier', color: 'var(--chart-3)', values: series.unverified }, { name: 'À venir', color: 'var(--chart-1)', faded: true, values: series.upcoming }, { name: 'Non enregistrés', color: 'var(--warn)', dashed: true, values: series.unrecorded }] }) + '</section>';

  /* --- 4 indicateurs --- */
  const kpis = [
    kpiCard('Plus-value latente', un.count ? (un.gain >= 0 ? '+' : '') + money(un.gain, 0) : '—', un.count ? fmtPct(un.pct, 1, true) + ' sur ' + money(un.cost, 0) + ' investis (' + un.count + ' / ' + hs.length + ' actifs avec PRU et cours)' : 'Nécessite le PRU et le cours', un.count ? (un.gain >= 0 ? 'income' : 'neg') : ''),
    kpiCard('Dividendes annuels estimés', money(run.total, 0), 'Rythme sur 12 mois (estimation)<br>Année ' + y + ' : ' + money(yRec.total, 0) + ' perçus + ' + money(yUp.total, 0) + ' à venir', 'income'),
    kpiCard('Rendement sur coût', yoc.rate === null ? '—' : fmtPct(yoc.rate, 2), yp.rate === null ? 'Renseignez le PRU' : 'Sur cours actuel : ' + fmtPct(yp.rate, 2)),
    kpiCard('Actifs', String(hs.length), hs.filter((h) => Engine.isPayer(h)).length + ' versent un dividende')
  ].join('');

  /* --- répartitions + performances --- */
  const aSec = Engine.allocation(state, ALLOC_AXES.sector.key, 'value', convert, ids, 6), aCty = Engine.allocation(state, ALLOC_AXES.country.key, 'value', convert, ids, 6);
  const link = '<button class="link-btn" type="button" data-goto-page="allocation" style="margin-top:6px">Voir la répartition complète →</button>';
  const row = (r) => '<div class="perf-row">' + avatar(r.ticker, (holdingById(r.id) || {}).logo, 'xs', (holdingById(r.id) || {}).isin) + '<span class="nm">' + esc(r.name || r.ticker) + '</span>' + sens('<b class="' + (r.pct >= 0 ? 'pos' : 'neg') + '">' + fmtPct(r.pct, 1, true) + '</b>') + '</div>';
  const perfCard = '<section class="card card-pad"><h3>Performances (vs PRU)</h3>' + (perf.count >= 2
    ? '<div class="perf-cols"><div><h4>Meilleures</h4>' + perf.best.map(row).join('') + '</div><div><h4>' + (perf.worst.some((r) => r.pct < 0) ? 'À surveiller' : 'Plus faibles') + '</h4>' + (perf.worst.length ? perf.worst.map(row).join('') : '<div class="muted" style="font-size:12.5px">Aucune position en baisse.</div>') + '</div></div>' : '<div class="muted">Renseignez le PRU de vos actifs et actualisez les cours pour voir les performances.</div>') + '</section>';

  const gapTxt = [];
  if (gaps.noHist || gaps.noPrice) gapTxt.push('<b>' + Math.max(gaps.noHist, gaps.noPrice) + '</b> actif(s) sans cours / historique');
  if (gaps.noSector) gapTxt.push('<b>' + gaps.noSector + '</b> sans secteur');
  if (gaps.noDiv) gapTxt.push('<b>' + gaps.noDiv + '</b> sans données de dividende');
  const notice = gaps.any && state.settings.relayUrl ? '<div class="notice section-gap"><span>' + gapTxt.join(' · ') + ' : ils sont exclus des graphiques concernés.</span><button class="btn sm" type="button" data-do="refresh">' + icon('refresh') + 'Actualiser</button></div>' : '';

  host.innerHTML = pageHead('Accueil', esc(marketLine()) + ' · montants en ' + esc(baseCur()), '<button class="btn icon" type="button" id="eyeBtn" aria-pressed="' + mask + '" title="' + (mask ? 'Afficher les chiffres' : 'Masquer les chiffres') + '" aria-label="' + (mask ? 'Afficher les chiffres' : 'Masquer les chiffres') + '">' + icon(mask ? 'eyeoff' : 'eye') + '</button>' + modeSeg()) +
    '<div class="home-body' + (mask ? ' hide-nums' : '') + '"><section class="ticker"><div class="ticker-head"><h2>Prochains dividendes</h2><span class="muted">≈ estimé · survolez ou touchez un versement pour le détail</span></div>' + tickerHtml(next, mask) + '</section>' +
    '<div class="grid dash-main section-gap">' + hero + divCard + '</div>' +
    '<div class="grid kpis kpis-2 section-gap">' + kpis + '</div>' +
    '<div class="grid three section-gap">' + allocDonutCard('Par secteur', aSec, mask) + allocDonutCard('Par pays', aCty, mask, link) + perfCard + '</div>' + notice + missingNote(Array.from(new Set([].concat(run.missing, pv.missing, rec.missing)))) + '</div>';

  wireMode(host); wireDo(host);
  $('#eyeBtn', host).onclick = () => { state.settings.hideNumbers = !state.settings.hideNumbers; saveState(); renderHome(host); };
  $$('#perSeg [data-per]', host).forEach((b) => b.onclick = () => { view.home.period = Number(b.dataset.per); renderHome(host); });
  $$('[data-goto]', host).forEach((b) => b.onclick = () => { view.divTab = b.dataset.goto; go('dividends'); });
  $$('[data-goto-page]', host).forEach((b) => b.onclick = () => go(b.dataset.gotoPage));
  const tr = $('#tickerTrack', host);
  if (tr) tr.addEventListener('click', (e) => { const c = e.target.closest('.tk-chip'); if (!c) return; const ev = next[Number(c.dataset.i)]; if (ev) openDay(ev.date, next.filter((x) => x.date === ev.date)); });
  startTickerScroll(tr);
}

/* ===============================================================
   RÉPARTITION (diversification)
   =============================================================== */
function renderAllocation(host) {
  if (!state.holdings.length) { host.innerHTML = pageHead('Répartition', 'Diversification de votre portefeuille') + emptyPortfolio(); wireDo(host); return; }
  const ids = visibleIds(), basis = view.alloc.basis, hs = visibleHoldings();
  const BASIS = [['value', 'Valeur'], ['cost', 'Investi'], ['dividend', 'Dividendes']];
  const aSec = Engine.allocation(state, ALLOC_AXES.sector.key, basis, convert, ids, 8), aCty = Engine.allocation(state, ALLOC_AXES.country.key, basis, convert, ids, 8);
  const aCur = Engine.allocation(state, ALLOC_AXES.currency.key, basis, convert, ids, 8), aTyp = Engine.allocation(state, ALLOC_AXES.type.key, basis, convert, ids, 8);
  const aAcc = Engine.allocation(state, ALLOC_AXES.account.key, basis, convert, ids, 8), aPos = Engine.allocation(state, (h) => h.name || h.displayTicker || h.ticker, basis, convert, ids, 10);
  const top5 = aPos.all.slice(0, 5).reduce((s, x) => s + x.pct, 0), nSec = aSec.all.filter((x) => x.key !== 'Non classé').length, nCty = aCty.all.filter((x) => x.key !== 'Non renseigné' && x.key !== 'ETF multi-pays').length;
  const bars = aPos.all.slice(0, 10).map((x) => '<div class="bar-row"><span class="nm">' + esc(x.key) + '</span><span class="bar"><i style="width:' + Math.max(2, x.pct * 100).toFixed(1) + '%"></i></span><b>' + fmtPct(x.pct, 1) + '</b></div>').join('');
  let topSec; const gaps = dataGaps(hs), unsorted = hs.filter((h) => h.type === 'stock' && (!h.sector || !h.country)).length;
  const notes = [];
  if (basis === 'value' && aSec.fallback) notes.push(aSec.fallback + ' actif(s) sans cours, pondérés par leur montant investi');
  if (aSec.excluded) notes.push(aSec.excluded + ' actif(s) sans valeur, exclus');
  host.innerHTML = pageHead('Répartition', 'Diversification de votre portefeuille · montants en ' + esc(baseCur()), '<div class="seg" id="basisSeg" role="group" aria-label="Pondération">' + BASIS.map((b) => '<button type="button" data-basis="' + b[0] + '" class="' + (basis === b[0] ? 'on' : '') + '">' + b[1] + '</button>').join('') + '</div><button class="btn icon" type="button" id="eyeBtn" aria-pressed="' + !!state.settings.hideNumbers + '" aria-label="Masquer les chiffres">' + icon(state.settings.hideNumbers ? 'eyeoff' : 'eye') + '</button>') +
    '<div class="' + (state.settings.hideNumbers ? 'hide-nums' : '') + '"><div class="chips-row">' +
    '<div class="card stat-chip"><span>Secteurs</span><b>' + nSec + '</b></div><div class="card stat-chip"><span>Pays</span><b>' + nCty + '</b></div><div class="card stat-chip"><span>5 premières positions</span><b>' + fmtPct(top5, 0) + '</b></div><div class="card stat-chip"><span>Plus gros secteur</span><b>' + ((topSec = aSec.all.find((x) => x.key !== 'Non classé' && x.key !== 'Autres')) ? esc(topSec.key) + ' · ' + fmtPct(topSec.pct, 0) : '—') + '</b></div></div>' +
    '<div class="grid two even">' + allocDonutCard('Par secteur', aSec, state.settings.hideNumbers) + allocDonutCard('Par pays', aCty, state.settings.hideNumbers) + '</div>' +
    '<div class="grid three section-gap">' + allocDonutCard('Par devise', aCur, state.settings.hideNumbers) + allocDonutCard('Par type d\'actif', aTyp, state.settings.hideNumbers) + allocDonutCard('Par compte', aAcc, state.settings.hideNumbers) + '</div>' +
    '<section class="card card-pad section-gap"><h3>Principales positions</h3>' + (bars || '<div class="muted">Aucune donnée.</div>') + '</section>' +
    (notes.length ? '<p class="hint" style="margin-top:10px">' + notes.map(esc).join(' · ') + '.</p>' : '') +
    ((unsorted || gaps.noHist) && state.settings.relayUrl ? '<div class="notice section-gap"><span>' + (unsorted ? '<b>' + unsorted + '</b> action(s) sans secteur ou sans pays. ' : '') + 'Actualisez les données ou renseignez-les dans la fiche de l\'actif (secteur et pays modifiables).</span><button class="btn sm" type="button" data-do="refresh">' + icon('refresh') + 'Actualiser</button></div>' : '') + '</div>';
  wireDo(host);
  $$('#basisSeg [data-basis]', host).forEach((b) => b.onclick = () => { view.alloc.basis = b.dataset.basis; renderAllocation(host); });
  $('#eyeBtn', host).onclick = () => { state.settings.hideNumbers = !state.settings.hideNumbers; saveState(); renderAllocation(host); };
}

/* ===============================================================
   DIVIDENDES (onglets : calendrier, historique, statistiques)
   =============================================================== */
function renderDividends(host) {
  const tabs = [['calendar', 'Calendrier'], ['history', 'Historique'], ['stats', 'Statistiques']];
  if (!tabs.some((t) => t[0] === view.divTab)) view.divTab = 'calendar';
  host.innerHTML = '<div class="page-head" style="margin-bottom:12px"><div><h1>Dividendes</h1></div><div class="seg" id="dvTabs" role="tablist">' + tabs.map((t) => '<button type="button" role="tab" data-t="' + t[0] + '" class="' + (view.divTab === t[0] ? 'on' : '') + '" aria-selected="' + (view.divTab === t[0]) + '">' + t[1] + '</button>').join('') + '</div></div><div id="dvBody"></div>';
  $$('#dvTabs [data-t]', host).forEach((b) => b.onclick = () => { view.divTab = b.dataset.t; history.replaceState(null, '', '#/' + SLUG.dividends + '/' + DIV_SLUG[view.divTab]); renderDividends(host); });
  const body = $('#dvBody', host);
  ({ calendar: renderCalendar, history: renderHistory, stats: renderStats }[view.divTab])(body);
}
