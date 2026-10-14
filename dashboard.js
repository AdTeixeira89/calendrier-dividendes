/* ==================================================================
   dashboard.js — Accueil (tableau de bord), Répartition, Dividendes (onglets).
   ================================================================== */

const HOME_PERIODS = [[1, '1 M'], [3, '3 M'], [6, '6 M'], [12, '1 an'], [60, '5 ans'], [0, 'Tout']];
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
  if (!state.holdings.length && !state.transactions.length) { host.innerHTML = pageHead('Accueil', 'Votre portefeuille en un coup d\'œil') + emptyPortfolio(); wireDo(host); return; }
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
  const nowYM = Engine.ymOf(today), cvAt = (a_, c_, y_) => (y_ === nowYM ? convert(a_, c_) : convertAt(a_, c_, y_));      // mois en cours : taux du jour (comme la valeur affichée en haut)
  const hist = Engine.portfolioHistory(state, cvAt, { months: view.home.period, today, ids });
  const gaps = dataGaps(hs), first = next[0];

  /* --- carte « Valeur du portefeuille » : historique reconstitué (opérations × cours historiques) --- */
  const hs_ = hist.summary, perfMode = view.home.mode === 'perf' && hist.perf.points.length > 1;
  const dn = (iso_) => Math.round(Date.UTC(+iso_.slice(0, 4), +iso_.slice(5, 7) - 1, +iso_.slice(8, 10)) / 86400000), tLabel = (n_) => lbl(new Date(n_ * 86400000).toISOString().slice(0, 10));
  const lbl = (dt) => fmtDate(dt, { day: 'numeric', month: 'short', year: view.home.period === 0 || view.home.period >= 12 ? '2-digit' : undefined });
  const tipOf = (p) => {
    if (mask) return fmtDate(p.date, { day: 'numeric', month: 'long', year: 'numeric' }) + '\nMontants masqués';
    let s = fmtDate(p.date, { day: 'numeric', month: 'long', year: 'numeric' }) + '\nValeur : ' + fmtMoney(p.value, baseCur(), { d: 0 });
    if (p.cost != null && p.cost > 0) s += '\nCapital investi : ' + fmtMoney(p.cost, baseCur(), { d: 0 });
    p.parts.forEach((x) => { s += '\n· ' + String(x[0]).slice(0, 22) + ' ' + fmtMoney(x[1], baseCur(), { d: 0 }); });
    if (p.rest > 0.5) s += '\n· autres ' + fmtMoney(p.rest, baseCur(), { d: 0 });
    if (p.partial) s += '\n⚠ Valeur partielle : cours manquants (' + p.missing.slice(0, 3).join(', ') + (p.nMissing > 3 ? '…' : '') + ')';
    return s;
  };
  const hasValue = hist.points.length > 1 && hist.points.some((p) => !p.partial && p.value > 0);
  let pts;
  if (perfMode) {
    const byDate = {}; hist.perf.points.forEach((q) => { byDate[q.date] = q.pct; });
    pts = hist.points.filter((p) => byDate[p.date] !== undefined).map((p) => ({ label: lbl(p.date), t: dn(p.date), value: byDate[p.date] * 100, partial: false,
      tip: fmtDate(p.date, { day: 'numeric', month: 'long', year: 'numeric' }) + '\nPerformance : ' + (mask ? 'masquée' : fmtPct(byDate[p.date], 1, true)) }));
  } else pts = hist.points.map((p) => ({ label: lbl(p.date), t: dn(p.date), value: p.value, cost: p.cost, partial: p.partial, tip: tipOf(p) }));
  const costLine = !perfMode && pts.length > 1 && pts.every((p) => p.cost != null && !p.partial) && hist.allTx;
  const refOk = !costLine && !perfMode && inv.count > 0 && inv.count === pv.count && pv.count > 0 && hist.retro;
  const chart = hasValue
    ? lineChart({ points: pts, cur: baseCur(), mask, title: 'Évolution de la valeur du portefeuille', ref: refOk ? { value: inv.cost, label: 'Investi (PRU)' } : null, costLine, pct: perfMode, zero: perfMode, tLabel })
    : '<div class="empty" style="padding:28px 8px"><h3>Pas encore d\'historique de cours</h3><p>Actualisez les données de marché pour tracer l\'évolution de la valeur' + (state.transactions.length ? ' à partir de vos opérations importées' : '') + '.</p><button class="btn primary" type="button" data-do="refresh">' + icon('refresh') + 'Actualiser les données</button></div>';
  /* synthèse : valeur de départ → valeur actuelle = apports nets + gain des marchés */
  const sumRow = hasValue && hs_ && !perfMode ? '<div class="chart-sum' + (mask ? ' hide-nums' : '') + '"><div><span>Au ' + esc(fmtDate(hs_.startDate, { day: 'numeric', month: 'short', year: 'numeric' })) + '</span>' + sens('<b>' + money(hs_.startValue, 0) + '</b>') + '</div>' +
    '<div><span>Valeur actuelle</span>' + sens('<b>' + money(hs_.endValue, 0) + '</b>') + '</div>' +
    (hist.allTx || hs_.netFlows ? '<div><span>Apports nets <small>(achats − ventes)</small></span>' + sens('<b>' + (hs_.netFlows >= 0 ? '+' : '') + money(hs_.netFlows, 0) + '</b>') + '</div><div><span>Gain des marchés</span>' + sens('<b class="' + (hs_.marketGain >= 0 ? 'pos' : 'neg') + '">' + (hs_.marketGain >= 0 ? '+' : '') + money(hs_.marketGain, 0) + '</b>') + '</div>' : '') +
    (hs_.perfPct != null ? '<div><span>Performance <small>(hors apports)</small></span>' + sens('<b class="' + (hs_.perfPct >= 0 ? 'pos' : 'neg') + '">' + fmtPct(hs_.perfPct, 1, true) + '</b>') + '</div>' : '') + '</div>' : '';
  const notes = [];
  if (hasValue) {
    if (hist.allTx && state.transactions.length) notes.push('Valeur reconstituée : <b>opérations importées × cours historiques</b>' + (costLine ? ' · pointillés ocre : capital investi' : ''));
    else if (hist.retro) notes.push('Cours passés × quantités <b>actuelles</b> pour ' + (hist.coverage.retro.length > 3 ? hist.coverage.retro.length + ' actifs' : esc(hist.coverage.retro.join(', '))) + ' (pas d\'historique d\'opérations complet : rétrospectif)');
    const miss = hist.coverage.missing;
    if (miss.length) notes.push('<span class="warn-t">⚠ Cours historiques indisponibles pour ' + miss.slice(0, 3).map((m) => esc(m.name)).join(', ') + (miss.length > 3 ? ' et ' + (miss.length - 3) + ' autre(s)' : '') + ' (' + esc(miss[0].reason) + ' dès le ' + esc(fmtDate(miss[0].first)) + ') : les portions en <b>pointillés</b> sont partielles, ces actifs n\'y sont pas valorisés.</span>');
    const curs = new Set(state.holdings.concat(state.archive || []).map((x) => x.currency || 'EUR').concat(state.transactions.map((t) => t.acctCur || 'EUR'))); curs.delete(baseCur());
    if (curs.size && !(typeof fxHist !== 'undefined' && fxHist && Object.keys(fxHist).length)) notes.push('<span class="warn-t">⚠ Taux de change historiques indisponibles : le taux actuel est utilisé pour valoriser le passé (devises : ' + esc(Array.from(curs).join(', ')) + ').</span>');
    if (hist.coverage.noDaily && view.home.period > 0 && view.home.period <= 6) notes.push('Cours quotidiens indisponibles (mettre à jour le relais Cloudflare) : points mensuels.');
    if (perfMode) notes.push('Performance pondérée dans le temps : les achats comptent comme des apports et les ventes comme des retraits, ils ne créent pas de performance.' + (hist.perf.from && hist.points.length && hist.perf.from > hist.points[0].date ? ' Calculée depuis le ' + esc(fmtDate(hist.perf.from)) + ' (avant : valorisation partielle).' : ''));
    if (view.home.mode === 'perf' && !perfMode) notes.push('Performance non calculable sur cette période (valorisation partielle ou trop peu de points).');
  }
  const note = notes.length ? '<div class="chart-note">' + notes.join('<br>') + '</div>' : '';
  const hero = '<section class="card card-pad hero"><div class="hero-top"><div><div class="lbl">Valeur du portefeuille</div><div class="hero-val">' + sens(pv.count ? money(pv.total, 0) : '—') + '</div>' +
    '<div class="hero-sub">' + (un.count ? sens('<b class="' + (un.gain >= 0 ? 'pos' : 'neg') + '">' + (un.gain >= 0 ? '+' : '') + money(un.gain, 0) + ' (' + fmtPct(un.pct, 1, true) + ')</b>') + ' <span class="muted">depuis l\'achat (PRU)</span>' : '<span class="muted">' + (pv.count ? 'Renseignez le PRU pour suivre la performance' : 'Cours non disponibles') + '</span>') + (pv.latest ? ' <span class="muted">· cours du ' + esc(fmtDate(pv.latest.slice(0, 10))) + '</span>' : '') + '</div></div>' +
    '<div class="hero-ctrl"><div class="seg" id="perSeg" role="group" aria-label="Période">' + HOME_PERIODS.map((p) => '<button type="button" data-per="' + p[0] + '" class="' + (view.home.period === p[0] ? 'on' : '') + '">' + p[1] + '</button>').join('') + '</div>' +
    (hist.perf.points.length > 1 || view.home.mode === 'perf' ? '<div class="seg" id="modeSeg" role="group" aria-label="Affichage"><button type="button" data-mode="value" class="' + (!perfMode ? 'on' : '') + '">Valeur</button><button type="button" data-mode="perf" class="' + (perfMode ? 'on' : '') + '">Performance</button></div>' : '') + '</div></div>' + chart + sumRow + note + '</section>';

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
  $$('#modeSeg [data-mode]', host).forEach((b) => b.onclick = () => { view.home.mode = b.dataset.mode; renderHome(host); });
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
