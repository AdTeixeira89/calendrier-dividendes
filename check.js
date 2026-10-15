/* ==================================================================
   check.js — « Contrôle de l'historique » : diagnostic de l'import et des positions calculées.
   Pour chaque anomalie : actif, transactions concernées, cause probable, action recommandée.
   Rien n'est corrigé automatiquement quand c'est incertain ; chaque correction est annulable (copie avant action)
   et ne supprime jamais une transaction. Les calculs sont dans ledger.js (diagnose, reevaluate, addCorp…).
   ================================================================== */

const DIAG_LVL = { error: ['Anomalie', 'warn'], warn: ['À vérifier', 'warn'], info: ['Information', 'info'] };

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
  const btn = { search_split: ['Rechercher un split (Yahoo)', 'refresh'], apply_split: ['Valider le split', 'check'], manual_split: ['Saisir un split…', null], alias: ['Fusionner avec un autre ISIN…', null], removal: ['Marquer une sortie…', null], archive: ['Archiver la position', null], promote: ['Ajouter au portefeuille actuel', null], recompute: ['Recalculer depuis les transactions', 'refresh'], set_ref_qty: ['Utiliser la position réelle', 'check'], edit: ['Corriger à la main…', null] };
  const items = d.items.map((it, n) => {
    const lv = DIAG_LVL[it.level], tx = it.txIds.slice(0, 5).map(diagTxLabel).filter(Boolean);
    const acts = it.act.map((a) => '<button class="btn sm' + (a === 'apply_split' || a === 'archive' || a === 'set_ref_qty' ? ' primary' : '') + '" type="button" data-diag="' + a + '" data-n="' + n + '">' + (a === 'apply_split' && it.splits ? 'Valider le split ' + it.splits.map((s) => '×' + s.ratio + ' (' + esc(fmtDate(s.date)) + ')').join(', ') : btn[a][0]) + '</button>').join('');
    return '<div class="diag-item lvl-' + it.level + '"><div class="diag-h"><span class="badge ' + lv[1] + '">' + lv[0] + '</span> <b>' + esc(it.name || '—') + '</b>' + (it.isin ? ' <small class="muted">' + esc(it.isin) + '</small>' : '') + '</div>' +
      '<div class="diag-line"><b>Cause probable :</b> ' + esc(it.cause) + '</div><div class="diag-line"><b>Action recommandée :</b> ' + esc(it.action || '—') + '</div>' +
      (tx.length ? '<div class="diag-line muted"><b>Transactions concernées :</b> ' + tx.map(esc).join(' ; ') + (it.txIds.length > 5 ? ' … (+' + (it.txIds.length - 5) + ')' : '') + '</div>' : '') + (acts ? '<div class="btn-row" style="margin-top:8px">' + acts + '</div>' : '') + '</div>';
  }).join('');
  const m = openModal('<h2>Contrôle de l\'historique</h2><div class="sub">Compare vos transactions, les opérations sur titres validées et vos positions réelles. Rien n\'est supprimé ni corrigé sans votre action ; chaque correction est annulable.</div>' +
    '<div class="chips-row">' + chip(d.counts.error, 'Anomalies', 'neg') + chip(d.counts.warn, 'À vérifier', 'warn-t') + chip(d.counts.info, 'Informations', '') + chip(d.counts.negative, 'Quantités négatives', 'neg') + chip(d.counts.zeroHeld, 'Quantité nulle au portefeuille', 'warn-t') + '</div>' +
    '<div class="btn-row" style="margin:8px 0"><span class="muted" style="align-self:center">Positions réelles de référence : <b>' + refTxt + '</b></span><span class="grow"></span><button class="btn sm" type="button" id="dgChkRef">' + icon('upload') + 'Charger le relevé de portefeuille DEGIRO…</button></div>' +
    '<div class="sec">Dernier import</div>' + repHtml +
    '<div class="sec">Anomalies et actions</div>' + (items || '<div class="notice info">Aucune anomalie détectée : quantités et PRU sont cohérents avec les transactions' + (d.reference.mode ? ' et avec vos positions réelles' : ' (aucune position réelle de référence : chargez le relevé DEGIRO pour une vérification complète)') + '.</div>') +
    '<div class="sec">Positions : application, calcul, réalité</div>' + (rowsH ? '<div class="tbl-wrap" style="max-height:300px"><table class="tbl"><thead><tr><th>Actif</th><th>Statut</th><th class="r">Application</th><th class="r">Calculée (transactions)</th><th class="r">Réelle</th><th>État</th></tr></thead><tbody>' + rowsH + '</tbody></table></div>' : '<div class="muted">Aucune position avec historique.</div>') +
    '<div class="modal-actions"><span></span><div class="btn-row">' + (state.undo ? '<button class="btn" type="button" id="dgChkUndo">Annuler la dernière correction</button>' : '') + '<button class="btn primary" type="button" data-close>Fermer</button></div></div>', { wide: true });
  const undoBtn = $('#dgChkUndo', m); if (undoBtn) undoBtn.onclick = async () => { await undoLastImport(); openDiagnostic(); };
  $('#dgChkRef', m).onclick = () => diagLoadReference();
  $$('[data-diag]', m).forEach((b) => b.onclick = () => diagAct(b.dataset.diag, d.items[Number(b.dataset.n)]));
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
  if (kind === 'archive') { diagCommit('Position archivée : ' + it.name, () => Ledger.demote(state, it.instId, it.code, it.cause, diagDeps())); return; }
  if (kind === 'promote') { diagCommit('Position ajoutée au portefeuille actuel : ' + it.name, () => Ledger.promote(state, it.instId, diagDeps()), () => { const h = state.holdings.find((x) => x.id === it.instId); if (h && state.settings.relayUrl) refreshMarket([h], { silent: true }); }); return; }
  if (kind === 'set_ref_qty') { diagCommit('Quantité corrigée : ' + it.name + ' → ' + it.refQty, () => { const h = state.holdings.find((x) => x.id === it.instId); if (!h || !(it.refQty > 0)) return { ok: false, error: 'Position réelle introuvable.' }; h.quantity = it.refQty; h.manual = true; return { ok: true }; }); return; }
  if (kind === 'edit') { closeModal(); openHoldingModal(it.instId); return; }
  if (kind === 'recompute') { diagCommit('Position recalculée : ' + it.name, () => { const r = Ledger.reevaluate(state, it.instId, diagDeps()); return { ok: true, r }; }); return; }
}
