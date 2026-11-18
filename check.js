/* ==================================================================
   check.js — « Contrôle de l'historique » : diagnostic de l'import et des positions calculées.
   Pour chaque anomalie : actif, transactions concernées, cause probable, action recommandée.
   Rien n'est corrigé automatiquement quand c'est incertain ; chaque correction est annulable (copie avant action)
   et ne supprime jamais une transaction. Les calculs sont dans ledger.js (diagnose, reevaluate, addCorp…).
   ================================================================== */

const DIAG_LVL = { error: ['Anomalie', 'warn'], warn: ['À vérifier', 'warn'], info: ['Information', 'info'] };

const DIAG_BTN = { search_split: ['Rechercher un split (Yahoo)', 'refresh'], apply_split: ['Valider le split', 'check'], manual_split: ['Saisir un split…', null], alias: ['Fusionner avec un autre ISIN…', null], removal: ['Marquer une sortie…', null], archive: ['Archiver la position', null], promote: ['Ajouter au portefeuille actuel', null], recompute: ['Recalculer depuis les transactions', 'refresh'], set_ref_qty: ['Utiliser la position réelle', 'check'], edit: ['Corriger à la main…', null], fix_tx: ['Saisir la date / le montant…', null], del_tx: ['Supprimer ces opérations…', null], remove_dupes: ['Supprimer les doublons', null], apply_split_pair: ['Traiter comme un split', 'check'] };
const diagActLabel = (a, it) => (a === 'apply_split' && it.splits ? 'Valider le split ' + it.splits.map((s) => '×' + s.ratio + ' (' + fmtDate(s.date) + ')').join(', ') : (DIAG_BTN[a] || [a])[0]);
/* Ignore durablement une anomalie (elle ne revient que si la situation change) ; rétablissable dans le contrôle de l'historique. */
function diagIgnore(it) { state.ignored = state.ignored || {}; state.ignored[it.sig] = { at: new Date().toISOString(), code: it.code, name: it.name || '' }; saveState(); }
function diagTxLabel(id) {
  const t = state.transactions.find((x) => x.id === id); if (!t) return '';
  return fmtDate(t.date, { day: 'numeric', month: 'short', year: 'numeric' }) + ' · ' + (t.corp ? (t.type === 'buy' ? 'livraison gratuite' : 'retrait de titres') : t.type === 'buy' ? 'achat' : 'vente') + ' ' + fmtNum(t.qty);
}
function diagDeps() { return { uid, today: todayISO() }; }

function openDiagnostic() {
  const d = Ledger.diagnose(state, { today: todayISO() });
  const imp = d.lastImport, refTxt = d.reference.mode === 'file' ? 'relevé de portefeuille DEGIRO chargé (' + d.reference.count + ' position(s)' + (d.reference.at ? ', ' + esc(fmtDate(d.reference.at.slice(0, 10))) : '') + ')' : d.reference.mode === 'app' ? 'positions saisies ou importées directement (' + d.reference.count + ')' : 'aucune';
  const chip = (n, label, cls) => '<div class="card stat-chip"><span>' + label + '</span><b class="' + (n ? cls : '') + '">' + n + '</b></div>';
  const rep = imp && imp.report ? imp.report : null;
  const repHtml = rep ? '<div class="diag-report"><div><span>Transactions lues</span><b>' + rep.read + '</b></div><div><span>Reconnues</span><b>' + rep.recognized + '</b></div><div><span>Nouvelles</span><b>' + (rep.newTx || 0) + '</b></div><div><span>Doublons ignorés</span><b>' + (rep.dups || 0) + '</b></div>' +
    '<div><span>Illisibles</span><b class="' + (rep.bad ? 'warn-t' : '') + '">' + rep.bad + '</b></div><div><span>Ambiguës / montant nul</span><b class="' + (rep.ambiguous ? 'warn-t' : '') + '">' + rep.ambiguous + '</b></div></div>' +
    '<div class="hint">Fichier « ' + esc(imp.name) + ' » du ' + esc(fmtDate(imp.at.slice(0, 10))) + '. Ignorés (jamais traités comme des achats ou des ventes) : ' + (Object.keys(rep.other || {}).length ? esc(Object.entries(rep.other).map((e) => e[1] + ' ' + e[0]).join(', ')) : 'aucun autre mouvement') +
    ' · opérations sur titres / montants nuls détectés : ' + (Array.isArray(rep.corp) ? rep.corp.length : rep.corp || 0) + '.</div>' : '<div class="muted">Aucun import d\'historique enregistré.</div>';
  const rowsH = d.rows.slice().sort((a, b) => (a.ok === false ? -1 : 1) - (b.ok === false ? -1 : 1) || (a.name || '').localeCompare(b.name || '')).slice(0, 400).map((r) => {
    const st = r.ok === false ? '<span class="badge warn">Écart</span>' : r.ok === true ? '<span class="badge received">Cohérent</span>' : '<span class="muted">—</span>';
    return '<tr><td><b>' + esc(r.name) + '</b><div class="dg-note">' + esc(r.isin || '') + '</div></td><td>' + (r.kind === 'holding' ? 'Détenue' : 'Clôturée / à vérifier') + '</td><td class="r">' + (r.kind === 'holding' ? fmtNum(r.app) : '—') + '</td><td class="r">' + (r.calc === null ? '—' : (r.calc < 0 ? '<span class="neg">' + fmtNum(r.calc) + '</span>' : fmtNum(r.calc))) + '</td><td class="r">' + (r.ref === null ? '—' : fmtNum(r.ref)) + '</td><td>' + st + '</td></tr>';
  }).join('');
  const btn = DIAG_BTN;
  const items = d.items.map((it, n) => {
    const lv = DIAG_LVL[it.level], tx = it.txIds.slice(0, 5).map(diagTxLabel).filter(Boolean);
    const acts = it.act.map((a) => '<button class="btn sm' + (a === 'apply_split' || a === 'apply_split_pair' || a === 'archive' || a === 'set_ref_qty' ? ' primary' : '') + '" type="button" data-diag="' + a + '" data-n="' + n + '">' + diagActLabel(a, it).replace(/&/g, '&amp;').replace(/</g, '&lt;') + '</button>').join('');
    return '<div class="diag-item lvl-' + it.level + '"><div class="diag-h"><span class="badge ' + lv[1] + '">' + lv[0] + '</span> <b>' + esc(it.name || '—') + '</b>' + (it.isin ? ' <small class="muted">' + esc(it.isin) + '</small>' : '') + '</div>' +
      '<div class="diag-line"><b>Cause probable :</b> ' + esc(it.cause) + '</div><div class="diag-line"><b>Action recommandée :</b> ' + esc(it.action || '—') + '</div>' +
      (tx.length ? '<div class="diag-line muted"><b>Transactions concernées :</b> ' + tx.map(esc).join(' ; ') + (it.txIds.length > 5 ? ' … (+' + (it.txIds.length - 5) + ')' : '') + '</div>' : '') + '<div class="btn-row" style="margin-top:8px">' + acts + '<button class="btn sm ghost" type="button" data-ign="' + n + '" title="Masquer cette anomalie sans rien modifier. Elle réapparaîtra si la situation change.">Ignorer</button></div></div>';
  }).join('');
  const ignH = (d.ignored || []).length ? '<details class="dg-cols"><summary>Anomalies ignorées (' + d.ignored.length + ')</summary>' + d.ignored.map((it, n) => '<div class="diag-item lvl-info"><div class="diag-h"><b>' + esc(it.name || '—') + '</b> <small class="muted">' + esc(it.isin || '') + (it.ignoredAt ? ' · ignorée le ' + esc(fmtDate(it.ignoredAt.slice(0, 10))) : '') + '</small></div><div class="diag-line muted">' + esc(it.cause) + '</div><div class="btn-row" style="margin-top:6px"><button class="btn sm" type="button" data-unign="' + n + '">Rétablir</button></div></div>').join('') + '</details>' : '';
  const m = openModal('<h2>Contrôle de l\'historique</h2><div class="sub">Compare vos transactions, les opérations sur titres validées et vos positions réelles. Rien n\'est supprimé ni corrigé sans votre action ; chaque correction est annulable.</div>' +
    '<div class="chips-row">' + chip(d.counts.error, 'Anomalies', 'neg') + chip(d.counts.warn, 'À vérifier', 'warn-t') + chip(d.counts.info, 'Informations', '') + chip(d.counts.negative, 'Quantités négatives', 'neg') + chip(d.counts.zeroHeld, 'Quantité nulle au portefeuille', 'warn-t') + '</div>' +
    '<div class="btn-row" style="margin:8px 0"><span class="muted" style="align-self:center">Positions réelles de référence : <b>' + refTxt + '</b></span><span class="grow"></span><button class="btn sm" type="button" id="dgChkRef">' + icon('upload') + 'Charger le relevé de portefeuille DEGIRO…</button></div>' +
    '<div class="sec">Dernier import</div>' + repHtml +
    '<div class="sec">Anomalies et actions</div>' + (items || '<div class="notice info">Aucune anomalie détectée : quantités et PRU sont cohérents avec les transactions' + (d.reference.mode ? ' et avec vos positions réelles' : ' (aucune position réelle de référence : chargez le relevé DEGIRO pour une vérification complète)') + '.</div>') +
    ignH + '<div class="sec">Positions : application, calcul, réalité</div>' + (rowsH ? '<div class="tbl-wrap" style="max-height:300px"><table class="tbl"><thead><tr><th>Actif</th><th>Statut</th><th class="r">Application</th><th class="r">Calculée (transactions)</th><th class="r">Réelle</th><th>État</th></tr></thead><tbody>' + rowsH + '</tbody></table></div>' : '<div class="muted">Aucune position avec historique.</div>') +
    '<div class="modal-actions"><span></span><div class="btn-row">' + (state.undo ? '<button class="btn" type="button" id="dgChkUndo">Annuler la dernière correction</button>' : '') + '<button class="btn primary" type="button" data-close>Fermer</button></div></div>', { wide: true });
  const undoBtn = $('#dgChkUndo', m); if (undoBtn) undoBtn.onclick = async () => { await undoLastImport(); openDiagnostic(); };
  $('#dgChkRef', m).onclick = () => diagLoadReference();
  $$('[data-diag]', m).forEach((b) => b.onclick = () => diagAct(b.dataset.diag, d.items[Number(b.dataset.n)]));
  $$('[data-ign]', m).forEach((b) => b.onclick = () => { const it = d.items[Number(b.dataset.ign)]; diagIgnore(it); renderPageSoft(); openDiagnostic();
    toast('Anomalie ignorée : ' + (it.name || '—') + '.', { ms: 8000, action: { label: 'Annuler', fn: () => { delete state.ignored[it.sig]; saveState(); renderPageSoft(); openDiagnostic(); } } }); });
  $$('[data-unign]', m).forEach((b) => b.onclick = () => { const it = d.ignored[Number(b.dataset.unign)]; if (state.ignored) delete state.ignored[it.sig]; saveState(); renderPageSoft(); openDiagnostic(); });
}

/* Applique une correction : copie de sécurité avant, enregistrement, nouveau contrôle. Les transactions ne sont jamais supprimées. */
function diagCommit(label, fn, after) {
  const prevUndo = state.undo;
  snapshotForUndo(label);
  const r = fn();
  if (r && r.ok === false) { if (prevUndo) state.undo = prevUndo; else delete state.undo; toast(r.error || 'Correction impossible.', { error: true }); openDiagnostic(); return; }
  saveState(); renderPageSoft(); openDiagnostic();
  toast(label + '.', { ms: 9000, action: { label: 'Annuler', fn: async () => { await undoLastImport(); openDiagnostic(); } } });
  if (after) after(r);
}
function diagDialog(title, body, onOk) {
  const m = openModal('<h2>' + title + '</h2>' + body + '<div class="modal-actions"><span></span><div class="btn-row"><button class="btn" type="button" id="ddNo">Annuler</button><button class="btn primary" type="button" id="ddOk">Valider</button></div></div>', { sticky: true });
  $('#ddNo', m).onclick = () => openDiagnostic(); $('#ddOk', m).onclick = () => onOk(m);
}
const diagInst = (it) => (it.instId ? instrumentById(it.instId) : null);

async function diagLoadReference() {
  const f = await pickFile(IMPORT_ACCEPT); if (!f) return;
  let d; try { d = await readHistoryRows(f); } catch (e) { toast(e.message, { error: true }); return; }
  const r = Ledger.parsePositions(d.rows); if (!r.positions.length) { toast(r.error || 'Aucune position (ISIN + quantité) reconnue dans ce fichier.', { error: true }); return; }
  const last = (state.imports || []).slice(-1)[0], derived = state.holdings.find((h) => h.derived), acc = (last && last.account) || (derived && derived.account) || state.accounts[0].id;
  diagCommit('Positions réelles de référence chargées (' + r.positions.length + ')', () => { state.reference = { at: new Date().toISOString(), name: f.name, account: acc, positions: r.positions }; return { ok: true }; });
}

async function diagAct(kind, it) {
  const inst = diagInst(it);
  if (kind === 'search_split') {
    if (!state.settings.relayUrl) { toast('Aucun relais de données configuré.', { error: true }); return; }
    toast('Recherche des fractionnements…');
    try {
      const r = await market.fetchSplits((inst && (inst.isin || inst.ticker)) || it.isin, it.name);
      if (inst) { inst.splits = r.splits; saveState(); }
      openDiagnostic(); toast(r.splits.length ? r.splits.length + ' fractionnement(s) trouvé(s) : ' + r.splits.map((s) => '×' + s.ratio + ' le ' + fmtDate(s.date)).join(', ') + '. Vérifiez la proposition avant de valider.' : 'Aucun split trouvé dans les données de marché (le relais doit être à jour pour les renvoyer). Vous pouvez en saisir un manuellement.', { ms: 9000 });
    } catch (e) { toast(e.message, { error: true }); }
    return;
  }
  if (kind === 'apply_split') {
    const sp = it.splits || [];
    diagCommit('Split(s) validé(s) : ' + sp.map((s) => '×' + s.ratio + ' le ' + fmtDate(s.date)).join(', '), () => { sp.forEach((s) => Ledger.addCorp(state, { isin: it.isin, date: s.date, kind: 'split', ratio: s.ratio, source: it.code === 'csv_corp' ? 'csv' : 'market', note: 'validé depuis le contrôle de l\'historique' }, diagDeps())); return { ok: true }; });
    return;
  }
  if (kind === 'manual_split') {
    diagDialog('Saisir un split / regroupement', '<div class="sub">' + esc(it.name) + ' — le nombre de titres change, le coût total d\'acquisition reste inchangé (le PRU est divisé par le ratio). À saisir uniquement si l\'opération est certaine.</div>' +
      fld('Date de l\'opération', '<input type="date" id="ddDate">', 'Date de détachement du split.', 'ddDate') + '<div class="row2">' + fld('Anciens titres', '<input type="number" id="ddOld" min="0" step="any" value="1">', '', 'ddOld') + fld('Nouveaux titres', '<input type="number" id="ddNew" min="0" step="any" value="4">', 'Split 4 pour 1 : 1 → 4. Regroupement 1 pour 10 : 10 → 1.', 'ddNew') + '</div>',
      (m) => { const dt = $('#ddDate', m).value, o = Number($('#ddOld', m).value), n = Number($('#ddNew', m).value); if (!dt || !(o > 0) || !(n > 0) || o === n) { toast('Date et ratio valides requis.', { error: true }); return; }
        diagCommit('Split saisi : ' + n + ' pour ' + o + ' le ' + fmtDate(dt), () => { Ledger.addCorp(state, { isin: it.isin || (inst && inst.isin), date: dt, kind: 'split', ratio: Math.round(n / o * 1e8) / 1e8, source: 'manual', note: 'saisi manuellement' }, diagDeps()); return { ok: true }; }); });
    return;
  }
  if (kind === 'removal') {
    const led = inst ? Ledger.run(Ledger.entriesFor(state, inst).entries) : null;
    diagDialog('Marquer une sortie hors transaction', '<div class="sub">' + esc(it.name) + ' — la quantité restante passe à zéro à cette date (radiation, offre publique, échange de titres…), <b>sans résultat réalisé inventé</b>. Les transactions sont conservées.</div>' + fld('Date de la sortie', '<input type="date" id="ddDate" value="' + esc((led && led.last) || todayISO()) + '">', '', 'ddDate'),
      (m) => { const dt = $('#ddDate', m).value; if (!dt) { toast('Date requise.', { error: true }); return; }
        diagCommit('Sortie enregistrée le ' + fmtDate(dt), () => { Ledger.addCorp(state, { isin: it.isin || (inst && inst.isin), date: dt, kind: 'removal', ratio: null, source: 'manual', note: 'sortie hors transaction' }, diagDeps()); return { ok: true }; }); });
    return;
  }
  if (kind === 'alias') {
    const others = state.holdings.concat(state.archive || []).filter((x) => x.id !== it.instId && Ledger.holdingIsin(x));
    if (!others.length) { toast('Aucun autre actif avec un ISIN.', { error: true }); return; }
    diagDialog('Fusionner deux ISIN (changement d\'ISIN, fusion)', '<div class="sub"><b>' + esc(it.name) + '</b> et l\'actif choisi sont la même société. Les transactions sont réunies sur un seul historique (rien n\'est supprimé) et les prochains imports rattachent l\'ancien ISIN au nouveau.</div>' +
      fld('Autre actif', '<select id="ddOther">' + others.map((x) => '<option value="' + esc(x.id) + '">' + esc((x.name || x.displayTicker) + ' · ' + Ledger.holdingIsin(x) + ((state.archive || []).includes(x) ? ' (clôturé)' : '')) + '</option>').join('') + '</select>', '', 'ddOther') +
      fld('Sens', '<select id="ddDir"><option value="into">Fusionner « ' + esc(it.name) + ' » dans l\'autre actif</option><option value="from">Fusionner l\'autre actif dans « ' + esc(it.name) + ' »</option></select>', 'L\'actif absorbé doit provenir de l\'import (pas une position saisie à la main).', 'ddDir'),
      (m) => { const other = $('#ddOther', m).value, dir = $('#ddDir', m).value, from = dir === 'into' ? it.instId : other, to = dir === 'into' ? other : it.instId;
        diagCommit('Actifs fusionnés', () => Ledger.mergeInstruments(state, from, to, diagDeps())); });
    return;
  }
  if (kind === 'apply_split_pair') { diagCommit('Split enregistré : ' + it.name, () => Ledger.applySplitPair(state, it.pair, diagDeps())); return; }
  if (kind === 'remove_dupes') { diagCommit('Doublons supprimés : ' + it.name, () => Ledger.removeDuplicateTx(state, it.txIds)); return; }
  if (kind === 'archive') { diagCommit('Position archivée : ' + it.name, () => Ledger.demote(state, it.instId, it.code, it.cause, diagDeps())); return; }
  if (kind === 'promote') { diagCommit('Position ajoutée au portefeuille actuel : ' + it.name, () => Ledger.promote(state, it.instId, diagDeps()), () => { const h = state.holdings.find((x) => x.id === it.instId); if (h && state.settings.relayUrl) refreshMarket([h], { silent: true }); }); return; }
  if (kind === 'set_ref_qty') { diagCommit('Quantité corrigée : ' + it.name + ' → ' + it.refQty, () => { const h = state.holdings.find((x) => x.id === it.instId); if (!h || !(it.refQty > 0)) return { ok: false, error: 'Position réelle introuvable.' }; h.quantity = it.refQty; h.manual = true; return { ok: true }; }); return; }
  if (kind === 'edit') { closeModal(); openHoldingModal(it.instId); return; }
  if (kind === 'fix_tx') {
    const txs = (it.txIds || []).map((id) => state.transactions.find((x) => x.id === id)).filter(Boolean).filter((t) => !t.date || t.amountAcct == null || (t.source === 'degiro' && !t.isin));
    if (!txs.length) { toast('Ces opérations sont déjà complètes.'); openDiagnostic(); return; }
    const rows = txs.slice(0, 30).map((t, i) => '<div class="diag-item lvl-warn"><div class="diag-h"><b>' + esc(t.name || t.ticker || (instrumentById(t.holdingId) || {}).name || t.isin || '—') + '</b> <small class="muted">' + esc((t.type === 'sell' ? 'vente' : 'achat') + ' ' + fmtNum(t.qty) + (t.date ? ' · ' + fmtDate(t.date) : '') + (t.orderId ? ' · réf. ' + t.orderId : '')) + '</small></div><div class="row2">' +
      (!t.date ? fld('Date réelle de l\'opération', '<input type="date" id="fxD' + i + '" max="' + todayISO() + '">', 'Telle qu\'elle figure sur votre relevé.', 'fxD' + i) : '') +
      (t.amountAcct == null ? fld('Montant total (' + esc(t.acctCur || t.currency || 'EUR') + ')', '<input type="number" id="fxA' + i + '" min="0" step="any" inputmode="decimal">', 'Quantité × prix ± frais, en valeur positive.', 'fxA' + i) : '') +
      (t.source === 'degiro' && !t.isin ? fld('ISIN', '<input type="text" id="fxI' + i + '" maxlength="12" autocapitalize="characters">', '12 caractères, ex. FR0000120073.', 'fxI' + i) : '') + '</div></div>').join('');
    diagDialog('Compléter ' + txs.length + ' opération(s)', '<div class="sub">Renseignez uniquement ce que vous connaissez : un champ laissé vide reste signalé, rien n\'est deviné. Annulable.</div>' + rows + (txs.length > 30 ? '<div class="hint">' + (txs.length - 30) + ' autre(s) opération(s) : relancez l\'action après celles-ci.</div>' : ''), (m) => {
      const edits = []; let bad = '';
      txs.slice(0, 30).forEach((t, i) => {
        const d = $('#fxD' + i, m), a = $('#fxA' + i, m), s = $('#fxI' + i, m), e = {};
        if (d && d.value) { if (/^\d{4}-\d{2}-\d{2}$/.test(d.value) && d.value <= todayISO()) e.date = d.value; else bad = 'Date invalide.'; }
        if (a && a.value !== '') { if (Number(a.value) > 0) e.amountAcct = Math.round(Number(a.value) * 100) / 100; else bad = 'Montant invalide (valeur positive attendue).'; }
        if (s && s.value.trim()) { const v = s.value.trim().toUpperCase(); if (Ledger.isISIN(v)) e.isin = v; else bad = 'ISIN invalide : ' + v + '.'; }
        if (Object.keys(e).length) edits.push([t.id, e]);
      });
      if (bad) { toast(bad, { error: true }); return; }
      if (!edits.length) { toast('Rien à enregistrer.', { error: true }); return; }
      diagCommit('Opérations complétées à la main (' + edits.length + ')', () => { edits.forEach(([id, e]) => { const t = state.transactions.find((x) => x.id === id); if (t) Object.assign(t, e, { manualFix: true }); }); return { ok: true }; });
    });
    return;
  }
  if (kind === 'del_tx') {
    const ids = (it.txIds || []).filter((id) => state.transactions.some((x) => x.id === id));
    const c = await confirmDialog({ title: 'Supprimer ' + ids.length + ' opération(s) incomplète(s) ?', body: 'Ces opérations n\'ont pas toutes leurs informations (date, montant ou ISIN). Elles sont retirées de l\'historique et du calcul du prix de revient. <b>À faire seulement si elles sont erronées.</b> Annulable depuis le contrôle de l\'historique.', confirmLabel: 'Supprimer', danger: true });
    if (!c.ok) { openDiagnostic(); return; }
    diagCommit(ids.length + ' opération(s) incomplète(s) supprimée(s)', () => { const set = new Set(ids); state.transactions = state.transactions.filter((x) => !set.has(x.id)); return { ok: true }; });
    return;
  }
  if (kind === 'recompute') { diagCommit('Position recalculée : ' + it.name, () => { const r = Ledger.reevaluate(state, it.instId, diagDeps()); return { ok: true, r }; }); return; }
}

/* ==================================================================
   AUDIT DES POSITIONS — PHASE 0 : rapport STRICTEMENT INFORMATIF (calcul dans audit.js, module pur).
   Cette fonction ne contient AUCUN appel à saveState, renderPage, Cloud, syncNow ni à une fonction d'écriture : elle lit l'état, affiche, et propose
   deux exports CSV (téléchargement local). Elle ne crée ni opération d'ouverture ni ajustement et ne recalcule aucune position.
   ================================================================== */
function openPositionsAudit() {
  const rep = Audit.positions(state, { now: new Date().toISOString() }), T = rep.totals, L = Audit.MOTIFS;
  const q = (x) => (x === null || x === undefined ? '—' : fmtNum(x, 6)), mny = (x, cur) => (x === null || x === undefined ? '—' : fmtMoney(x, cur, { d: 4 })), sgn = (x, f) => (x === null || x === undefined ? '—' : (x > 0 ? '+' : '') + f(x));
  const card = (label, n, cls) => '<div class="card stat-chip"><span>' + label + '</span><b class="' + (n ? cls : '') + '">' + n + '</b></div>';
  const reasonBadges = (p) => p.reasons.map((r) => '<span class="badge warn" title="' + esc(L[r]) + '">' + esc(({ negative: 'Solde négatif', qty: 'Quantité', pru: 'PRU', pru_missing_stored: 'PRU absent', pru_uncomputable: 'PRU non vérifiable', cost_currency: 'Devise du PRU' })[r] || r) + '</span>').join(' ');
  const list = (arr) => (arr.length ? '<ul style="margin:6px 0 6px 18px;padding:0">' + arr.map((x) => '<li>' + esc(x) + '</li>').join('') + '</ul>' : '');
  const detail = (p) => {
    const cmp = '<table class="tbl" style="margin:8px 0"><thead><tr><th></th><th class="r">Stocké (position)</th><th class="r">Grand livre</th><th class="r">Écart</th></tr></thead><tbody>' +
      '<tr><td>Quantité</td><td class="r">' + q(p.storedQty) + '</td><td class="r">' + q(p.ledgerQty) + '</td><td class="r"><b>' + sgn(p.qtyDiff, (x) => fmtNum(x, 6)) + '</b></td></tr>' +
      '<tr><td>PRU</td><td class="r">' + mny(p.storedPru, p.storedCostCur) + '</td><td class="r">' + mny(p.ledgerPru, p.ledgerCur) + '</td><td class="r"><b>' + (p.pruComparable ? sgn(p.pruDiff, (x) => fmtNum(x, 4)) + (p.pruDiffPct == null ? '' : ' (' + sgn(p.pruDiffPct, (x) => fmtPct(x, 1)) + ')') : 'non comparable') + '</b></td></tr>' +
      '<tr><td>Devise</td><td class="r">PRU : ' + esc(p.storedCostCur) + '</td><td class="r">PRU : ' + esc(p.ledgerCur) + '</td><td class="r">cotation : ' + esc(p.priceCur) + '</td></tr>' +
      '<tr><td>Opérations prises en compte</td><td class="r" colspan="3">' + p.ops + ' achat(s)/vente(s)' + (p.corpOps ? ' + ' + p.corpOps + ' opération(s) sur titres validée(s)' : '') + (p.refQty !== null && p.refQty !== undefined ? ' · relevé de référence : ' + fmtNum(p.refQty, 6) : '') + '</td></tr></tbody></table>';
    const rows = p.rows.map((r) => '<tr' + (r.issue ? ' class="warn-t"' : '') + '><td>' + esc(fmtDate(r.date)) + (r.time ? ' <small class="muted">' + esc(r.time) + '</small>' : '') + '</td><td>' + esc(r.label) + (r.flags.length ? '<div class="dg-note">' + esc(r.flags.join(', ')) + '</div>' : '') + '</td><td class="r">' + (r.type === 'split' ? '×' + fmtNum(r.ratio, 6) : fmtNum(r.qty, 6)) + '</td><td class="r">' + (r.price === null ? '—' : fmtNum(r.price, 4)) + '</td><td class="r">' + (r.fees === null ? '—' : fmtNum(r.fees, 2)) + '</td><td class="r">' + (r.amt === null ? '<span class="neg">inconnu</span>' : fmtNum(r.amt, 2) + ' ' + esc(r.cur || '')) + '</td><td>' + esc(r.source) + '</td><td class="r">' + fmtNum(r.qtyAfter, 6) + '</td><td class="r">' + fmtNum(r.costAfter, 2) + '</td><td class="r">' + (r.pruAfter === null ? '—' : fmtNum(r.pruAfter, 4)) + '</td><td class="r">' + (r.realized === null ? '' : fmtNum(r.realized, 2)) + '</td>' + (r.issue ? '<td>' + esc(r.issue) + '</td>' : '<td></td>') + '</tr>').join('');
    const led = '<div class="sec" style="margin-top:10px">Détail du grand livre (ordre de calcul : date, heure, puis achat avant vente)</div><div class="tbl-wrap" style="max-height:320px"><table class="tbl"><thead><tr><th>Date</th><th>Opération</th><th class="r">Qté</th><th class="r">Prix</th><th class="r">Frais</th><th class="r">Montant</th><th>Source</th><th class="r">Qté après</th><th class="r">Coût après</th><th class="r">PRU après</th><th class="r">Réalisé</th><th>Anomalie</th></tr></thead><tbody>' + rows + '</tbody></table></div>';
    return cmp + (p.hints.length ? '<div class="sec">Pistes (origine probable de l\'écart)</div>' + list(p.hints) : '') + (p.anomalies.length ? '<div class="sec">Anomalies détectées</div>' + list(p.anomalies) : '') + led;
  };
  const divHtml = rep.divergent.map((p) => '<details class="diag-item lvl-warn" style="margin:8px 0;padding:8px 10px"><summary style="cursor:pointer"><b>' + esc(p.name) + '</b> <span class="dg-note" style="display:inline">' + esc(p.isin || p.ticker) + ' · ' + esc(p.accountName) + '</span> ' + reasonBadges(p) + '<div class="dg-note">Quantité : stockée ' + q(p.storedQty) + ' / grand livre ' + q(p.ledgerQty) + ' (écart ' + sgn(p.qtyDiff, (x) => fmtNum(x, 6)) + ') · PRU : stocké ' + mny(p.storedPru, p.storedCostCur) + ' / grand livre ' + mny(p.ledgerPru, p.ledgerCur) + ' · ' + p.ops + ' opération(s)</div></summary>' + detail(p) + '</details>').join('');
  const simple = (arr, withLedger) => '<div class="tbl-wrap" style="max-height:340px"><table class="tbl"><thead><tr><th>Position</th><th>Portefeuille</th><th class="r">Qté stockée</th>' + (withLedger ? '<th class="r">Qté grand livre</th>' : '') + '<th class="r">PRU stocké</th>' + (withLedger ? '<th class="r">PRU grand livre</th>' : '') + '<th class="r">Opérations</th><th>Remarques</th></tr></thead><tbody>' +
    arr.map((p) => '<tr><td><b>' + esc(p.name) + '</b><div class="dg-note">' + esc(p.isin || p.ticker) + ' · ' + esc(p.priceCur) + '</div></td><td>' + esc(p.accountName) + '</td><td class="r">' + q(p.storedQty) + '</td>' + (withLedger ? '<td class="r">' + q(p.ledgerQty) + '</td>' : '') + '<td class="r">' + mny(p.storedPru, p.storedCostCur) + '</td>' + (withLedger ? '<td class="r">' + mny(p.ledgerPru, p.ledgerCur) + '</td>' : '') + '<td class="r">' + p.ops + '</td><td class="dg-note">' + esc(p.anomalies.concat(p.hints).join(' · ')) + '</td></tr>').join('') + '</tbody></table></div>';
  const reasonsLine = Object.keys(T.byReason).length ? '<div class="hint" style="margin-top:6px">Motifs de divergence : ' + Object.keys(T.byReason).map((r) => esc(L[r]) + ' : <b>' + T.byReason[r] + '</b>').join(' · ') + '.</div>' : '';
  const accLine = T.byAccount.length > 1 ? '<div class="hint">Par portefeuille : ' + T.byAccount.map((a) => esc(a.name) + ' — ' + a.coherent + ' cohérente(s), ' + a.noOps + ' sans opérations, ' + a.divergent + ' divergente(s)').join(' · ') + '.</div>' : '';
  const arch = rep.archiveWithBalance.length ? '<div class="notice warn" style="margin-top:8px"><span><b>' + rep.archiveWithBalance.length + '</b> position(s) clôturée(s) dont le grand livre indique encore des titres (hors des trois catégories) : ' + rep.archiveWithBalance.slice(0, 12).map((a) => esc(a.name) + ' (' + fmtNum(a.ledgerQty, 6) + ')').join(', ') + (rep.archiveWithBalance.length > 12 ? '…' : '') + '.</span></div>' : '';
  const m = openModal('<h2>Audit des positions : grand livre et valeurs stockées</h2>' +
    '<div class="notice info"><span><b>Rapport en lecture seule.</b> Il recalcule le grand livre à part et le compare à ce qui est stocké. <b>Rien n\'est modifié, rien n\'est enregistré, rien n\'est synchronisé</b> ; aucune opération n\'est créée ; aucune position n\'est recalculée.</span></div>' +
    '<div class="stat-row" style="margin-top:10px">' + card('Positions détenues', T.positions, '') + card('Cohérentes', T.coherent, 'pos') + card('Sans opérations', T.noOps, '') + card('Divergentes', T.divergent, 'neg') + card('Opérations lues', T.ops, '') + '</div>' + reasonsLine + accLine + arch +
    '<details open style="margin-top:12px"><summary class="sec" style="cursor:pointer">3 · Divergentes (' + T.divergent + ') : touchez une position pour voir le détail du grand livre</summary>' + (divHtml || '<div class="muted" style="margin-top:6px">Aucune position divergente.</div>') + '</details>' +
    '<details style="margin-top:12px"><summary class="sec" style="cursor:pointer">2 · Sans opérations : positions saisies à la main (' + T.noOps + ')</summary>' + (rep.noOps.length ? simple(rep.noOps, false) : '<div class="muted" style="margin-top:6px">Aucune.</div>') + '</details>' +
    '<details style="margin-top:12px"><summary class="sec" style="cursor:pointer">1 · Cohérentes (' + T.coherent + ')</summary>' + (rep.coherent.length ? simple(rep.coherent, true) : '<div class="muted" style="margin-top:6px">Aucune.</div>') + '</details>' +
    '<div class="modal-actions"><div class="btn-row"><button class="btn" type="button" id="audCsv">' + icon('download') + 'Télécharger la synthèse (CSV)</button><button class="btn" type="button" id="audDet">' + icon('download') + 'Télécharger le détail des divergentes (CSV)</button></div><button class="btn primary" type="button" data-close>Fermer</button></div>', { wide: true });
  const day = todayISO();
  $('#audCsv', m).onclick = () => saveFile('audit-positions-synthese-' + day + '.csv', Audit.summaryCsv(rep), 'text/csv;charset=utf-8');
  $('#audDet', m).onclick = () => saveFile('audit-positions-detail-' + day + '.csv', Audit.detailCsv(rep), 'text/csv;charset=utf-8');
}
