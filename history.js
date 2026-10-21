/* ==================================================================
   history.js — import intelligent de l'historique DEGIRO (aperçu, rapprochement, confirmation,
   retour arrière), opérations par actif (quantité / coût / PRU après chaque opération, résultat
   réalisé) et positions clôturées. La logique de calcul est dans ledger.js (module pur testé).
   ================================================================== */

const instrumentById = (id) => state.holdings.find((h) => h.id === id) || (state.archive || []).find((a) => a.id === id) || null;

/* ---------------------------------------------------------------
   LECTURE DU FICHIER (encodage détecté : UTF-8 puis Windows-1252)
   --------------------------------------------------------------- */
const IMPORT_ACCEPT = '.csv,.txt,.xlsx,.xls,.pdf';
const PDFJS_VER = '3.11.174';

/* PDF → lignes de cellules (même forme qu'un CSV). Fonction pure : pages = [[{ str, x, y, w }]]. Les éléments d'une même ligne (écart vertical ≤ 3) sont triés
   de gauche à droite ; deux éléments séparés de moins de 3 unités forment une seule cellule. Rien n'est deviné : le résultat passe par le même aperçu
   et la même confirmation qu'un CSV. */
function rowsFromPdfItems(pages) {
  const rows = [];
  (pages || []).forEach((items) => {
    const its = (items || []).filter((i) => i && String(i.str).trim() !== '').slice().sort((a, b) => b.y - a.y || a.x - b.x), lines = [];
    its.forEach((it) => { const l = lines.find((x) => Math.abs(x.y - it.y) <= 3); if (l) l.items.push(it); else lines.push({ y: it.y, items: [it] }); });
    lines.sort((a, b) => b.y - a.y).forEach((l) => {
      const cells = []; let prevEnd = null;
      l.items.sort((a, b) => a.x - b.x).forEach((it) => {
        const str = String(it.str).trim(), spaced = /^\s/.test(String(it.str)) || it.x - prevEnd > 0.5;
        if (cells.length && prevEnd !== null && it.x - prevEnd < 3) cells[cells.length - 1] += (spaced || /\s$/.test(it.prev || '') ? ' ' : '') + str; else cells.push(str);
        prevEnd = it.x + (it.w || 0);
      });
      rows.push(cells);
    });
  });
  return rows;
}
function loadPdfJs() {
  if (window.pdfjsLib) return Promise.resolve(window.pdfjsLib);
  return new Promise((resolve, reject) => {
    const sc = document.createElement('script'); sc.src = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@' + PDFJS_VER + '/build/pdf.min.js';
    sc.onload = () => { try { window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@' + PDFJS_VER + '/build/pdf.worker.min.js'; resolve(window.pdfjsLib); } catch (e) { reject(e); } };
    sc.onerror = () => reject(new Error('Lecteur PDF indisponible (hors-ligne ?). Exportez plutôt le fichier en CSV ou Excel.'));
    document.head.appendChild(sc);
  });
}
async function readPdfRows(file) {
  const lib = await loadPdfJs(), doc = await lib.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise, pages = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const tc = await (await doc.getPage(p)).getTextContent();
    pages.push(tc.items.filter((i) => typeof i.str === 'string').map((i) => ({ str: i.str, x: i.transform[4], y: i.transform[5], w: i.width || 0 })));
  }
  const rows = rowsFromPdfItems(pages);
  if (!rows.length) throw new Error('Ce PDF ne contient pas de texte exploitable (document scanné ou image). Exportez le fichier en CSV ou Excel depuis votre courtier.');
  return rows;
}

async function readHistoryRows(file) {
  const name = file.name.toLowerCase();
  if (/\.pdf$/.test(name)) return { rows: (await readPdfRows(file)).filter((r) => r.some((c) => String(c).trim() !== '')), enc: 'PDF (texte extrait)' };
  if (/\.(xlsx|xls)$/.test(name)) return { rows: (await readFileRows(file)).filter((r) => r && r.some((c) => String(c).trim() !== '')), enc: 'Excel' };
  const buf = await file.arrayBuffer();
  let text, enc = 'UTF-8';
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(buf); } catch (e) { text = new TextDecoder('windows-1252').decode(buf); enc = 'Windows-1252'; }
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
  if (typeof Papa === 'undefined') throw new Error('Bibliothèque CSV indisponible (hors-ligne ?).');
  return { rows: Papa.parse(text, { skipEmptyLines: true }).data.filter((r) => r && r.some((c) => String(c).trim() !== '')), enc, text, size: buf.byteLength };
}

/* ---------------------------------------------------------------
   IMPORT DE L'HISTORIQUE DEGIRO
   --------------------------------------------------------------- */
const DG_FIELDS = [['date', 'Date', 1], ['time', 'Heure', 0], ['product', 'Produit', 1], ['isin', 'ISIN', 0], ['qty', 'Quantité', 1], ['price', 'Cours', 1], ['priceCur', 'Devise du cours', 0],
  ['valueAcct', 'Valeur (devise du compte)', 0], ['fee1', 'Frais (1)', 0], ['fee2', 'Frais (2)', 0], ['total', 'Total frais compris', 0], ['orderId', 'ID de l\'ordre', 0], ['description', 'Description (relevé de compte)', 0]];

/* Nature du fichier : historique de transactions (date + quantité + cours + produit/ISIN), relevé de portefeuille (ISIN + quantité, sans date) ou inconnu. */
function sniffImport(rows) {
  const det = Ledger.detect(rows), c = det.cols;
  const hasProd = c.isin !== undefined || c.product !== undefined;
  if (det.headerIdx >= 0 && c.date !== undefined && hasProd && ((c.qty !== undefined && c.price !== undefined) || det.statement)) {
    // un export de positions peut avoir une colonne « date du cours » : on exige un indice de transactions (ID d'ordre, montants, quantité négative, même actif répété)
    const body = rows.slice(det.headerIdx + 1), key = c.isin !== undefined ? c.isin : c.product, seen = new Set();
    const dup = key !== undefined && body.some((r) => { const k = String(r[key] || '').trim().toUpperCase(); if (!k) return false; if (seen.has(k)) return true; seen.add(k); return false; });
    const neg = c.qty !== undefined && body.some((r) => /^\s*[-\u2212(]/.test(String(r[c.qty] || '')));
    if (det.statement || c.orderId !== undefined || (c.total !== undefined && c.fx !== undefined) || neg || dup) return 'history';
  }
  const pos = Ledger.parsePositions(rows);
  if (pos.positions && pos.positions.length && c.date === undefined) return 'positions';
  return 'unknown';
}
/* Point d'entrée unique de tous les boutons d'import : le fichier est lu une fois (encodage détecté), reconnu, puis envoyé au bon écran.
   « want » : ce que le bouton cliqué attendait ('history' | 'positions' | 'generic'). */
async function routeImport(want) {
  const file = await pickFile(IMPORT_ACCEPT); if (!file) return;
  let data; try { data = await readHistoryRows(file); } catch (e) { toast(e.message, { error: true }); return; }
  if (!data.rows.length) { toast('Fichier vide ou illisible.', { error: true }); return; }
  let kind = sniffImport(data.rows);
  if (kind === 'history' && want === 'generic' && Ledger.detect(data.rows).cols.type !== undefined) kind = 'unknown';      // colonne « type » (Trade Republic…) : import générique, qui gère aussi les dividendes
  if (kind === 'history') {
    if (want !== 'history') toast('Fichier d\'historique de transactions reconnu : ouverture de l\'import DEGIRO.');
    renderDegiroModal(data.rows, data.enc, file.name, null, { text: data.text || null, size: data.size || file.size, pendingRef: null }); return;
  }
  if (kind === 'positions') {
    if (want !== 'positions') toast('Relevé de portefeuille reconnu : ouverture de l\'import des positions.');
    renderPositionsMapping(data.rows, guessHeaderRow(data.rows, [['symbole', 'symbol', 'ticker', 'isin', 'code'], ['quantite', 'quantity', 'nombre', 'qty', 'position', 'en portefeuille']])); return;
  }
  if (want === 'history') { renderDegiroModal(data.rows, data.enc, file.name, null, { text: data.text || null, size: data.size || file.size, pendingRef: null }); return; }   // colonnes à indiquer à la main
  if (want === 'positions') { renderPositionsMapping(data.rows, guessHeaderRow(data.rows, [['symbole', 'symbol', 'ticker', 'isin', 'code'], ['quantite', 'quantity', 'nombre', 'qty', 'position', 'en portefeuille']])); return; }
  renderTxMapping(data.rows, guessHeaderRow(data.rows, [['date', 'datetime', 'time'], ['type', 'operation', 'transaction', 'category', 'description']]), {});
}
const openImportDegiro = () => routeImport('history');

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

function renderDegiroModal(rows, enc, fileName, hIdx, ctx) {
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
    fld('Positions réelles de référence', '<select id="dgRef"></select>', 'Sert à repérer les anciennes positions qui ne sont plus détenues (changement d\'ISIN, fusion, split absent du CSV). Sans référence, une position calculée est créée sans contre-vérification.', 'dgRef') +
    '<div class="btn-row" style="margin:-4px 0 8px"><button class="btn sm" type="button" id="dgRefLoad">' + icon('upload') + 'Charger le relevé de portefeuille DEGIRO (positions réelles)…</button></div>' +
    '<div id="dgSummary" class="dg-summary"></div>' +
    '<div class="sec">Actifs du fichier</div><div id="dgInst"></div>' +
    '<label class="chk"><input type="checkbox" id="dgZero" checked><span>Importer aussi les <b>mouvements de titres sans montant</b> (actions gratuites, droits, retraits, échanges) <small>— sans eux, certaines positions restent à tort ouvertes ou négatives</small></span></label>' +
    '<label class="chk hide" id="dgDivRow"><input type="checkbox" id="dgDiv" checked><span>Ajouter aussi les <b>dividendes du relevé de compte</b> (montants réels du courtier : brut, retenue à la source, net) <small>— un dividende déjà enregistré n\'est jamais dupliqué ; une estimation de marché du même versement est remplacée par le montant réel</small></span></label>' +
    '<label class="chk"><input type="checkbox" id="dgFill" checked><span>Compléter uniquement les informations <b>manquantes</b> des positions existantes (PRU vide, ISIN absent)</span></label>' +
    '<details class="dg-cols" id="dgPrevBox"><summary>Aperçu des opérations reconnues</summary><div id="dgPrev"></div></details>' +
    '<details class="dg-cols" id="dgIssuesBox"><summary id="dgIssuesSum">Lignes à vérifier</summary><div id="dgIssues"></div></details>' +
    '<div id="dgConfirm" class="notice info hide" style="margin-top:8px"></div>' +
    '<div class="modal-actions"><span></span><div class="btn-row"><button class="btn" type="button" data-close>Annuler</button><button class="btn primary" type="button" id="dgGo">Importer</button></div></div>', { wide: true });
  $('#dgH', m).onchange = (e) => { closeModal(); renderDegiroModal(rows, enc, fileName, Number(e.target.value), ctx); };
  const detNow = () => {
    const v = (k) => { const x = Number($('#dg_' + k, m).value); return x >= 0 ? x : undefined; };
    const fees = [v('fee1'), v('fee2')].filter((x) => x !== undefined);
    const cols = { fees, date: v('date'), time: v('time'), product: v('product'), isin: v('isin'), qty: v('qty'), price: v('price'), priceCur: v('priceCur'), valueAcct: v('valueAcct'), total: v('total'), orderId: v('orderId'), description: v('description') };
    ['localValue', 'localCur', 'fx', 'type', 'change', 'changeCur'].forEach((k) => { if (det0.cols[k] !== undefined) cols[k] = det0.cols[k]; });
    return Object.assign({}, det0, { cols, headerIdx: hi, statement: cols.qty === undefined && cols.description !== undefined });
  };
  let cur = null;
  const refChoices = () => {            // positions réelles disponibles : relevé DEGIRO chargé, positions saisies/importées de l'application, ou rien
    const acc = $('#dgAcc', m).value, out = [], file = ctx.pendingRef || state.reference;
    if (file && file.positions && file.positions.length) out.push(['file', 'Relevé de portefeuille DEGIRO (' + file.positions.length + ' position(s)' + (file.at ? ', ' + fmtDate(file.at.slice(0, 10)) : '') + ')']);
    const app = Ledger.referenceOf(state, acc, 'app'); if (app.mode === 'app') out.push(['app', 'Mes positions actuelles saisies ou importées (' + app.map.size + ')']);
    out.push(['none', 'Aucune (non recommandé)']); return out;
  };
  const fillRef = (keep) => { const sel = $('#dgRef', m), prev = keep ? sel.value : null, ch = refChoices(); sel.innerHTML = ch.map((c) => opt(c[0], c[1], false)).join(''); sel.value = prev && ch.some((c) => c[0] === prev) ? prev : ch[0][0]; };
  const buildRef = (acc) => {
    const v = $('#dgRef', m).value;
    if (v === 'none') return { mode: null, map: new Map() };
    if (v === 'file') { const f = ctx.pendingRef || state.reference, map = new Map(); (f.positions || []).forEach((p) => map.set(p.isin, p)); return { mode: 'file', map }; }
    return Ledger.referenceOf(state, acc, 'app');
  };
  const refresh = () => {
    const det = detNow(), res = Ledger.parseOps(rows, det, { zeroMode: $('#dgZero', m).checked ? 'import' : 'skip' }), acc = $('#dgAcc', m).value;
    const pl = Ledger.plan(state, res.ops, { account: acc === '__new__' ? '__new__' : acc, reference: buildRef(acc === '__new__' ? '__new__' : acc) });
    cur = { det, res, pl, acc, ctx, fileName, rows: rows.length, divGroups: Ledger.groupDividends(res.divs || []) };
    drawDegiro(m, cur);
    return cur;
  };
  fillRef(false);
  $('#dgAcc', m).addEventListener('change', () => fillRef(true));
  $('#dgRefLoad', m).onclick = async () => {
    const f = await pickFile(IMPORT_ACCEPT); if (!f) return;
    try { const d = await readHistoryRows(f), r = Ledger.parsePositions(d.rows); if (!r.positions.length) { toast(r.error || 'Aucune position (ISIN + quantité) reconnue dans ce fichier.', { error: true }); return; }
      ctx.pendingRef = { at: new Date().toISOString(), name: f.name, positions: r.positions }; fillRef(false); refresh(); toast(r.positions.length + ' position(s) réelle(s) chargée(s) comme référence.'); }
    catch (e) { toast(e.message, { error: true }); }
  };
  $$('select', m).forEach((s) => { if (s.id !== 'dgH') s.addEventListener('change', () => refresh()); });
  $('#dgZero', m).addEventListener('change', () => refresh());
  m.addEventListener('change', (e) => { if (e.target.matches('[data-inc],[data-align],#dgFill,#dgDiv')) drawDegiro(m, cur, true); });
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
  const { pl, res } = cur, on = (i) => !ch.off[i.key];
  const inc = pl.instruments.filter(on);
  const sum = (f) => inc.reduce((s, i) => s + f(i), 0);
  const warnOps = sum((i) => i.warnCount), nChk = inc.filter((i) => i.status === 'check' || (i.status === 'archive' && i.check)).length;
  return {
    detected: res.ops.length, divGroups: (cur.divGroups || []).length, newTx: sum((i) => i.newOps.length), dups: pl.instruments.reduce((s, i) => s + i.dupOps.length, 0), corp: res.corp.length,
    newPos: inc.filter((i) => i.status === 'create' || i.status === 'reopen').length, kept: pl.instruments.filter((i) => i.status === 'holding').length,
    aligned: inc.filter((i) => ch.align[i.key]).length, recomputed: inc.filter((i) => i.recompute).length, filled: ch.fill ? inc.filter((i) => i.status === 'holding' && (i.fill.avgCost || i.fill.isin || i.fill.name)).length : 0,
    closed: inc.filter((i) => i.status === 'closed').length, check: nChk, review: warnOps + res.ambiguous.length + res.bad.length + nChk, diverg: pl.instruments.filter((i) => i.divergence)
  };
}

function drawDegiro(m, cur, keepChoices) {
  if (m.dataset.confirming === '1') { m.dataset.confirming = ''; const bx = $('#dgConfirm', m); if (bx) bx.classList.add('hide'); }
  const ch = keepChoices ? degiroChoices(m, cur.pl) : { off: {}, align: {}, fill: true };
  const { pl, res, det } = cur, t = degiroTotals(cur, ch);
  const fmtQ = (q) => fmtNum(q);
  const missing = det.missing.length;
  const statusCell = (i) => {
    const note = (x) => '<div class="dg-note">' + x + '</div>';
    if (i.status === 'check' || (i.status === 'archive' && i.check)) return '<span class="badge warn">À vérifier</span> ' + note(esc((i.check && i.check.msg) || i.reasons.join(' ')) + ' <b>Pas ajoutée au portefeuille actuel</b> : les opérations sont conservées, à corriger dans « Contrôle de l\'historique ».');
    if (i.status === 'create') return '<span class="badge received">Nouvelle position</span>' + (i.reasons.length ? note(i.reasons.map(esc).join(' ')) : '');
    if (i.status === 'reopen') return '<span class="badge received">Position rachetée</span>' + note('Réouverture de l\'actif soldé, historique relié.');
    if (i.status === 'closed') return '<span class="badge">Soldée</span>' + note('Vendue en totalité : <b>pas ajoutée</b> au portefeuille actuel, opérations conservées dans l\'historique (résultat réalisé : ' + (i.led.realizedKnown ? fmtMoney(i.led.realized, i.acctCur) : 'inconnu') + ').');
    if (i.status === 'archive') return '<span class="badge">Déjà archivée</span>';
    let s = '<span class="badge info">Déjà présente</span> ' + note(i.recompute ? 'Position issue de l\'import : <b>recalculée</b> ' + fmtQ(i.update.from) + ' → ' + fmtQ(i.update.to) + (i.update.pruTo != null ? ', PRU ' + fmtMoney(i.update.pruTo, i.acctCur) : '') + '.' : 'Position et PRU <b>conservés</b>.');
    if (i.divergence) s += note('<span class="warn-t">Quantité : application ' + fmtQ(i.divergence.app) + ' ≠ historique ' + fmtQ(i.divergence.file) + '</span> (un fractionnement ou une opération sur titres manque peut-être).');
    if (i.pruDiff) s += note('PRU saisi ' + fmtMoney(i.pruDiff.app, i.pruDiff.cur) + ' ≠ PRU calculé ' + fmtMoney(i.pruDiff.file, i.pruDiff.cur) + '.');
    const fills = []; if (i.fill.avgCost) fills.push('PRU manquant → ' + fmtMoney(i.fill.avgCost.value, i.fill.avgCost.cur)); if (i.fill.isin) fills.push('ISIN'); if (i.fill.name) fills.push('nom');
    if (fills.length) s += note('Sera complété : ' + fills.join(', ') + '.');
    if (i.divergence || i.pruDiff) s += '<label class="chk dg-align"><input type="checkbox" data-align="' + esc(i.key) + '"' + (ch.align[i.key] ? ' checked' : '') + '><span>Aligner quantité et PRU sur l\'historique <small>(remplace les valeurs de l\'application)</small></span></label>';
    return s;
  };
  const rowsH = pl.instruments.slice().sort((a, b) => ({ check: 0, holding: 1, create: 2, reopen: 2, closed: 3, archive: 4 }[a.status] - { check: 0, holding: 1, create: 2, reopen: 2, closed: 3, archive: 4 }[b.status]) || (a.name || '').localeCompare(b.name || '')).map((i) =>
    '<tr class="dg-row"><td class="chk-col"><input type="checkbox" data-inc="' + esc(i.key) + '" ' + (ch.off[i.key] ? '' : 'checked') + ' aria-label="Importer"></td>' +
    '<td><b>' + esc(i.name || i.isin) + '</b><div class="dg-note">' + esc(i.isin) + (i.currency ? ' · ' + esc(i.currency) : '') + '</div></td>' +
    '<td class="r">' + i.newOps.length + ' / ' + i.ops.length + (i.dupOps.length ? '<div class="dg-note">' + i.dupOps.length + ' doublon(s)</div>' : '') + '</td>' +
    '<td class="r">' + (i.led.negative ? '<span class="neg">' + fmtQ(i.led.qty) + ' (négatif)</span>' : fmtQ(i.led.qty)) + '</td><td class="r">' + (i.led.pru != null && i.led.qty > 0 ? fmtMoney(i.led.pru, i.acctCur) : '—') + '</td><td>' + statusCell(i) + '</td></tr>').join('');
  $('#dgInst', m).innerHTML = pl.instruments.length ? '<div class="tbl-wrap" style="max-height:340px"><table class="tbl dg-tbl"><thead><tr><th class="chk-col"></th><th>Actif</th><th class="r">Opérations<br><small>nouvelles / fichier</small></th><th class="r">Quantité<br><small>d\'après l\'historique</small></th><th class="r">PRU calculé</th><th>Traitement</th></tr></thead><tbody>' + rowsH + '</tbody></table></div>'
    : '<div class="muted">Aucun achat ou vente reconnu.</div>';
  const li = (n, label, strong) => '<li><b' + (strong ? ' class="' + strong + '"' : '') + '>' + n + '</b> ' + label + '</li>';
  const refMode = pl.reference && pl.reference.mode;
  $('#dgSummary', m).innerHTML = '<ul>' + li(t.detected, 'transaction(s) détectée(s)') + li(t.dups, 'déjà connue(s) / doublon(s) ignoré(s)') + li(t.newTx, 'nouvelle(s) à ajouter', 'pos') + li(res.ops.filter((o) => o.zero).length, 'mouvement(s) de titres sans montant importé(s) (livraisons gratuites, retraits : quantité modifiée, coût inchangé, aucun résultat inventé)') + li(t.corp - res.ops.filter((o) => o.zero).length, 'autre(s) opération(s) sur titres détectée(s) (split, échange…) : listées, jamais appliquées sans votre validation') +
    li(t.newPos, 'position(s) nouvelle(s) à créer') + li(t.kept, 'position(s) existante(s) conservée(s)' + (t.recomputed ? ' (dont <b>' + t.recomputed + ' recalculée(s)</b> depuis les transactions : positions issues de l\'import)' : '') + (t.filled ? ' (dont ' + t.filled + ' complétée(s) d\'une information manquante)' : '') + (t.aligned ? ', <b>' + t.aligned + ' alignée(s) : quantité et PRU remplacés sur votre demande</b>' : '')) +
    (t.divGroups ? li(t.divGroups, 'dividende(s) du relevé de compte (source confirmée : brut, retenue, net réels), ajoutés si la case est cochée', 'pos') : '') + li(t.closed, 'position(s) vendue(s) en totalité, non ajoutée(s) au portefeuille actuel') + li(t.check, 'actif(s) à vérifier, conservés dans l\'historique mais non ajoutés au portefeuille actuel', t.check ? 'warn-t' : '') + li(t.review, 'opération(s)/ligne(s) nécessitant une vérification', t.review ? 'warn-t' : '') + '</ul>' +
    (!refMode ? '<div class="notice warn" style="margin-top:6px">Aucune position réelle de référence : une position calculée est créée sans contre-vérification (risque d\'anciennes positions fantômes après un changement d\'ISIN ou un split). Chargez le relevé de portefeuille DEGIRO pour fiabiliser.</div>' : '') +
    (t.diverg.length ? '<div class="notice warn" style="margin-top:6px">Divergences de quantité : ' + t.diverg.map((i) => '<b>' + esc(i.name || i.isin) + '</b> (application ' + fmtQ(i.divergence.app) + ', historique ' + fmtQ(i.divergence.file) + ')').join(' · ') + '. Rien n\'est modifié sans votre accord.</div>' : '') +
    (missing ? '<div class="notice warn" style="margin-top:6px">Colonnes essentielles non reconnues : <b>' + esc(det.missing.join(', ')) + '</b>. Indiquez-les dans « Colonnes reconnues ».</div>' : '') +
    (t.newTx === 0 && t.detected > 0 && !missing ? '<div class="notice info" style="margin-top:6px">Tout est déjà présent : l\'import ne changerait rien.</div>' : '') +
    (res.other.length ? '<div class="hint" style="margin-top:6px">' + res.other.length + ' autre(s) mouvement(s) ignoré(s) (' + esc(Object.entries(res.report.other).map((e) => e[1] + ' ' + e[0]).join(', ')) + ') — dividendes, dépôts, retraits, frais, conversions de devises : jamais traités comme des achats ou des ventes.</div>' : '');
  const sample = res.ops.slice().sort((a, b) => Ledger.orderKey(a, b)).slice(-10).reverse();
  $('#dgPrev', m).innerHTML = sample.length ? '<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Date</th><th>Actif</th><th>Opération</th><th class="r">Qté</th><th class="r">Cours</th><th class="r">Frais</th><th class="r">Total</th></tr></thead><tbody>' + sample.map((o) =>
    '<tr><td>' + esc(fmtDate(o.date)) + (o.time ? ' <small class="muted">' + esc(o.time) + '</small>' : '') + '</td><td>' + esc(o.name || o.isin) + '</td><td>' + (o.zero ? (o.type === 'buy' ? 'Livraison gratuite' : 'Retrait de titres') : o.type === 'buy' ? 'Achat' : 'Vente') + '</td><td class="r">' + fmtQ(o.qty) + '</td><td class="r">' + fmtMoney(o.price, o.priceCur, { d: 4 }) + '</td><td class="r">' + (o.fees != null ? fmtMoney(o.fees, o.acctCur) : '—') + '</td><td class="r">' + (o.amt != null ? fmtMoney(o.amt, o.acctCur) : '—') + '</td></tr>').join('') +
    '</tbody></table></div><div class="hint">10 opérations les plus récentes sur ' + res.ops.length + '.</div>' : '<div class="muted">Aucune opération.</div>';
  const issues = [].concat(res.bad.map((b) => ({ line: b.line, k: 'Illisible', msg: b.reason })), res.ambiguous.map((b) => ({ line: b.line, k: 'Ambiguë', msg: b.reason })),
    res.ops.filter((o) => o.warn.length).map((o) => ({ line: o.line, k: 'Alerte', msg: o.warn.join(' ; ') + ' — ' + (o.name || o.isin) })),
    res.corp.map((c) => ({ line: c.line, k: 'Opération sur titres', msg: (c.name || c.isin || '') + ' — ' + c.desc + (c.ratio ? ' (ratio détecté ' + c.ratio + ' : à valider dans le contrôle)' : '') })),
    pl.instruments.filter((i) => i.status === 'check' || (i.status === 'archive' && i.check)).map((i) => ({ line: i.ops[0].line, k: 'À vérifier', msg: (i.name || i.isin) + ' : ' + ((i.check && i.check.msg) || i.reasons.join(' ')) })));
  $('#dgIssuesSum', m).innerHTML = 'Lignes à vérifier (' + issues.length + ')'; $('#dgIssues', m).innerHTML = issues.length ? '<div class="tbl-wrap" style="max-height:200px"><table class="tbl"><tbody>' + issues.slice(0, 200).map((x) => '<tr><td class="r">l. ' + x.line + '</td><td><span class="badge warn">' + x.k + '</span></td><td>' + esc(x.msg) + '</td></tr>').join('') + '</tbody></table></div>' + (issues.length > 200 ? '<div class="hint">200 premières lignes affichées.</div>' : '') : '<div class="muted">Aucune.</div>';
  if (!m.dataset.drawn) { m.dataset.drawn = '1'; $('#dgIssuesBox', m).open = pl.instruments.some((i) => i.status === 'check') || res.bad.length > 0 || res.corp.length > 0; }
  const dRow = $('#dgDivRow', m); if (dRow) dRow.classList.toggle('hide', !t.divGroups);
  const addDivs = t.divGroups > 0 && $('#dgDiv', m) && $('#dgDiv', m).checked;
  const goBtn = $('#dgGo', m); goBtn.disabled = missing > 0 || (!addDivs && t.newTx === 0 && t.aligned === 0 && t.recomputed === 0 && t.filled === 0 && t.newPos === 0 && t.closed === 0 && t.check === 0 && !(pl.instruments.some((i) => i.status === 'archive' && !!i.check !== !!(i.ref && i.ref.ref.check))));
  goBtn.textContent = goBtn.disabled ? 'Rien à importer' : 'Importer (' + t.newTx + ' opération' + (t.newTx > 1 ? 's' : '') + (addDivs ? ' + ' + t.divGroups + ' dividende' + (t.divGroups > 1 ? 's' : '') : '') + ')';
}

async function confirmDegiro(m, cur) {
  const ch = degiroChoices(m, cur.pl), t = degiroTotals(cur, ch);
  const body = '<ul class="dg-conf"><li><b>' + t.newTx + '</b> opération(s) ajoutée(s) à l\'historique (' + t.dups + ' doublon(s) ignoré(s))</li><li><b>' + t.newPos + '</b> position(s) créée(s) avec leur PRU calculé</li><li><b>' + t.closed + '</b> position(s) soldée(s) archivée(s) (non affichée(s) dans le portefeuille actuel)</li>' +
    (t.check ? '<li><b>' + t.check + '</b> actif(s) à vérifier : opérations conservées, <b>aucune position créée</b></li>' : '') + (t.divGroups && $('#dgDiv', m).checked ? '<li><b>' + t.divGroups + '</b> dividende(s) du relevé de compte : montants réels (brut, retenue, net), doublons ignorés</li>' : '') +
    '<li><b>' + t.kept + '</b> position(s) existante(s) conservée(s)' + (t.filled ? ', ' + t.filled + ' complétée(s) d\'une information manquante' : '') + (t.aligned ? ', <b>' + t.aligned + ' alignée(s) sur l\'historique (quantité et PRU remplacés)</b>' : '') + '</li></ul>' +
    '<p>Le fichier d\'origine est conservé comme source d\'import et une copie de vos données est gardée : vous pourrez <b>annuler cet import</b> (Paramètres → Sauvegarde, ou le bouton « Annuler » qui s\'affiche ensuite).</p>';
  const box = $('#dgConfirm', m);
  if (m.dataset.confirming !== '1') {           // 1er clic : récapitulatif explicite dans la fenêtre (rien n'est modifié) ; 2e clic : application
    box.innerHTML = '<b>Confirmer l\'import ?</b>' + body; box.classList.remove('hide'); m.dataset.confirming = '1'; $('#dgGo', m).textContent = 'Confirmer l\'import'; box.scrollIntoView({ block: 'nearest' }); return;
  }
  let accId = cur.acc;
  snapshotForUndo('import de l\'historique DEGIRO');
  if (accId === '__new__') { accId = uid(); state.accounts.push({ id: accId, name: 'DEGIRO' }); }
  const refChoice = $('#dgRef', m).value;
  if (refChoice === 'file' && cur.ctx.pendingRef) state.reference = Object.assign({ account: accId }, cur.ctx.pendingRef);
  const r = Ledger.apply(state, cur.pl, ch, { uid, account: accId });
  // dividendes du relevé de compte : source confirmée (versements existants intacts ; seule une estimation de marché du même versement est remplacée)
  let divRes = null;
  if (cur.divGroups && cur.divGroups.length && $('#dgDiv', m) && $('#dgDiv', m).checked) {
    divRes = Ledger.brokerDividendPayments(state, cur.divGroups, uid);
    if (divRes.replace.length) state.payments = state.payments.filter((p) => !divRes.replace.includes(p.id));
    state.payments.push.apply(state.payments, divRes.add);
  }
  // la source d'import (CSV d'origine) et son rapport restent enregistrés ; les anciens fichiers bruts sont allégés (3 derniers conservés)
  state.imports = state.imports || [];
  state.imports.push({ id: uid(), at: new Date().toISOString(), name: cur.fileName, size: cur.ctx.size || 0, rows: cur.rows, account: accId, report: Object.assign({}, cur.res.report, { newTx: r.tx, dups: t.dups, created: r.created.length, archived: r.archived.length, checked: r.checked.length, corp: cur.res.corp.map((x) => ({ date: x.date, isin: x.isin, name: x.name, desc: x.desc, ratio: x.ratio, zero: !!x.zero })) }),
    raw: cur.ctx.text && cur.ctx.text.length < 3e6 ? cur.ctx.text : null });
  state.imports.slice(0, -3).forEach((x) => { delete x.raw; });
  saveState(); closeModal();
  view.port.tab = 'ops'; view.ops.asset = 'all';
  const parts = [r.tx + ' opération(s)']; if (divRes && divRes.add.length) parts.push(divRes.add.length + ' dividende(s) confirmé(s)'); if (r.created.length) parts.push(r.created.length + ' position(s) créée(s)'); if (r.archived.length) parts.push(r.archived.length + ' soldée(s) archivée(s)'); if (r.checked.length) parts.push(r.checked.length + ' à vérifier'); if (r.filled) parts.push(r.filled + ' complétée(s)'); if (r.aligned) parts.push(r.aligned + ' alignée(s)');
  go('portfolio'); renderPage();
  toast('Import terminé : ' + parts.join(' · ') + '.', { ms: 14000, action: { label: 'Annuler l\'import', fn: undoLastImport } });
  enrichAfterImport(r.created, r.archived.concat(r.checked));
}

/* Cours, dividendes, secteur et fractionnements (relais Yahoo) des nouveaux actifs et des positions soldées / à vérifier, puis contrôle automatique.
   Aucun split n'est appliqué ici : ils sont seulement PROPOSÉS dans le contrôle de l'historique, après comparaison avec les positions réelles. */
async function enrichAfterImport(created, archived) {
  try {
    if (state.settings.relayUrl) {
      if (created.length) await refreshMarket(created, { silent: false });
      if (archived.length) { await refreshArchive(archived, todayISO()); saveState(); }
      ensureFxHistory(); renderPageSoft();
    }
    const d = Ledger.diagnose(state);
    if (d.counts.error || d.counts.warn) { toast(d.counts.error + ' anomalie(s) et ' + d.counts.warn + ' alerte(s) à contrôler dans l\'historique.', { ms: 14000, action: { label: 'Ouvrir le contrôle', fn: openDiagnostic } }); }
  } catch (e) { /* silencieux : l'import est déjà enregistré */ }
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
  const { entries, cur, txs } = Ledger.entriesFor(state, inst);
  if (!txs.length) return null;
  const led = Ledger.run(entries); led.cur = cur; return led;
}
function opRows() {
  const out = [], o = view.ops, closedIds = new Set((state.archive || []).map((a) => a.id));
  visibleInstruments().forEach((inst) => {
    if (o.asset !== 'all' && inst.id !== o.asset) return;
    const led = ledgerOf(inst); if (!led) return;
    led.rows.forEach((r, seq) => {
      if (o.type !== 'all' && r.type !== o.type && !(o.type === 'other' && r.type !== 'buy' && r.type !== 'sell')) return;
      if (o.from && r.date < o.from) return; if (o.to && r.date > o.to) return;
      const t = r.tx || {}, zero = r.type === 'grant' || r.type === 'retire';
      out.push({ id: t.id || r.corpId || (inst.id + ':' + seq), date: r.date, time: r.time, inst, name: inst.name || inst.displayTicker || inst.ticker, closed: closedIds.has(inst.id), type: r.type, qty: r.type === 'removal' ? (r.removedQty || 0) : r.type === 'split' ? null : r.qty, ratio: r.ratio,
        price: r.tx && !zero ? Number(t.price) : null, cur: t.currency, fees: t.fees, feesCur: t.feesCur || t.acctCur || t.currency,
        seq, amt: r.type === 'split' || r.type === 'removal' ? null : r.amt, costCur: led.cur, qtyAfter: r.qtyAfter, costAfter: r.costAfter, pruAfter: r.pruAfter, realized: r.realized, realizedPct: r.realizedPct, issue: r.issue, source: t.source || r.source });
    });
  });
  return out;
}
const OP_LABEL = { buy: ['Achat', 'received'], sell: ['Vente', 'warn'], grant: ['Livraison gratuite', 'info'], retire: ['Retrait de titres', 'warn'], split: ['Split', 'info'], removal: ['Sortie', 'warn'] };
function opColumns() {
  const mny = (v, c, d) => (v == null ? '<span class="muted">—</span>' : fmtMoney(v, c, d));
  return [
    { key: 'date', label: 'Date', essential: true, sort: (r) => r.date + ' ' + r.time + ' ' + String(r.seq).padStart(5, '0'), html: (r) => esc(fmtDate(r.date)) + (r.time ? ' <small class="muted">' + esc(r.time) + '</small>' : '') },
    { key: 'asset', label: 'Actif', essential: true, sort: (r) => (r.name || '').toLowerCase(), html: (r) => '<span class="asset">' + avatar(r.inst.displayTicker || r.inst.ticker, r.inst.logo, 'sm', r.inst.isin) + '<span><span class="nm">' + esc(r.name) + '</span><span class="tkr">' + esc(r.inst.isin || r.inst.displayTicker || '') + (r.closed ? ' · clôturée' : '') + '</span></span></span>' },
    { key: 'type', label: 'Opération', essential: true, sort: (r) => r.type, html: (r) => OP_LABEL[r.type] ? '<span class="badge ' + OP_LABEL[r.type][1] + '">' + OP_LABEL[r.type][0] + (r.type === 'split' && r.ratio ? ' ×' + fmtNum(r.ratio) : '') + '</span>' : esc(r.type) },
    { key: 'qty', label: 'Quantité', essential: true, align: 'r', sort: (r) => r.qty, html: (r) => (r.qty == null ? '—' : fmtNum(r.qty)) },
    { key: 'price', label: 'Prix unitaire', align: 'r', sort: (r) => r.price, html: (r) => (r.price == null ? '—' : fmtMoney(r.price, r.cur, { d: 4 })) },
    { key: 'fees', label: 'Frais', align: 'r', sort: (r) => r.fees, html: (r) => (r.fees ? fmtMoney(r.fees, r.feesCur) : '—') },
    { key: 'amt', label: 'Montant', align: 'r', sort: (r) => r.amt, html: (r) => mny(r.amt, r.costCur) },
    { key: 'qtyAfter', label: 'Qté après', essential: true, align: 'r', sort: (r) => r.qtyAfter, html: (r) => fmtNum(r.qtyAfter) },
    { key: 'costAfter', label: 'Coût cumulé', align: 'r', sort: (r) => r.costAfter, html: (r) => mny(r.costAfter, r.costCur) },
    { key: 'pru', label: 'PRU après', essential: true, align: 'r', sort: (r) => r.pruAfter, html: (r) => mny(r.pruAfter, r.costCur, { d: 2 }) },
    { key: 'realized', label: 'Résultat réalisé', essential: true, align: 'r', sort: (r) => r.realized, html: (r) => (r.type !== 'sell' ? '' : r.realized == null ? '<span class="muted" title="' + esc(r.issue || 'Données insuffisantes') + '">—</span>' : '<b class="' + (r.realized >= 0 ? 'pos' : 'neg') + '">' + (r.realized >= 0 ? '+' : '') + fmtMoney(r.realized, r.costCur) + '</b>' + (r.realizedPct != null ? ' <small class="muted">' + fmtPct(r.realizedPct, 1, true) + '</small>' : '')) },
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
    '<button class="btn" type="button" data-do="check-history">' + icon('check') + 'Contrôle de l\'historique</button><button class="btn" type="button" data-do="import-degiro">' + icon('upload') + 'Importer l\'historique DEGIRO</button>') +
    '<div class="toolbar">' + portTabsHtml() +
    '<select id="opAsset" aria-label="Actif" style="width:auto;max-width:200px"><option value="all">Tous les actifs</option>' + insts.map((x) => '<option value="' + esc(x.id) + '">' + esc(x.name || x.displayTicker || x.ticker) + (closedIds.has(x.id) ? ' (clôturée)' : '') + '</option>').join('') + '</select>' +
    '<select id="opType" aria-label="Type" style="width:auto"><option value="all">Tous les types</option><option value="buy">Achats</option><option value="sell">Ventes</option><option value="other">Autres mouvements</option></select>' +
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
