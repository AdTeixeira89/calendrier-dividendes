/* ==================================================================
   analysis.js — ANALYSE DES DIVIDENDES (position par position ou tout le portefeuille).
   Pour chaque position, détenue ou clôturée :
     1. lecture des dates d'achat / de vente et des quantités (grand livre) ;
     2. recherche de l'historique des dividendes de la société (Yahoo Finance) ;
     3. dividendes auxquels vous aviez droit (quantité détenue la veille du détachement) et montants ;
     4. évolution d'une année à l'autre (hausse / baisse), interruptions ;
     5. comparaison avec les données actuelles : si elles diffèrent, la question est posée avant tout changement.
   Rien n'est modifié sans votre validation ; un dividende « dû » n'est jamais compté comme perçu.
   Lancée automatiquement après un import (résultat dans la cloche) ou à la demande (bouton, fiche d'une position).
   ================================================================== */

const DIV_DROP = 0.03;          // variation annuelle du dividende par titre en dessous de laquelle on signale une baisse (−3 %)

/* Positions à analyser : détenues et clôturées (hors ETF capitalisants), avec un symbole ou un ISIN. */
function dividendInstruments(ids) {
  const arch = (state.archive || []).filter((a) => !a.statementOnly);
  return state.holdings.map((h) => ({ h, closed: false })).concat(arch.map((h) => ({ h, closed: true })))
    .filter((x) => (!ids || ids.has(x.h.id)) && !Engine.isAccumulating(x.h) && (x.h.ticker || x.h.isin));
}

/* Récupère l'historique complet des dividendes (au plus une fois par semaine et par position). */
async function fetchDivHistories(list, progress, cancelled) {
  const errors = [], weekAgo = Date.now() - 7 * 86400000; let done = 0;
  for (const x of list) {
    const h = x.h;
    if (cancelled && cancelled()) break;
    if (progress) progress(done, list.length, h);
    const fresh = h.divHist && h.divHist.at && Date.parse(h.divHist.at) >= weekAgo && h.divHist.currency;
    if (!fresh && !(h.listing === 'delisted' && h.divHist)) {
      try { const r = await market.fetchDividends(h.ticker || h.isin, h.name); h.divHist = { at: new Date().toISOString(), symbol: r.symbol, currency: r.currency, items: r.items }; }
      catch (e) { if (!x.closed) errors.push((h.name || h.ticker) + ' : ' + e.message); if (e.rate || e.fatal) break; }
      await new Promise((r) => setTimeout(r, 200));
    }
    done++;
  }
  if (progress) progress(done, list.length, null);
  return errors;
}

/* Analyse d'une position à partir de ce qui est déjà enregistré (aucun appel réseau). */
function analyseInstrument(h, closed, props) {
  const name = h.name || h.displayTicker || h.ticker, res = { id: h.id, name, closed, status: 'ok', diffs: [], missing: [], already: 0 };
  const div = h.divHist && Array.isArray(h.divHist.items) ? h.divHist : null;
  if (!div) { res.status = 'nodata'; return res; }
  const f = Engine.heldQtyFn(state, h); if (!f.ok) { res.status = 'unverifiable'; res.reason = f.reason; return res; }
  const led = Ledger.run(Ledger.entriesFor(state, h).entries), today = todayISO();
  const from = led.first || String(h.addedAt || '').slice(0, 10); let to = closed ? (led.last || h.closedAt || today) : today; if (h.listing === 'delisted') to = h.delistedAt || led.last || to;
  if (!from) { res.status = 'unverifiable'; res.reason = 'date d\'achat inconnue'; return res; }
  const a = Dividends.analyse(div.items, from, to, f.qtyBefore, today); res.a = a; res.from = from; res.to = to; res.cur = div.currency || h.currency || 'EUR';
  res.missing = props.proposals.filter((p) => p.holdingId === h.id); res.already = props.already.filter((p) => p.holdingId === h.id).length;
  if (!closed && h.listing !== 'delisted') {
    const dv = h.dividend || {}, items = div.items, latest = items.length ? { ex: items[items.length - 1][0], amt: Number(items[items.length - 1][1]) } : null;
    const freq = items.length >= 3 ? Market.detectFrequency(items.slice(-8).map((x) => x[0])) : null;
    if (a.pays && latest) {
      const dAmt = Number(dv.lastAmount) > 0 ? Math.abs(Number(dv.lastAmount) - latest.amt) / latest.amt : 1, freqDiff = freq && freq !== 'irregular' && dv.frequency !== freq;
      if (dv.none || dAmt > 0.02 || freqDiff) res.diffs.push({ kind: 'forecast', id: h.id, label: name + ' : ' + (dv.none ? 'marquée « sans dividende » alors que la société en verse' : 'dividende enregistré ' + (Number(dv.lastAmount) > 0 ? fmtNum(dv.lastAmount, 4) : '—') + ' → dernier versement connu ' + fmtNum(latest.amt, 4) + ' (' + fmtDate(latest.ex) + ')') + (freqDiff ? ' · fréquence ' + (FREQ_LABEL[dv.frequency] || '—').toLowerCase() + ' → ' + (FREQ_LABEL[freq] || freq).toLowerCase() : ''),
        apply: () => { const d2 = h.dividend = h.dividend || {}; d2.none = false; d2.lastAmount = latest.amt; if (freq && freq !== 'irregular') d2.frequency = freq; d2.slots = null; d2.updatedAt = today; } });
    }
    const qDiff = Number(h.quantity) > 0 && led.qty > 0 && Math.abs(led.qty - Number(h.quantity)) > 1e-6 * Math.max(1, Number(h.quantity));
    if (qDiff) res.diffs.push({ kind: 'position', id: h.id, label: name + ' : quantité enregistrée ' + fmtNum(h.quantity) + ' ≠ ' + fmtNum(led.qty) + ' d\'après vos opérations (recalcul de la quantité et du PRU depuis l\'historique)', apply: () => { Ledger.reevaluate(state, h.id, { uid, today }); } });
  }
  return res;
}

function computeDividendAnalysis(ids) {
  const list = dividendInstruments(ids), set = new Set(list.map((x) => x.h.id)), props = Engine.dividendProposals(state, new Date(), uid, { ids: set });
  return { results: list.map((x) => analyseInstrument(x.h, x.closed, props)), props };
}
const analysisIssues = (r) => (r.diffs.length ? 1 : 0) + (r.missing.length ? 1 : 0) + (r.a && r.a.decreases.length ? 1 : 0) + (r.a && r.a.continuity && r.a.continuity.status === 'interrupted' ? 1 : 0);

/* Lance l'analyse. o : { ids (Set | null = tout), auto (en tâche de fond après un import : résultat dans la cloche) } */
async function runDividendAnalysis(o) {
  o = o || {};
  if (!state.settings.relayUrl) { if (!o.auto) toast('Renseignez d\'abord le relais de données (Paramètres) : l\'historique des dividendes vient des données de marché.', { error: true }); return; }
  const list = dividendInstruments(o.ids === undefined ? visibleIds() : o.ids);
  if (!list.length) { if (!o.auto) toast('Aucune action ou ETF distribuant à analyser.', { ms: 5000 }); return; }
  let cancelled = false, m = null;
  if (!o.auto) {
    m = openModal('<h2>Analyse des dividendes</h2><div class="sub">Lecture de vos achats et ventes datés, recherche de l\'historique des dividendes de chaque société, puis comparaison avec vos données. Rien n\'est modifié sans votre validation.</div><div class="progress"><i id="anBar"></i></div><div class="hint" id="anMsg" style="margin-top:8px">Préparation…</div><div class="modal-actions"><span></span><button class="btn" type="button" id="anStop">Arrêter</button></div>', { sticky: true });
    $('#anStop', m).onclick = () => { cancelled = true; closeModal(); };
  }
  const errors = await fetchDivHistories(list, (i, n, h) => { if (!m) return; const msg = $('#anMsg', m), bar = $('#anBar', m); if (msg && h) msg.textContent = (h.name || h.displayTicker || h.ticker) + ' (' + (i + 1) + ' / ' + n + ')…'; if (bar) bar.style.width = Math.round(100 * i / n) + '%'; }, () => cancelled);
  if (cancelled) return;
  saveState(); if (m) closeModal();
  const { results } = computeDividendAnalysis(new Set(list.map((x) => x.h.id))), issues = results.filter((r) => analysisIssues(r) > 0);
  view.lastDivAnalysis = { at: Date.now(), ids: new Set(list.map((x) => x.h.id)), errors };
  if (o.auto) {
    Notify.push({ level: issues.length ? 'warn' : 'info', title: 'Analyse des dividendes : ' + results.length + ' position(s) vérifiée(s)' + (issues.length ? ', ' + issues.length + ' à examiner' : ', rien à signaler'),
      body: issues.length ? issues.slice(0, 4).map((r) => '<b>' + esc(r.name) + '</b> : ' + esc(issueText(r))).join('<br>') + (issues.length > 4 ? '<br>…' : '') : 'Dividendes dus, évolution, interruptions et données actuelles cohérents.',
      accept: issues.length ? { label: 'Voir les résultats', run: () => openDividendAnalysis(view.lastDivAnalysis.ids, view.lastDivAnalysis.errors), ack: false } : undefined });
    renderPageSoft(); return;
  }
  openDividendAnalysis(view.lastDivAnalysis.ids, errors); renderPageSoft();
}

const issueText = (r) => [r.missing.length ? r.missing.length + ' dividende(s) dû(s) non enregistré(s)' : '', r.a && r.a.decreases.length ? 'dividende en baisse (' + r.a.decreases.join(', ') + ')' : '', r.a && r.a.continuity && r.a.continuity.status === 'interrupted' ? 'interruption' : '', r.diffs.length ? r.diffs.length + ' différence(s) avec vos données' : ''].filter(Boolean).join(' · ');
const trendText = (a) => { if (!a || !a.years.length) return '—'; const ys = a.years.slice(-3); return ys.map((y, i) => y.year + ' : ' + fmtNum(y.perShare, 2) + (i > 0 && y.change !== null ? (y.change < -DIV_DROP ? ' ▼ ' : y.change > DIV_DROP ? ' ▲ ' : ' = ') + fmtPct(y.change, 0, true) : '')).join(' · '); };

function openDividendAnalysis(ids, errors) {
  const { results, props } = computeDividendAnalysis(ids), cur = baseCur();
  const diffs = []; results.forEach((r) => r.diffs.forEach((d) => diffs.push(d)));
  const sorted = results.slice().sort((x, y) => analysisIssues(y) - analysisIssues(x) || x.name.localeCompare(y.name));
  const chip = (n, label, cls) => '<div class="card stat-chip"><span>' + label + '</span><b class="' + (n ? cls : '') + '">' + n + '</b></div>';
  const payers = results.filter((r) => r.a && r.a.pays).length, drops = results.filter((r) => r.a && r.a.decreases.length).length, gaps = results.filter((r) => r.a && r.a.continuity && r.a.continuity.status === 'interrupted').length, missingN = results.reduce((s, r) => s + r.missing.length, 0);
  const rowHtml = (r) => {
    const note = r.status === 'nodata' ? '<span class="muted">historique des dividendes non récupéré</span>' : r.status === 'unverifiable' ? '<span class="warn-t">non calculable : ' + esc(r.reason) + '</span>' : null;
    if (note) return '<tr><td><b>' + esc(r.name) + '</b>' + (r.closed ? ' <span class="badge">clôturée</span>' : '') + '</td><td colspan="4">' + note + '</td></tr>';
    const a = r.a, gp = a.continuity && a.continuity.status === 'interrupted' ? a.continuity.gaps.slice(0, 2).map((g) => 'du ' + fmtDate(g.from) + ' au ' + fmtDate(g.to)).join(' ; ') : 'aucune';
    return '<tr><td><b>' + esc(r.name) + '</b>' + (r.closed ? ' <span class="badge">clôturée</span>' : '') + '<div class="dg-note">détenue du ' + esc(fmtDate(r.from)) + (r.closed ? ' au ' + esc(fmtDate(r.to)) : '') + '</div></td>' +
      '<td>' + (a.pays ? '<span class="badge received">Verse un dividende</span><div class="dg-note">' + a.rows.length + ' versement(s) éligible(s)' + (a.eligibleGross ? ' · ' + esc(fmtMoney(a.eligibleGross, r.cur)) + ' bruts' : '') + '</div>' : '<span class="muted">Aucun dividende</span>') + '</td>' +
      '<td>' + esc(trendText(a)) + (a.decreases.length ? '<div class="dg-note warn-t">baisse en ' + esc(a.decreases.join(', ')) + '</div>' : '') + '</td>' +
      '<td>' + (a.continuity && a.continuity.status === 'interrupted' ? '<span class="warn-t">' + esc(gp) + '</span>' : a.continuity && a.continuity.status === 'continuous' ? 'aucune' : '<span class="muted">non évaluable</span>') + '</td>' +
      '<td class="r">' + (r.missing.length ? '<b class="warn-t">' + r.missing.length + '</b> à enregistrer' : r.already ? r.already + ' déjà enregistré(s)' : '—') + '</td></tr>';
  };
  const m = openModal('<h2>Analyse des dividendes</h2><div class="sub">Pour chaque position : quantité détenue à chaque détachement (d\'après vos achats et ventes datés), dividende de la société, évolution d\'une année à l\'autre et interruptions. <b>Rien n\'est modifié</b> sans votre accord.</div>' +
    '<div class="chips-row">' + chip(results.length, 'Positions analysées', '') + chip(payers, 'Versent un dividende', 'pos') + chip(drops, 'Dividende en baisse', 'warn-t') + chip(gaps, 'Avec interruption', 'warn-t') + chip(missingN, 'Dus non enregistrés', 'warn-t') + chip(diffs.length, 'Différences avec vos données', 'warn-t') + '</div>' +
    '<div class="tbl-wrap" style="max-height:38vh"><table class="tbl"><thead><tr><th>Position</th><th>Dividende</th><th>Évolution par titre</th><th>Interruption</th><th class="r">Dus</th></tr></thead><tbody>' + sorted.map(rowHtml).join('') + '</tbody></table></div>' +
    (diffs.length ? '<div class="sec">Différences avec vos données actuelles — voulez-vous les corriger ?</div><div class="act-list">' + diffs.map((d, i) => '<label class="chk"><input type="checkbox" data-adf="' + i + '" checked><span>' + esc(d.label) + '</span></label>').join('') + '</div>' : '') +
    ((errors && errors.length) ? '<div class="hint warn-t" style="margin-top:6px">' + errors.length + ' position(s) non récupérée(s) : ' + errors.slice(0, 3).map(esc).join(' ; ') + (errors.length > 3 ? '…' : '') + '</div>' : '') +
    '<div class="modal-actions"><div class="btn-row">' + (missingN ? '<button class="btn" type="button" id="anDue">Voir les dividendes dus (' + missingN + ')</button>' : '') + '</div><div class="btn-row">' + (diffs.length ? '<button class="btn primary" type="button" id="anApply">Appliquer les changements cochés</button><button class="btn" type="button" data-close>Ne rien changer</button>' : '<button class="btn primary" type="button" data-close>Fermer</button>') + '</div></div>', { wide: true });
  if (missingN) $('#anDue', m).onclick = () => { closeModal(); openDividendReview(props, errors || []); };
  if (diffs.length) $('#anApply', m).onclick = () => {
    const sel = $$('[data-adf]', m).filter((c) => c.checked).map((c) => diffs[Number(c.dataset.adf)]); if (!sel.length) { closeModal(); toast('Aucun changement appliqué.'); return; }
    const prevUndo = state.undo; snapshotForUndo('analyse des dividendes'); sel.forEach((d) => { try { d.apply(); } catch (e) { console.error(e); } });
    saveState(); closeModal(); renderPage(); toast(sel.length + ' changement(s) appliqué(s).', { ms: 10000, action: { label: 'Annuler', fn: undoLastImport } });
  };
}
