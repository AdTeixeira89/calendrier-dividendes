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
  const today = new Date(), mode = incomeMode(), ids = visibleIds(), y = today.getFullYear(), mask = !!state.settings.hideNumbers, todayS = todayISO();
  const nowYM = Engine.ymOf(today), cvAt = (a_, c_, y_) => (y_ === nowYM ? convert(a_, c_) : convertAt(a_, c_, y_));      // mois en cours : taux du jour (comme la valeur affichée en haut)
  const cache = {}, histFor = (m_) => cache[m_] || (cache[m_] = Engine.portfolioHistory(state, cvAt, { months: m_, today, ids }));
  const pv = Engine.portfolioValue(state, convert, ids), un = Engine.unrealized(state, convert, ids), daily = Engine.dailyChange(state, convert, ids, todayS);
  const xi = Engine.xirr(histFor(0), today), hist = histFor(view.home.period), hs = visibleHoldings();
  const lbl = (dt, per) => fmtDate(dt, { day: 'numeric', month: 'short', year: per === 0 || per >= 12 ? '2-digit' : undefined });
  const dn = (iso_) => Math.round(Date.UTC(+iso_.slice(0, 4), +iso_.slice(5, 7) - 1, +iso_.slice(8, 10)) / 86400000), tLabel = (per) => (n_) => lbl(new Date(n_ * 86400000).toISOString().slice(0, 10), per);
  const signed = (v, d_) => (v >= 0 ? '+' : '') + money(v, d_ === undefined ? 0 : d_);

  /* --- 1. « Valeur du portefeuille » : valeur actuelle des positions détenues + 4 indicateurs --- */
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
  const pts = hist.points.map((p) => ({ label: lbl(p.date, view.home.period), t: dn(p.date), value: p.value, cost: p.cost, partial: p.partial, tip: tipOf(p) }));
  const costLine = pts.length > 1 && pts.every((p) => p.cost != null && !p.partial) && hist.allTx;
  const chart = hasValue
    ? lineChart({ points: pts, cur: baseCur(), mask, title: 'Évolution de la valeur du portefeuille', costLine, tLabel: tLabel(view.home.period) })
    : '<div class="empty" style="padding:28px 8px"><h3>Pas encore d\'historique de cours</h3><p>Actualisez les données de marché pour tracer l\'évolution de la valeur' + (state.transactions.length ? ' à partir de vos opérations importées' : '') + '.</p><button class="btn primary" type="button" data-do="refresh">' + icon('refresh') + 'Actualiser les données</button></div>';
  const notes = [];
  if (hasValue) {
    if (hist.allTx && state.transactions.length) notes.push('Valeur reconstituée : <b>opérations importées × cours historiques</b>' + (costLine ? ' · pointillés ocre : capital investi' : ''));
    else if (hist.retro) notes.push('Cours passés × quantités <b>actuelles</b> pour ' + (hist.coverage.retro.length > 3 ? hist.coverage.retro.length + ' actifs' : esc(hist.coverage.retro.join(', '))) + ' (pas d\'historique d\'opérations complet : rétrospectif)');
    const miss = hist.coverage.missing;
    if (miss.length) notes.push('<span class="warn-t">⚠ Cours historiques indisponibles pour ' + miss.slice(0, 3).map((m) => esc(m.name)).join(', ') + (miss.length > 3 ? ' et ' + (miss.length - 3) + ' autre(s)' : '') + ' (' + esc(miss[0].reason) + ' dès le ' + esc(fmtDate(miss[0].first)) + ') : les portions en <b>pointillés</b> sont partielles, ces actifs n\'y sont pas valorisés.</span>');
    const curs = new Set(state.holdings.concat(state.archive || []).map((x) => x.currency || 'EUR').concat(state.transactions.map((t) => t.acctCur || 'EUR'))); curs.delete(baseCur());
    if (curs.size && !(typeof fxHist !== 'undefined' && fxHist && Object.keys(fxHist).length)) notes.push('<span class="warn-t">⚠ Taux de change historiques indisponibles : le taux actuel est utilisé pour valoriser le passé (devises : ' + esc(Array.from(curs).join(', ')) + ').</span>');
    if (hist.coverage.noDaily && view.home.period > 0 && view.home.period <= 6) notes.push('Cours quotidiens indisponibles (mettre à jour le relais Cloudflare) : points mensuels.');
  }
  const unitNote = un.count < pv.count ? un.count + ' / ' + pv.count + ' positions avec PRU' : un.count + ' position(s) avec PRU';
  const indGain = '<div class="ind"><span>Plus-value totale</span>' + (un.count ? sens('<b class="' + (un.gain >= 0 ? 'pos' : 'neg') + '">' + signed(un.gain) + '</b>') + '<small>' + sens(fmtPct(un.pct, 1, true) + ' sur ' + money(un.cost, 0) + ' investis') + ' · ' + unitNote + '</small>' : '<b>—</b><small>Nécessite un PRU fiable et le cours</small>') + '</div>';
  const indDay = '<div class="ind"><span>Plus-value journalière</span>' + (daily.count ? sens('<b class="' + (daily.amount >= 0 ? 'pos' : 'neg') + '">' + signed(daily.amount) + '</b>') + '<small>' + sens(daily.pct === null ? '' : fmtPct(daily.pct, 2, true)) + ' · séance du ' + esc(fmtDate(daily.prevDate ? daily.prevDate : todayS, { day: 'numeric', month: 'short' })) + ' vs clôture précédente' + (daily.missing.length ? ' · ' + daily.missing.length + ' sans clôture' : '') + '</small>'
    : '<b>—</b><small>Données insuffisantes (clôture précédente indisponible : actualisez avec le relais à jour)</small>') + '</div>';
  const sc = xi.rate !== null && xi.scope ? xi.scope : null;
  const xirrTitle = 'Rendement annualisé pondéré par les flux (TRI / XIRR) : achats et ventes datés + valeur actuelle, dividendes exclus.' + (xi.rate === null ? ' Non calculable : ' + xi.reason + '.' : ' Depuis le ' + fmtDate(xi.from) + ' (' + fmtNum(xi.years, 1) + ' an(s), ' + xi.flows + ' flux).')
    + (sc ? ' Calculé sur ' + sc.held + ' position(s) sur ' + sc.total + ' : seules celles dont l\'historique d\'opérations est cohérent et dont le cours est disponible (exclues : ' + sc.excluded.slice(0, 8).join(', ') + (sc.excluded.length > 8 ? '…' : '') + ').' : '');
  const xirrWhy = xi.rate === null ? ({ 'aucune opération': 'importez votre historique', 'cours manquants': 'cours indisponibles' }[xi.reason] || (/un an/.test(xi.reason) ? 'moins d\'un an d\'opérations' : /incomplet/.test(xi.reason) ? 'historique d\'opérations incomplet' : xi.reason)) : '';
  const xirrChip = '<div class="xirr-chip" tabindex="0" data-tip="' + esc(xirrTitle) + '"><span>Rendement annuel moyen</span>' + (xi.rate === null ? '<b class="muted">Données insuffisantes</b><small>' + esc(xirrWhy) + '</small>' : sens('<b class="' + (xi.rate >= 0 ? 'pos' : 'neg') + '">' + fmtPct(xi.rate, 1, true) + ' / an</b>') + (sc ? '<small>sur ' + sc.held + ' / ' + sc.total + ' positions</small>' : '')) + '</div>';
  /* --- Rentabilité réelle de la période choisie pour le portefeuille affiché : gain = marché + dividendes, apports neutralisés --- */
  const per = view.home.period, perLbl = (HOME_PERIODS.find((q) => q[0] === per) || [0, 'Tout'])[1], acctLbl = view.account === 'all' ? 'Tous les portefeuilles' : accountName(view.account);
  const reqFrom = per > 0 ? Engine.toISO(new Date(today.getFullYear(), today.getMonth() - per, today.getDate())) : null;
  const divAll = (state.payments || []).filter((p_) => (!ids || ids.has(p_.holdingId)) && (p_.payDate || p_.exDate)).map((p_) => {
    const d_ = p_.payDate || p_.exDate, a_ = Engine.amount({ gross: Number(p_.gross) || 0, net: p_.net == null ? null : Number(p_.net) }, 'net');
    return { date: d_, v: cvAt(a_.v, p_.currency || 'EUR', d_.slice(0, 7)), unverified: p_.verified === false };
  }).filter((d_) => d_.v !== null);
  const pr = Engine.periodReturn(hist, divAll.filter((d_) => !d_.unverified), today, { from: reqFrom });
  const availFrom = (() => { const ha = histFor(0); return ha && !ha.empty ? (ha.summary && ha.summary.firstTx) || (ha.points[0] && ha.points[0].date) : null; })();
  const perBtn = (q) => { const rf = q[0] > 0 ? Engine.toISO(new Date(today.getFullYear(), today.getMonth() - q[0], today.getDate())) : null; const short = !!(rf && availFrom && Date.parse(availFrom) - Date.parse(rf) > 35 * 86400000);
    return '<button type="button" data-per="' + q[0] + '" class="' + (per === q[0] ? 'on' : '') + (short ? ' dim' : '') + '"' + (short ? ' title="Historique disponible depuis le ' + esc(fmtDate(availFrom)) + ' seulement : la période est raccourcie"' : '') + '>' + q[1] + '</button>'; };
  const WHY = { 'aucune donnée': 'pas encore d\'historique de cours (actualisez les données)', 'cours manquants à la date de fin': 'cours du jour indisponibles', 'cours manquants sur la période': 'cours historiques manquants sur la période', 'aucun investissement sur la période': 'aucun investissement sur cette période' };
  const sgn = (v_) => (Math.round(Math.abs(v_)) === 0 ? '' : v_ > 0 ? '+' : '−') + money(Math.abs(v_), 0), cl = (v_) => (Math.round(Math.abs(v_)) === 0 ? '' : v_ > 0 ? 'pos' : 'neg');
  let perfStrip;
  if (pr.ok) {
    const unv = divAll.filter((d_) => d_.unverified && d_.date > pr.from && d_.date <= pr.to).reduce((a_, d_) => a_ + d_.v, 0), nt = [];
    nt.push('Du ' + esc(fmtDate(pr.from)) + ' au ' + esc(fmtDate(pr.to)) + ' · ' + esc(acctLbl) + ' · valeur ' + sens(money(pr.V0, 0) + ' → ' + money(pr.V1, 0)) + (pr.annualized !== null ? ' · annualisé ' + sens('<b class="' + cl(pr.annualized) + '">' + fmtPct(pr.annualized, 1, true) + ' / an</b>') : ''));
    if (pr.truncated) nt.push('<span class="warn-t">Historique disponible seulement depuis le ' + esc(fmtDate(pr.from)) + ' : la période « ' + esc(perLbl) + ' » est raccourcie.</span>');
    if (pr.endPartial) nt.push('<span class="warn-t">Arrêtée au ' + esc(fmtDate(pr.to)) + ' (cours plus récents indisponibles).</span>');
    if (pr.retro) nt.push('<span class="warn-t">' + pr.retroNames.length + ' position(s) sans historique d\'opérations (' + esc(pr.retroNames.slice(0, 3).join(', ')) + (pr.retroNames.length > 3 ? '…' : '') + ') : quantité actuelle supposée constante, apports inconnus.</span>');
    if (unv > 0.5) nt.push('+ ' + sens(money(unv, 0)) + ' de dividendes « à vérifier » non comptés (validez-les dans Dividendes → Historique).');
    const tipMain = 'Performance de la période = plus-value de marché + dividendes perçus. Les achats et ventes (apports / retraits) ne sont jamais comptés comme gain ou perte : le pourcentage est pondéré dans le temps, l\'effet de chaque versement est neutralisé.';
    perfStrip = '<div class="perf-strip" aria-label="Rentabilité de la période">' +
      '<div class="ind" tabindex="0" data-tip="' + esc(tipMain) + '"><span>Performance · ' + esc(perLbl) + '</span>' + sens('<b class="' + cl(pr.totalGain) + '">' + sgn(pr.totalGain) + '</b>') + '<small>' + sens('<b class="' + cl(pr.pct) + '">' + fmtPct(pr.pct, 1, true) + '</b>') + ' hors apports</small></div>' +
      '<div class="ind"><span>Plus-value de marché</span>' + sens('<b class="' + cl(pr.marketGain) + '">' + sgn(pr.marketGain) + '</b>') + '<small>variation des cours</small></div>' +
      '<div class="ind"><span>Dividendes perçus</span>' + sens('<b class="' + (pr.dividends > 0 ? 'pos' : '') + '">' + (pr.dividends > 0 ? '+' : '') + money(pr.dividends, 0) + '</b>') + '<small>' + pr.dividendCount + ' versement(s) vérifié(s)</small></div>' +
      '<div class="ind" tabindex="0" data-tip="Argent ajouté (achats) moins argent retiré (ventes) sur la période : ce n\'est ni un gain ni une perte."><span>Apports nets</span>' + sens('<b>' + sgn(pr.netFlows) + '</b>') + '<small>' + sens(money(pr.buys, 0) + ' versés · ' + money(pr.sells, 0) + ' retirés') + '</small></div></div>' +
      '<div class="perf-line muted">' + nt.join('<br>') + '</div>';
  } else perfStrip = '<div class="perf-strip off"><div class="ind"><span>Performance · ' + esc(perLbl) + '</span><b class="muted">—</b><small>Non calculable : ' + esc(WHY[pr.reason] || pr.reason) + '</small></div></div>';

  const hero = '<section class="card card-pad hero"><div class="hero-top"><div class="hero-main"><div class="lbl">Valeur du portefeuille</div><div class="hero-val">' + sens(pv.count ? money(pv.total, 0) : '—') + '</div>' +
    '<div class="hero-sub muted">' + (pv.count ? pv.count + ' / ' + hs.length + ' position(s) valorisée(s)' : 'Cours non disponibles') + (pv.latest ? ' · cours du ' + esc(fmtDate(pv.latest.slice(0, 10))) : '') + '</div></div><div class="hero-ind">' + indGain + indDay + '</div></div>' +
    '<div class="hero-ctrl"><div class="seg" id="perSeg" role="group" aria-label="Période">' + HOME_PERIODS.map(perBtn).join('') + '</div></div>' +
    '<div class="chart-wrap">' + chart + xirrChip + '</div>' + perfStrip + (notes.length ? '<div class="chart-note">' + notes.join('<br>') + '</div>' : '') + '</section>';

  /* --- 2. « Dividendes » (raccourci) --- */
  const next = Engine.nextEvents(state, today, 120, ids), first = next[0];
  const rec = Engine.receivedBetween(state, y + '-01-01', Engine.toISO(today), mode, convert, ids);
  const yEvs = Engine.buildEvents(state, new Date(y, 0, 1), new Date(y, 11, 31), today, ids);
  const yUp = Engine.sumEvents(yEvs.filter((e) => e.status === 'forecast' || e.status === 'confirmed'), mode, convert);
  const series = Engine.monthlySeries(state, y, mode, convert, today, ids);
  const divBars = (h_, w_) => stackedBars({ w: w_, tipLabels: w_ ? MOIS_C : null, labels: w_ ? MOIS_C.map((m_) => m_.charAt(0).toUpperCase()) : MOIS_C, cur: baseCur(), title: 'Dividendes perçus et à venir', mask, h: h_, layers: [{ name: 'Perçus', color: 'var(--chart-1)', values: series.received }, { name: 'À vérifier', color: 'var(--chart-3)', values: series.unverified }, { name: 'À venir', color: 'var(--chart-1)', faded: true, values: series.upcoming }, { name: 'Non enregistrés', color: 'var(--warn)', dashed: true, values: series.unrecorded }] });
  const divCard = '<section class="card card-pad" id="divCardEl"><div class="card-head"><h3>Dividendes ' + y + '</h3><button class="link-btn" type="button" data-goto="calendar">Calendrier →</button></div>' +
    '<div class="mini-kv"><div><span>Perçus</span>' + sens('<b class="pos">' + (rec.count ? money(rec.verified.total, 0) : '—') + '</b>') + (rec.unverified ? '<small class="sens">+ ' + money(rec.unverifiedSum.total, 0) + ' à vérifier</small>' : '') + '</div>' +
    '<div><span>À venir</span>' + sens('<b>' + money(yUp.total, 0) + '</b>') + '</div><div><span>Prochain</span><b>' + (first ? esc(first.ticker) + '</b><small>' + esc(fmtDate(first.date, { day: 'numeric', month: 'short' })) + '</small>' : '—</b>') + '</div></div>' +
    '<div id="divChart">' + divBars(150) + '</div></section>';

  /* --- 3. « PERFORMANCES » : les 5 positions les plus rentables et les 5 plus négatives (plus-value latente / montant investi) --- */
  const perfAll = Engine.performance(state, convert, ids), ranked = perfAll.rows.filter((r) => r.pct !== null).sort((x, y2) => y2.pct - x.pct);
  const best = ranked.filter((r) => r.pct >= 0).slice(0, 5), worst = ranked.filter((r) => r.pct < 0).slice(-5).reverse();
  const prow = (r) => { const h = holdingById(r.id) || {}; return '<div class="perf-row">' + avatar(r.ticker, h.logo, 'xs', h.isin) + '<span class="nm" title="' + esc(r.name || r.ticker) + '">' + esc(r.name || r.ticker) + '</span><span class="perf-gain sens">' + (r.gain >= 0 ? '+' : '') + money(r.gain, 0) + '</span>' + sens('<b class="' + (r.pct >= 0 ? 'pos' : 'neg') + '">' + fmtPct(r.pct, 1, true) + '</b>') + '</div>'; };
  const perfCard = '<section class="card card-pad section-gap"><div class="card-head"><h3>PERFORMANCES</h3><span class="muted" style="font-size:12px">' + perfAll.count + ' position(s) avec PRU et cours</span></div>' + (perfAll.count
    ? '<div class="perf-cols"><div><h4>Les plus rentables</h4>' + (best.length ? best.map(prow).join('') : '<div class="muted" style="font-size:13px;padding:6px 0">Aucune position en plus-value.</div>') + '</div><div><h4>Les plus négatives</h4>' + (worst.length ? worst.map(prow).join('') : '<div class="muted" style="font-size:13px;padding:6px 0">Aucune position en moins-value.</div>') + '</div></div>'
    : '<div class="empty" style="padding:18px 8px"><h3>Données insuffisantes</h3><p>Renseignez le prix de revient de vos positions et actualisez les cours pour voir leurs performances.</p></div>') + '</section>';

  host.innerHTML = pageHead('Accueil', esc(marketLine()) + ' · montants en ' + esc(baseCur()), '<button class="btn icon" type="button" id="eyeBtn" aria-pressed="' + mask + '" title="' + (mask ? 'Afficher les chiffres' : 'Masquer les chiffres') + '" aria-label="' + (mask ? 'Afficher les chiffres' : 'Masquer les chiffres') + '">' + icon(mask ? 'eyeoff' : 'eye') + '</button>') +
    '<section class="ticker compact" aria-label="Prochains dividendes"><span class="tk-lbl">Prochains<br>dividendes</span>' + (next.length ? tickerHtml(next, mask) : '<span class="muted" style="font-size:13px">Aucun versement attendu dans les 4 prochains mois.</span>') + '</section>' +
    '<div class="home-wrap' + (newsOn() ? ' with-side' : '') + '"><div class="home-body' + (mask ? ' hide-nums' : '') + '"><div class="grid home-top">' + hero + divCard + '</div>' + perfCard + '</div>' +
    (newsOn() ? '<aside class="home-side" id="newsBox" aria-label="Actualités de vos actifs"></aside>' : '') + '</div>';
  if (newsOn()) drawNews($('#newsBox', host));

  // la carte « Dividendes » prend la même hauteur que la carte « Valeur du portefeuille » (côte à côte) : le graphique des dividendes s'agrandit en conséquence
  const fitDiv = () => {
    const hero_ = $('.hero', host), card_ = $('#divCardEl', host), box_ = $('#divChart', host); if (!hero_ || !card_ || !box_) return;
    box_.innerHTML = divBars(150);
    if (!window.matchMedia('(min-width:900px)').matches) return;
    // échelle 1:1 (texte lisible, initiales des mois) : le graphique garde ses proportions et gagne la hauteur manquante
    const cw = Math.round(box_.clientWidth); if (cw < 120) return;
    box_.innerHTML = divBars(120, cw);
    const extra = hero_.offsetHeight - card_.offsetHeight;
    if (extra > 4) box_.innerHTML = divBars(Math.min(700, 120 + extra), cw);
  };
  fitDiv(); if (host._fitDiv) window.removeEventListener('resize', host._fitDiv);
  let ft; host._fitDiv = () => { if (!document.body.contains(host) || !$('#divCardEl', host)) { window.removeEventListener('resize', host._fitDiv); return; } clearTimeout(ft); ft = setTimeout(fitDiv, 120); }; window.addEventListener('resize', host._fitDiv);
  const trk = $('#tickerTrack', host); if (trk) startTickerScroll(trk);
  $$('.tk-chip', host).forEach((c) => c.addEventListener('click', () => { view.divTab = 'calendar'; go('dividends'); }));
  wireDo(host);
  $('#eyeBtn', host).onclick = () => { state.settings.hideNumbers = !state.settings.hideNumbers; saveState(); renderHome(host); };
  $$('#perSeg [data-per]', host).forEach((b) => b.onclick = () => { view.home.period = Number(b.dataset.per); renderHome(host); });
  $$('[data-goto]', host).forEach((b) => b.onclick = () => { view.divTab = b.dataset.goto; go('dividends'); });
}

/* ===============================================================
   ACTUALITÉS de VOS actifs (Yahoo Finance via le relais, gratuit) — panneau latéral de l'accueil
   Seuls les articles qui concernent réellement un titre détenu sont gardés ; cache 1 h ; rien n'est résumé ni inventé.
   =============================================================== */
const newsOn = () => state.settings.news !== false && !!state.settings.relayUrl && state.holdings.length > 0;
const newsMem = { at: 0, key: '', data: null };
function newsSymbols() {                    // les 12 positions les plus importantes (valeur, à défaut montant investi)
  return visibleHoldings().filter((h) => h.ticker && !Market.isISIN(h.ticker)).map((h) => ({ h, w: Engine.value(h) || 0 })).sort((a, b) => b.w - a.w).slice(0, 12).map((x) => x.h);
}
function newsLoad(hs) {                     // un seul chargement à la fois par jeu de titres (les rendus répétés de l'accueil partagent la même requête)
  const key = hs.map((h) => h.ticker).join(',');
  if (newsMem.pending && newsMem.pendingKey === key) return newsMem.pending;
  newsMem.pendingKey = key; newsMem.pending = newsFetch(hs, key).finally(() => { newsMem.pending = null; });
  return newsMem.pending;
}
async function newsFetch(hs, key) {
  const now = Date.now();
  if (newsMem.data && newsMem.key === key && now - newsMem.at < 3600e3) return newsMem.data;
  try { const c = JSON.parse(localStorage.getItem('dca_news') || 'null'); if (c && c.key === key && now - c.at < 3600e3) { Object.assign(newsMem, c); return c.data; } } catch (e) { /* ignoré */ }
  let items = [], none = [], err = null;
  for (const h of hs) {
    try { const r = await market.fetchNews(h.ticker); if (r.items.length) items = items.concat(r.items.map((n) => Object.assign(n, { name: h.name || h.displayTicker || h.ticker, hid: h.id }))); else none.push(h.displayTicker || h.ticker); }
    catch (e) { err = e; if (e.rate || e.fatal) break; }
  }
  if (!items.length && err) throw err;
  const seen = new Set(); items = items.sort((a, b) => (a.at < b.at ? 1 : -1)).filter((n) => !seen.has(n.link) && seen.add(n.link)).slice(0, 40);
  const data = { items, none, at: new Date().toISOString() };
  Object.assign(newsMem, { at: now, key, data }); try { localStorage.setItem('dca_news', JSON.stringify({ at: now, key, data })); } catch (e) { /* ignoré */ }
  return data;
}
/* Traductions déjà obtenues (mémoire locale : un titre n'est traduit qu'une fois). */
const trMemo = () => { try { return JSON.parse(localStorage.getItem('dca_tr') || '{}') || {}; } catch (e) { return {}; } };
async function newsTranslate(d) {
  d.trStatus = 'ok';
  if (state.settings.newsFr === false) { d.trStatus = 'off'; return; }
  const top = d.items.slice(0, 8), memo = trMemo();
  top.forEach((n) => { if (n.fr == null && memo[n.title]) n.fr = memo[n.title]; });
  let todo = top.filter((n) => !n.fr); if (!todo.length) return;
  let tr = null, relayErr = null;
  try { tr = await market.translate(todo.map((n) => n.title)); } catch (e) { relayErr = e; }          // 1. relais (Google, puis MyMemory)
  if (!tr || !tr.some(Boolean)) {                                                                        // 2. secours : MyMemory directement depuis le navigateur
    try { tr = await market.translateDirect(todo.map((n) => n.title)); } catch (e) { tr = null; }
  }
  todo.forEach((n, i) => { if (tr && tr[i]) { n.fr = tr[i]; memo[n.title] = tr[i]; } });
  if (!todo.some((n) => n.fr)) { d.trStatus = relayErr && /404|invalide/i.test(relayErr.message) ? 'oldrelay' : 'unavailable'; return; }   // rien n'est mémorisé : réessayé au prochain affichage
  try { const keys = Object.keys(memo); if (keys.length > 300) keys.slice(0, keys.length - 300).forEach((k) => { delete memo[k]; }); localStorage.setItem('dca_tr', JSON.stringify(memo)); localStorage.setItem('dca_news', JSON.stringify({ at: newsMem.at, key: newsMem.key, data: d })); } catch (e) { /* ignoré */ }
}
function newsCard(inner) { return '<section class="card card-pad"><div class="card-head"><h3>Actualités</h3><span class="muted" style="font-size:12px">vos actifs · Yahoo Finance</span></div>' + inner + '</section>'; }
async function drawNews(box) {
  if (!box) return;
  const hs = newsSymbols(); if (!hs.length) { box.innerHTML = newsCard('<p class="muted" style="font-size:13px">Aucun actif avec un ticker.</p>'); return; }
  box.innerHTML = newsCard('<p class="muted" style="font-size:13px">Chargement…</p>');
  try {
    const d = await newsLoad(hs); if (!document.body.contains(box)) return;
    await newsTranslate(d);                 // titres en français (facultatif ; l'original reste visible en infobulle)
    if (!document.body.contains(box)) return;
    const ago = (iso) => { const h = Math.max(0, (Date.now() - Date.parse(iso)) / 3600e3); return h < 1 ? 'il y a moins d\'1 h' : h < 24 ? 'il y a ' + Math.round(h) + ' h' : fmtDate(iso.slice(0, 10), { day: 'numeric', month: 'short' }); };
    const rows = d.items.slice(0, 8).map((n) => '<a class="news-row" href="' + esc(n.link) + '" target="_blank" rel="noopener noreferrer"><span class="news-h"><b>' + esc(n.symbol) + '</b><small class="muted">' + esc(n.publisher) + ' · ' + esc(ago(n.at)) + '</small></span><span class="news-t"' + (n.fr ? ' title="' + esc('Original : ' + n.title) + '"' : '') + '>' + esc(n.fr || n.title) + '</span></a>').join('');
    const trNote = d.trStatus === 'oldrelay' ? '<div class="notice warn" style="margin-bottom:8px"><span>Traduction impossible : le relais n\'est pas à jour (route /translate absente) et le service de secours ne répond pas. Titres affichés en anglais.</span></div>'
      : d.trStatus === 'unavailable' ? '<div class="notice warn" style="margin-bottom:8px"><span>Service de traduction indisponible pour le moment : titres affichés en anglais.</span></div>' : '';
    box.innerHTML = newsCard(trNote + (rows || '<div class="muted" style="font-size:13px;padding:6px 0">Aucune actualité trouvée pour vos actifs.</div>') +
      '<p class="hint" style="margin:8px 0 0">Articles Yahoo Finance qui citent vos titres' + (state.settings.newsFr === false ? ' (titres d\'origine, souvent en anglais)' : ', titres traduits automatiquement en français (original en infobulle)') + '. Couverture surtout américaine' + (d.none.length ? ' : rien pour ' + d.none.slice(0, 6).map(esc).join(', ') + (d.none.length > 6 ? '…' : '') : '') + '. Informatif, pas un conseil.</p>');
  } catch (e) {
    if (!document.body.contains(box)) return;
    box.innerHTML = newsCard('<div class="notice warn"><span>' + esc(/404|invalide/i.test(e.message) ? 'Mettez à jour le relais Cloudflare (route /news absente).' : e.message) + '</span></div>');
  }
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
