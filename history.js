/* ==================================================================
   history.js — import intelligent de l'historique DEGIRO (aperçu, rapprochement, confirmation,
   retour arrière), opérations par actif (quantité / coût / PRU après chaque opération, résultat
   réalisé) et positions clôturées. La logique de calcul est dans ledger.js (module pur testé).
   ================================================================== */

const instrumentById = (id) => state.holdings.find((h) => h.id === id) || (state.archive || []).find((a) => a.id === id) || null;

/* ---------------------------------------------------------------
   LECTURE DU FICHIER (encodage détecté : UTF-8 puis Windows-1252)
   --------------------------------------------------------------- */
async function readHistoryRows(file) {
  const name = file.name.toLowerCase();
  if (/\.(xlsx|xls)$/.test(name)) return { rows: (await readFileRows(file)).filter((r) => r && r.some((c) => String(c).trim() !== '')), enc: 'Excel' };
  const buf = await file.arrayBuffer();
  let text, enc = 'UTF-8';
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(buf); } catch (e) { text = new TextDecoder('windows-1252').decode(buf); enc = 'Windows-1252'; }
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
  if (typeof Papa === 'undefined') throw new Error('Bibliothèque CSV indisponible (hors-ligne ?).');
  return { rows: Papa.parse(text, { skipEmptyLines: true }).data.filter((r) => r && r.some((c) => String(c).trim() !== '')), enc };
}

/* ---------------------------------------------------------------
   IMPORT DE L'HISTORIQUE DEGIRO
   --------------------------------------------------------------- */
const DG_FIELDS = [['date', 'Date', 1], ['time', 'Heure', 0], ['product', 'Produit', 1], ['isin', 'ISIN', 0], ['qty', 'Quantité', 1], ['price', 'Cours', 1], ['priceCur', 'Devise du cours', 0],
  ['valueAcct', 'Valeur (devise du compte)', 0], ['fee1', 'Frais (1)', 0], ['fee2', 'Frais (2)', 0], ['total', 'Total frais compris', 0], ['orderId', 'ID de l\'ordre', 0], ['description', 'Description (relevé de compte)', 0]];

async function openImportDegiro() {
  const file = await pickFile('.csv,.txt,.xlsx,.xls'); if (!file) return;
  let data; try { data = await readHistoryRows(file); } catch (e) { toast(e.message, { error: true }); return; }
  if (!data.rows.length) { toast('Fichier vide ou illisible.', { error: true }); return; }
  renderDegiroModal(data.rows, data.enc, file.name, null);
}

function degiroDefaultAccount(rows, det) {
  // portefeuille qui contient déjà le plus des actifs du fichier ; à défaut un portefeuille « DEGIRO » ; à défaut le portefeuille affiché
  const isinCol = det.cols.isin;
  const isins = new Set(isinCol !== undefined ? rows.slice(det.headerIdx + 1).map((r) => String(r[isinCol] || '').trim().toUpperCase()).filter(Boolean) : []);
  let best = null, bn = 0;
  state.accounts.forEach((a) => { const n = state.holdings.filter((h) => h.account === a.id && isins.has(String(h.isin || (Market.isISIN(h.ticker) ? h.ticker : '')).toUpperCase())).length; if (n > bn) { bn = n; best = a.id; } });
  if (best) return best;
  const dg = state.accounts.find((a) => /degiro/i.test(a.name)); if (dg) return dg.id;
  return view.account !== 'all' ? view.account : (state.accounts.length === 1 && !state.holdings.length ? '__new__' : state.accounts[0].id);
}

function renderDegiroModal(rows, enc, fileName, hIdx) {
  const det0 = Ledger.detect(rows, hIdx === null ? undefined : hIdx), hi = det0.headerIdx < 0 ? 0 : det0.headerIdx;
  const head = (rows[hi] || []).slice(), n = Math.max.apply(null, rows.map((r) => r.length)); while (head.length < n) head.push('');
  const c0 = det0.cols, sel0 = { date: c0.date, time: c0.time, product: c0.product, isin: c0.isin, qty: c0.qty, price: c0.price, priceCur: c0.priceCur, valueAcct: c0.valueAcct, fee1: c0.fees[0], fee2: c0.fees[1], total: c0.total, orderId: c0.orderId, description: c0.description };
  const defAcc = degiroDefaultAccount(rows, det0);
  const hasNamed = state.accounts.some((a) => /degiro/i.test(a.name));
  const m = openModal('<h2>Importer l\'historique DEGIRO</h2><div class="sub">Fichier « ' + esc(fileName) + ' » (' + (rows.length - hi - 1) + ' ligne(s), encodage ' + esc(enc) + '). Rien n\'est modifié avant votre confirmation.</div>' +
    '<details class="dg-cols" id="dgColsBox"' + (det0.missing.length ? ' open' : '') + '><summary>Colonnes reconnues' + (det0.missing.length ? ' — <span class="warn-t">à compléter : ' + esc(det0.missing.join(', ')) + '</span>' : ' ✓') + '</summary>' +
    fld('Ligne d\'en-tête', '<select id="dgH">' + rows.slice(0, 10).map((r, i) => opt(i, 'Ligne ' + (i + 1) + ' — ' + r.slice(0, 3).join(' / '), i === hi)).join('') + '</select>', '', 'dgH') +
    '<div class="row2 dg-grid">' + DG_FIELDS.map((f) => fld(f[1], colSelect('dg_' + f[0], head, sel0[f[0]] === undefined ? -1 : sel0[f[0]], true), '', 'dg_' + f[0])).join('') + '</div></details>' +
    fld('Portefeuille de destination', '<select id="dgAcc">' + state.accounts.map((a) => opt(a.id, a.name, defAcc === a.id)).join('') + (hasNamed ? '' : opt('__new__', 'Nouveau portefeuille « DEGIRO »', defAcc === '__new__')) + '</select>',
      'Les positions déjà présentes dans ce portefeuille sont rapprochées par ISIN (puis par nom exact) ; elles ne sont jamais écrasées.', 'dgAcc') +
    '<div id="dgSummary" class="dg-summary"></div>' +
    '<div class="sec">Actifs du fichier</div><div id="dgInst"></div>' +
    '<label class="chk"><input type="checkbox" id="dgFill" checked><span>Compléter uniquement les informations <b>manquantes</b> des positions existantes (PRU vide, ISIN absent)</span></label>' +
    '<details class="dg-cols" id="dgPrevBox"><summary>Aperçu des opérations reconnues</summary><div id="dgPrev"></div></details>' +
    '<details class="dg-cols" id="dgIssuesBox"><summary id="dgIssuesSum">Lignes à vérifier</summary><div id="dgIssues"></div></details>' +
    '<div class="modal-actions"><span></span><div class="btn-row"><button class="btn" type="button" data-close>Annuler</button><button class="btn primary" type="button" id="dgGo">Importer</button></div></div>', { wide: true });
  $('#dgH', m).onchange = (e) => { closeModal(); renderDegiroModal(rows, enc, fileName, Number(e.target.value)); };
  const detNow = () => {
    const v = (k) => { const x = Number($('#dg_' + k, m).value); return x >= 0 ? x : undefined; };
    const fees = [v('fee1'), v('fee2')].filter((x) => x !== undefined);
    const cols = { fees, date: v('date'), time: v('time'), product: v('product'), isin: v('isin'), qty: v('qty'), price: v('price'), priceCur: v('priceCur'), valueAcct: v('valueAcct'), total: v('total'), orderId: v('orderId'), description: v('description') };
    ['localValue', 'localCur', 'fx', 'type', 'change', 'changeCur'].forEach((k) => { if (det0.cols[k] !== undefined) cols[k] = det0.cols[k]; });
    return Object.assign({}, det0, { cols, headerIdx: hi, statement: cols.qty === undefined && cols.description !== undefined });
  };
  let cur = null;
  const refresh = () => {
    const det = detNow(), res = Ledger.parseOps(rows, det), acc = $('#dgAcc', m).value;
    const pl = Ledger.plan(state, res.ops, { account: acc === '__new__' ? '__new__' : acc });
    cur = { det, res, pl, acc };
    drawDegiro(m, cur);
    return cur;
  };
  $$('select', m).forEach((s) => { if (s.id !== 'dgH') s.addEventListener('change', () => refresh()); });
  m.addEventListener('change', (e) => { if (e.target.matches('[data-inc],[data-align],#dgFill')) drawDegiro(m, cur, true); });
  refresh();
  $('#dgGo', m).onclick = () => confirmDegiro(m, cur);
}

function degiroChoices(m, pl) {
  const off = {}, align = {};
  pl.instruments.forEach((i) => {
    const inc = $('[data-inc="' + CSS.escape(i.key) + '"]', m); if (inc && !inc.checked) off[i.key] = true;
    const al = $('[data-align="' + CSS.escape(i.key) + '"]', m); if (al && al.checked) align[i.key] = true;
  });
  return { off, align, fill: $('#dgFill', m).checked };
}

/* Chiffres du récapitulatif, recalculés selon les cases cochées. */
function degiroTotals(cur, ch) {
  const { pl, res } = cur, on = (i) => i.status !== 'review' && !ch.off[i.key];
  const inc = pl.instruments.filter(on);
  const sum = (f) => inc.reduce((s, i) => s + f(i), 0);
  const warnOps = pl.instruments.reduce((s, i) => s + (i.status === 'review' ? i.ops.length : i.warnCount), 0);
  return {
    detected: res.ops.length, newTx: sum((i) => i.newOps.length), dups: pl.instruments.reduce((s, i) => s + i.dupOps.length, 0),
    newPos: inc.filter((i) => i.status === 'create' || i.status === 'reopen').length, kept: pl.instruments.filter((i) => i.status === 'holding').length,
    aligned: inc.filter((i) => ch.align[i.key]).length, filled: ch.fill ? inc.filter((i) => i.status === 'holding' && (i.fill.avgCost || i.fill.isin || i.fill.name)).length : 0,
    closed: inc.filter((i) => i.status === 'closed').length, review: warnOps + res.ambiguous.length + res.bad.length, diverg: pl.instruments.filter((i) => i.divergence), skipped: pl.instruments.filter((i) => i.status !== 'review' && ch.off[i.key]).length
  };
}

function drawDegiro(m, cur, keepChoices) {
  const ch = keepChoices ? degiroChoices(m, cur.pl) : { off: {}, align: {}, fill: true };
  const { pl, res, det } = cur, t = degiroTotals(cur, ch);
  const fmtQ = (q) => fmtNum(q);
  const missing = det.missing.length;
  const statusCell = (i) => {
    const note = (x) => '<div class="dg-note">' + x + '</div>';
    if (i.status === 'review') return '<span class="badge warn">À vérifier</span> ' + note(i.reasons.map(esc).join(' ') + ' Cet actif n\'est pas importé.');
    if (i.status === 'create') return '<span class="badge received">Nouvelle position</span>' + (i.reasons.length ? note(i.reasons.map(esc).join(' ')) : '');
    if (i.status === 'reopen') return '<span class="badge received">Position rachetée</span>' + note('Réouverture de l\'actif soldé, historique relié.');
    if (i.status === 'closed') return '<span class="badge">Soldée</span>' + note('Vendue en totalité : <b>pas ajoutée</b> au portefeuille actuel, opérations conservées dans l\'historique (résultat réalisé : ' + (i.led.realizedKnown ? fmtMoney(i.led.realized, i.acctCur) : 'inconnu') + ').');
    if (i.status === 'archive') return '<span class="badge">Déjà archivée</span>';
    let s = '<span class="badge info">Déjà présente</span> ' + note('Position et PRU <b>conservés</b>.');
    if (i.divergence) s += note('<span class="warn-t">Quantité : application ' + fmtQ(i.divergence.app) + ' ≠ historique ' + fmtQ(i.divergence.file) + '</span> (un fractionnement ou une opération sur titres manque peut-être).');
    if (i.pruDiff) s += note('PRU saisi ' + fmtMoney(i.pruDiff.app, i.pruDiff.cur) + ' ≠ PRU calculé ' + fmtMoney(i.pruDiff.file, i.pruDiff.cur) + '.');
    const fills = []; if (i.fill.avgCost) fills.push('PRU manquant → ' + fmtMoney(i.fill.avgCost.value, i.fill.avgCost.cur)); if (i.fill.isin) fills.push('ISIN'); if (i.fill.name) fills.push('nom');
    if (fills.length) s += note('Sera complété : ' + fills.join(', ') + '.');
    if (i.divergence || i.pruDiff) s += '<label class="chk dg-align"><input type="checkbox" data-align="' + esc(i.key) + '"' + (ch.align[i.key] ? ' checked' : '') + '><span>Aligner quantité et PRU sur l\'historique <small>(remplace les valeurs de l\'application)</small></span></label>';
    return s;
  };
  const rowsH = pl.instruments.slice().sort((a, b) => ({ review: 0, holding: 1, create: 2, reopen: 2, closed: 3, archive: 4 }[a.status] - { review: 0, holding: 1, create: 2, reopen: 2, closed: 3, archive: 4 }[b.status]) || (a.name || '').localeCompare(b.name || '')).map((i) =>
    '<tr class="dg-row"><td class="chk-col"><input type="checkbox" data-inc="' + esc(i.key) + '" ' + (i.status === 'review' ? 'disabled' : (ch.off[i.key] ? '' : 'checked')) + ' aria-label="Importer"></td>' +
    '<td><b>' + esc(i.name || i.isin) + '</b><div class="dg-note">' + esc(i.isin) + (i.currency ? ' · ' + esc(i.currency) : '') + '</div></td>' +
    '<td class="r">' + i.newOps.length + ' / ' + i.ops.length + (i.dupOps.length ? '<div class="dg-note">' + i.dupOps.length + ' doublon(s)</div>' : '') + '</td>' +
    '<td class="r">' + (i.status === 'review' ? '—' : fmtQ(i.led.qty)) + '</td><td class="r">' + (i.led.pru != null && i.led.qty > 0 ? fmtMoney(i.led.pru, i.acctCur) : '—') + '</td><td>' + statusCell(i) + '</td></tr>').join('');
  $('#dgInst', m).innerHTML = pl.instruments.length ? '<div class="tbl-wrap" style="max-height:340px"><table class="tbl dg-tbl"><thead><tr><th class="chk-col"></th><th>Actif</th><th class="r">Opérations<br><small>nouvelles / fichier</small></th><th class="r">Quantité<br><small>d\'après l\'historique</small></th><th class="r">PRU calculé</th><th>Traitement</th></tr></thead><tbody>' + rowsH + '</tbody></table></div>'
    : '<div class="muted">Aucun achat ou vente reconnu.</div>';
  const li = (n, label, strong) => '<li><b' + (strong ? ' class="' + strong + '"' : '') + '>' + n + '</b> ' + label + '</li>';
  $('#dgSummary', m).innerHTML = '<ul>' + li(t.detected, 'transaction(s) détectée(s)') + li(t.newTx, 'nouvelle(s) à ajouter', 'pos') + li(t.dups, 'doublon(s) ignoré(s)') + li(t.newPos, 'position(s) nouvelle(s) à créer') +
    li(t.kept, 'position(s) existante(s) conservée(s)' + (t.filled ? ' (dont ' + t.filled + ' complétée(s) d\'une information manquante)' : '') + (t.aligned ? ', ' + t.aligned + ' alignée(s) sur votre demande' : '')) +
    li(t.closed, 'position(s) vendue(s) en totalité, non ajoutée(s) au portefeuille actuel') + li(t.review, 'opération(s) nécessitant une vérification', t.review ? 'warn-t' : '') + '</ul>' +
    (t.diverg.length ? '<div class="notice warn" style="margin-top:6px">Divergences de quantité : ' + t.diverg.map((i) => '<b>' + esc(i.name || i.isin) + '</b> (application ' + fmtQ(i.divergence.app) + ', historique ' + fmtQ(i.divergence.file) + ')').join(' · ') + '. Rien n\'est modifié sans votre accord.</div>' : '') +
    (missing ? '<div class="notice warn" style="margin-top:6px">Colonnes essentielles non reconnues : <b>' + esc(det.missing.join(', ')) + '</b>. Indiquez-les dans « Colonnes reconnues ».</div>' : '') +
    (t.newTx === 0 && t.detected > 0 && !missing ? '<div class="notice info" style="margin-top:6px">Tout est déjà présent : l\'import ne changerait rien.</div>' : '') +
    (res.other.length ? '<div class="hint" style="margin-top:6px">' + res.other.length + ' autre(s) mouvement(s) ignoré(s) (' + esc(Object.entries(res.other.reduce((o, x) => { o[x.kind] = (o[x.kind] || 0) + 1; return o; }, {})).map((e) => e[1] + ' ' + e[0]).join(', ')) + ') — non gérés par cet import.</div>' : '');
  const sample = res.ops.slice().sort((a, b) => Ledger.orderKey(a, b)).slice(-10).reverse();
  $('#dgPrev', m).innerHTML = sample.length ? '<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Date</th><th>Actif</th><th>Opération</th><th class="r">Qté</th><th class="r">Cours</th><th class="r">Frais</th><th class="r">Total</th></tr></thead><tbody>' + sample.map((o) =>
    '<tr><td>' + esc(fmtDate(o.date)) + (o.time ? ' <small class="muted">' + esc(o.time) + '</small>' : '') + '</td><td>' + esc(o.name || o.isin) + '</td><td>' + (o.type === 'buy' ? 'Achat' : 'Vente') + '</td><td class="r">' + fmtQ(o.qty) + '</td><td class="r">' + fmtMoney(o.price, o.priceCur, { d: 4 }) + '</td><td class="r">' + (o.fees != null ? fmtMoney(o.fees, o.acctCur) : '—') + '</td><td class="r">' + (o.amt != null ? fmtMoney(o.amt, o.acctCur) : '—') + '</td></tr>').join('') +
    '</tbody></table></div><div class="hint">10 opérations les plus récentes sur ' + res.ops.length + '.</div>' : '<div class="muted">Aucune opération.</div>';
  const issues = [].concat(res.bad.map((b) => ({ line: b.line, k: 'Illisible', msg: b.reason })), res.ambiguous.map((b) => ({ line: b.line, k: 'Ambiguë', msg: b.reason })),
    res.ops.filter((o) => o.warn.length).map((o) => ({ line: o.line, k: 'Alerte', msg: o.warn.join(' ; ') + ' — ' + (o.name || o.isin) })),
    pl.instruments.filter((i) => i.status === 'review').map((i) => ({ line: i.ops[0].line, k: 'Non importé', msg: (i.name || i.isin) + ' : ' + i.reasons.join(' ') })));
  $('#dgIssuesSum', m).innerHTML = 'Lignes à vérifier (' + issues.length + ')'; $('#dgIssues', m).innerHTML = issues.length ? '<div class="tbl-wrap" style="max-height:200px"><table class="tbl"><tbody>' + issues.slice(0, 200).map((x) => '<tr><td class="r">l. ' + x.line + '</td><td><span class="badge warn">' + x.k + '</span></td><td>' + esc(x.msg) + '</td></tr>').join('') + '</tbody></table></div>' + (issues.length > 200 ? '<div class="hint">200 premières lignes affichées.</div>' : '') : '<div class="muted">Aucune.</div>';
  if (!m.dataset.drawn) { m.dataset.drawn = '1'; $('#dgIssuesBox', m).open = pl.instruments.some((i) => i.status === 'review') || res.bad.length > 0; }
  const goBtn = $('#dgGo', m); goBtn.disabled = missing > 0 || (t.newTx === 0 && t.aligned === 0 && t.filled === 0 && t.newPos === 0 && t.closed === 0);
  goBtn.textContent = goBtn.disabled ? 'Rien à importer' : 'Importer (' + t.newTx + ' opération' + (t.newTx > 1 ? 's' : '') + ')';
}

async function confirmDegiro(m, cur) {
  const ch = degiroChoices(m, cur.pl), t = degiroTotals(cur, ch);
  const body = '<ul class="dg-conf"><li><b>' + t.newTx + '</b> opération(s) ajoutée(s) à l\'historique</li><li><b>' + t.newPos + '</b> position(s) créée(s) avec leur PRU calculé</li><li><b>' + t.closed + '</b> position(s) soldée(s) archivée(s) (non affichée(s) dans le portefeuille actuel)</li>' +
    '<li><b>' + t.kept + '</b> position(s) existante(s) conservée(s)' + (t.filled ? ', ' + t.filled + ' complétée(s) d\'une information manquante' : '') + (t.aligned ? ', <b>' + t.aligned + ' alignée(s) sur l\'historique (quantité et PRU remplacés)</b>' : '') + '</li><li>' + t.dups + ' doublon(s) ignoré(s)</li></ul>' +
    '<p>Une copie de vos données est conservée : vous pourrez <b>annuler cet import</b> (Paramètres → Sauvegarde, ou le bouton « Annuler » qui s\'affiche ensuite).</p>';
  const c = await confirmDialog({ title: 'Confirmer l\'import ?', body, confirmLabel: 'Importer' });
  if (!c.ok) return;
  let accId = cur.acc;
  snapshotForUndo('import de l\'historique DEGIRO');
  if (accId === '__new__') { accId = uid(); state.accounts.push({ id: accId, name: 'DEGIRO' }); }
  const r = Ledger.apply(state, cur.pl, ch, { uid, account: accId });
  saveState(); closeModal();
  view.port.tab = 'ops'; view.ops.asset = 'all';
  const parts = [r.tx + ' opération(s)']; if (r.created.length) parts.push(r.created.length + ' position(s) créée(s)'); if (r.archived.length) parts.push(r.archived.length + ' soldée(s) archivée(s)'); if (r.filled) parts.push(r.filled + ' complétée(s)'); if (r.aligned) parts.push(r.aligned + ' alignée(s)');
  go('portfolio'); renderPage();
  toast('Import terminé : ' + parts.join(' · ') + '.', { ms: 14000, action: { label: 'Annuler l\'import', fn: undoLastImport } });
  enrichAfterImport(r.created, r.archived);
}

/* Cours, dividendes, secteur et fractionnements des nouveaux actifs (relais Yahoo), puis cours passés des positions soldées. */
async function enrichAfterImport(created, archived) {
  if (!state.settings.relayUrl) return;
  try {
    if (created.length) await refreshMarket(created, { silent: false });
    if (archived.length) { await refreshArchive(archived, todayISO()); saveState(); }
    const notes = adjustSplitsForCreated(created);
    ensureFxHistory(); renderPageSoft();
    if (notes.length) toast('Fractionnement(s) pris en compte : ' + notes.join(' ; ') + '. Vérifiez la quantité.', { ms: 12000 });
  } catch (e) { /* silencieux : l'import est déjà enregistré */ }
}
/* DEGIRO n'inscrit pas les fractionnements dans l'export des transactions : une action fractionnée depuis l'achat
   a une quantité actuelle plus élevée. Pour les positions CRÉÉES par l'import, on ramène la quantité (et le PRU) à la base actuelle. */
function adjustSplitsForCreated(created) {
  const notes = [];
  created.forEach((h) => {
    const sp = h.splits || []; if (!sp.length) return;
    const txs = state.transactions.filter((t) => t.holdingId === h.id && (t.type === 'buy' || t.type === 'sell'));
    const adj = Math.round(txs.reduce((s, t) => s + (t.type === 'buy' ? 1 : -1) * Number(t.qty) * Ledger.splitFactor(sp, t.date), 0) * 1e8) / 1e8;
    if (!(adj > 0) || Math.abs(adj - h.quantity) < 1e-9) return;
    const cost = h.avgCost > 0 ? h.quantity * h.avgCost : null;
    h.quantity = adj; if (cost !== null) h.avgCost = Math.round(cost / adj * 1e4) / 1e4;
    const last = sp[sp.length - 1]; notes.push((h.name || h.displayTicker) + ' (×' + last.ratio + ' le ' + fmtDate(last.date) + ')');
  });
  if (notes.length) saveState();
  return notes;
}

/* ---------------------------------------------------------------
   OPÉRATIONS PAR ACTIF (grand livre) ET POSITIONS CLÔTURÉES
   --------------------------------------------------------------- */
function visibleInstruments() {
  const ids = visibleIds();
  return state.holdings.concat(state.archive || []).filter((x) => !ids || ids.has(x.id));
}
/* Grand livre d'un actif dans UNE devise de coût (celle de la première opération) ; les opérations dans une autre devise restent sans montant plutôt que mal converties. */
function ledgerOf(inst) {
  const txs = state.transactions.filter((t) => t.holdingId === inst.id && (t.type === 'buy' || t.type === 'sell') && t.date);
  if (!txs.length) return null;
  const cc = (t) => t.acctCur || t.currency || 'EUR', cur = cc(txs.slice().sort((a, b) => (a.date < b.date ? -1 : 1))[0]);
  const entries = txs.map((t) => {
    const amt = cc(t) !== cur ? null : (t.amountAcct != null ? Number(t.amountAcct) : (t.type === 'buy' ? Number(t.qty) * Number(t.price) + Number(t.fees || 0) : Number(t.qty) * Number(t.price) - Number(t.fees || 0)));
    return { id: t.id, date: t.date, time: t.time || '', type: t.type, qty: Number(t.qty), amt, fees: Number(t.fees || 0), tx: t };
  });
  const led = Ledger.run(entries); led.cur = cur; return led;
}
function opRows() {
  const out = [], o = view.ops, closedIds = new Set((state.archive || []).map((a) => a.id));
  visibleInstruments().forEach((inst) => {
    if (o.asset !== 'all' && inst.id !== o.asset) return;
    const led = ledgerOf(inst); if (!led) return;
    led.rows.forEach((r, seq) => {
      if (o.type !== 'all' && r.type !== o.type) return;
      if (o.from && r.date < o.from) return; if (o.to && r.date > o.to) return;
      const t = r.tx;
      out.push({ id: t.id, date: r.date, time: r.time, inst, name: inst.name || inst.displayTicker || inst.ticker, closed: closedIds.has(inst.id), type: r.type, qty: r.qty, price: Number(t.price), cur: t.currency, fees: t.fees, feesCur: t.feesCur || t.acctCur || t.currency,
        seq, amt: r.amt, costCur: led.cur, qtyAfter: r.qtyAfter, costAfter: r.costAfter, pruAfter: r.pruAfter, realized: r.realized, realizedPct: r.realizedPct, issue: r.issue, source: t.source });
    });
  });
  return out;
}
function opColumns() {
  const mny = (v, c, d) => (v == null ? '<span class="muted">—</span>' : fmtMoney(v, c, d));
  return [
    { key: 'date', label: 'Date', essential: true, sort: (r) => r.date + ' ' + r.time + ' ' + String(r.seq).padStart(5, '0'), html: (r) => esc(fmtDate(r.date)) + (r.time ? ' <small class="muted">' + esc(r.time) + '</small>' : '') },
    { key: 'asset', label: 'Actif', essential: true, sort: (r) => (r.name || '').toLowerCase(), html: (r) => '<span class="asset">' + avatar(r.inst.displayTicker || r.inst.ticker, r.inst.logo, 'sm', r.inst.isin) + '<span><span class="nm">' + esc(r.name) + '</span><span class="tkr">' + esc(r.inst.isin || r.inst.displayTicker || '') + (r.closed ? ' · clôturée' : '') + '</span></span></span>' },
    { key: 'type', label: 'Opération', essential: true, sort: (r) => r.type, html: (r) => (r.type === 'buy' ? '<span class="badge received">Achat</span>' : '<span class="badge warn">Vente</span>') },
    { key: 'qty', label: 'Quantité', essential: true, align: 'r', sort: (r) => r.qty, html: (r) => fmtNum(r.qty) },
    { key: 'price', label: 'Prix unitaire', align: 'r', sort: (r) => r.price, html: (r) => fmtMoney(r.price, r.cur, { d: 4 }) },
    { key: 'fees', label: 'Frais', align: 'r', sort: (r) => r.fees, html: (r) => (r.fees ? fmtMoney(r.fees, r.feesCur) : '—') },
    { key: 'amt', label: 'Montant', align: 'r', sort: (r) => r.amt, html: (r) => mny(r.amt, r.costCur) },
    { key: 'qtyAfter', label: 'Qté après', essential: true, align: 'r', sort: (r) => r.qtyAfter, html: (r) => fmtNum(r.qtyAfter) },
    { key: 'costAfter', label: 'Coût cumulé', align: 'r', sort: (r) => r.costAfter, html: (r) => mny(r.costAfter, r.costCur) },
    { key: 'pru', label: 'PRU après', essential: true, align: 'r', sort: (r) => r.pruAfter, html: (r) => mny(r.pruAfter, r.costCur, { d: 2 }) },
    { key: 'realized', label: 'Résultat réalisé', essential: true, align: 'r', sort: (r) => r.realized, html: (r) => (r.type === 'buy' ? '' : r.realized == null ? '<span class="muted" title="' + esc(r.issue || 'Données insuffisantes') + '">—</span>' : '<b class="' + (r.realized >= 0 ? 'pos' : 'neg') + '">' + (r.realized >= 0 ? '+' : '') + fmtMoney(r.realized, r.costCur) + '</b>' + (r.realizedPct != null ? ' <small class="muted">' + fmtPct(r.realizedPct, 1, true) + '</small>' : '')) },
    { key: 'currency', label: 'Devise d\'origine', sort: (r) => r.cur, html: (r) => esc(r.cur || '') },
    { key: 'source', label: 'Source', sort: (r) => r.source, html: (r) => esc({ degiro: 'DEGIRO', csv: 'Import CSV', manual: 'Saisie' }[r.source] || r.source || '—') }
  ];
}
function portTabsHtml() {
  const nClosed = (state.archive || []).length;
  return '<div class="seg" id="portTab" role="tablist"><button type="button" data-pt="positions" class="' + (view.port.tab === 'positions' ? 'on' : '') + '">Positions</button><button type="button" data-pt="ops" class="' + (view.port.tab === 'ops' ? 'on' : '') + '">Opérations</button>' +
    (nClosed ? '<button type="button" data-pt="closed" class="' + (view.port.tab === 'closed' ? 'on' : '') + '">Clôturées (' + nClosed + ')</button>' : '') + '</div>';
}
function wirePortTabs(host) { $$('#portTab [data-pt]', host).forEach((b) => b.onclick = () => { view.port.tab = b.dataset.pt; renderPortfolio(host); }); }

function renderOperations(host) {
  const o = view.ops, insts = visibleInstruments().filter((x) => state.transactions.some((t) => t.holdingId === x.id)).sort((a, b) => (a.name || a.ticker || '').localeCompare(b.name || b.ticker || ''));
  if (o.asset !== 'all' && !insts.some((x) => x.id === o.asset)) o.asset = 'all';
  const closedIds = new Set((state.archive || []).map((a) => a.id));
  const rows = opRows();
  const cfg = { id: 'ops', columns: opColumns(), rows, getId: (r) => r.id, selectable: false, sortKey: 'date', sortDir: -1, pageSize: 100,
    empty: '<div class="card empty"><h3>Aucune opération' + (state.transactions.length ? ' pour ces filtres' : ' enregistrée') + '</h3><p>' + (state.transactions.length ? 'Modifiez les filtres.' : 'Importez l\'historique de vos transactions DEGIRO pour reconstituer vos achats, ventes, prix de revient et l\'évolution de votre portefeuille.') + '</p>' + (state.transactions.length ? '' : '<button class="btn primary" data-do="import-degiro" type="button">' + icon('upload') + 'Importer l\'historique DEGIRO</button>') + '</div>',
    footer: (rs) => { const cs = new Set(rs.map((r) => r.costCur)); const re = rs.filter((r) => r.realized != null).reduce((s, r) => s + r.realized, 0); return { date: rs.length + ' opération(s)', realized: cs.size === 1 && rs.some((r) => r.type === 'sell') ? '<span class="' + (re >= 0 ? 'pos' : 'neg') + '">' + (re >= 0 ? '+' : '') + fmtMoney(re, Array.from(cs)[0]) + '</span>' : '—' }; } };
  let detail = '';
  if (o.asset !== 'all') {
    const inst = instrumentById(o.asset), led = inst && ledgerOf(inst);
    if (led) detail = '<div class="grid kpis sum-strip' + (state.settings.hideNumbers ? ' hide-nums' : '') + '" style="margin-bottom:12px">' +
      kpiCard('Statut', closedIds.has(inst.id) ? 'Clôturée' : 'Détenue', esc(fmtDate(led.first)) + ' → ' + esc(fmtDate(led.last))) + kpiCard('Quantité', fmtNum(led.qty), led.qty > 0 ? 'après la dernière opération' : 'position soldée') +
      kpiCard('PRU', led.pru != null && led.qty > 0 ? fmtMoney(led.pru, led.cur) : '—', led.qty > 0 ? 'Coût de revient ' + fmtMoney(led.cost, led.cur) : '') +
      kpiCard('Résultat réalisé', led.realizedKnown ? (led.realized >= 0 ? '+' : '') + fmtMoney(led.realized, led.cur) : '—', led.realizedKnown ? 'sur les ventes' : 'données insuffisantes', led.realizedKnown ? (led.realized >= 0 ? 'income' : 'neg') : '') + '</div>';
  }
  host.innerHTML = pageHead('Mon portefeuille', state.holdings.length + ' position(s) · ' + (state.archive || []).length + ' clôturée(s) · ' + state.transactions.length + ' opération(s)',
    '<button class="btn" type="button" data-do="import-degiro">' + icon('upload') + 'Importer l\'historique DEGIRO</button>') +
    '<div class="toolbar">' + portTabsHtml() +
    '<select id="opAsset" aria-label="Actif" style="width:auto;max-width:200px"><option value="all">Tous les actifs</option>' + insts.map((x) => '<option value="' + esc(x.id) + '">' + esc(x.name || x.displayTicker || x.ticker) + (closedIds.has(x.id) ? ' (clôturée)' : '') + '</option>').join('') + '</select>' +
    '<select id="opType" aria-label="Type" style="width:auto"><option value="all">Tous les types</option><option value="buy">Achats</option><option value="sell">Ventes</option></select>' +
    '<label class="inline-f">Du <input type="date" id="opFrom" value="' + esc(o.from) + '"></label><label class="inline-f">au <input type="date" id="opTo" value="' + esc(o.to) + '"></label>' +
    '<span class="grow"></span>' + Tbl.menuHtml(cfg) + '</div>' + detail + '<div id="tblHost"></div>' +
    '<p class="hint" style="margin-top:8px">Coût moyen pondéré, frais d\'achat inclus. Les montants sont dans la devise du compte (EUR pour DEGIRO) ; le prix unitaire reste dans la devise de cotation d\'origine.</p>';
  $('#opAsset', host).value = o.asset; $('#opType', host).value = o.type;
  [['opAsset', 'asset'], ['opType', 'type'], ['opFrom', 'from'], ['opTo', 'to']].forEach((x) => { $('#' + x[0], host).onchange = (e) => { o[x[1]] = e.target.value; renderOperations(host); }; });
  wirePortTabs(host); Tbl.render($('#tblHost'), cfg); wireDo(host);
}

function renderClosed(host) {
  const arch = (state.archive || []).filter((a) => { const ids = visibleIds(); return !ids || ids.has(a.id); });
  const rows = arch.map((a) => { const led = ledgerOf(a); return { a, led }; }).filter((x) => x.led).sort((x, y) => (y.led.last || '').localeCompare(x.led.last || ''));
  const body = rows.length ? '<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Actif</th><th>Période</th><th class="r">Investi</th><th class="r">Produit des ventes</th><th class="r">Résultat réalisé</th><th></th></tr></thead><tbody>' + rows.map((x) => {
    const buys = x.led.rows.filter((r) => r.type === 'buy' && r.amt != null).reduce((s, r) => s + r.amt, 0), sells = x.led.rows.filter((r) => r.type === 'sell' && r.amt != null).reduce((s, r) => s + r.amt, 0);
    const pct = x.led.realizedKnown && buys > 0 ? x.led.realized / buys : null;
    return '<tr><td><span class="asset">' + avatar(x.a.displayTicker || x.a.ticker, x.a.logo, 'sm', x.a.isin) + '<span><span class="nm">' + esc(x.a.name || x.a.displayTicker) + '</span><span class="tkr">' + esc(x.a.isin || '') + (x.a.hist ? '' : ' · cours passés non récupérés') + '</span></span></span></td>' +
      '<td>' + esc(fmtDate(x.led.first)) + ' → ' + esc(fmtDate(x.led.last)) + '</td><td class="r">' + fmtMoney(buys, x.led.cur) + '</td><td class="r">' + fmtMoney(sells, x.led.cur) + '</td>' +
      '<td class="r">' + (x.led.realizedKnown ? '<b class="' + (x.led.realized >= 0 ? 'pos' : 'neg') + '">' + (x.led.realized >= 0 ? '+' : '') + fmtMoney(x.led.realized, x.led.cur) + '</b>' + (pct != null ? ' <small class="muted">' + fmtPct(pct, 1, true) + '</small>' : '') : '—') + '</td>' +
      '<td class="r"><button class="btn sm" type="button" data-opsof="' + esc(x.a.id) + '">Opérations</button></td></tr>';
  }).join('') + '</tbody></table></div>' : '<div class="card empty"><h3>Aucune position clôturée</h3><p>Les actifs entièrement vendus apparaissent ici (ils ne figurent plus dans les positions actuelles).</p></div>';
  host.innerHTML = pageHead('Mon portefeuille', rows.length + ' position(s) entièrement vendue(s)', '<button class="btn" type="button" data-do="import-degiro">' + icon('upload') + 'Importer l\'historique DEGIRO</button>') +
    '<div class="toolbar">' + portTabsHtml() + '<span class="grow"></span></div>' + body + '<p class="hint" style="margin-top:8px">Ces positions restent dans l\'historique (calcul des résultats réalisés et reconstitution de l\'évolution passée du portefeuille). « Actualiser » récupère leurs cours passés.</p>';
  wirePortTabs(host); wireDo(host);
  $$('[data-opsof]', host).forEach((b) => b.onclick = () => { view.port.tab = 'ops'; view.ops.asset = b.dataset.opsof; renderPortfolio(host); });
}
