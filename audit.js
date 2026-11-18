/* ==================================================================
   audit.js — PHASE 0 : audit des positions, STRICTEMENT EN LECTURE SEULE (module PUR, testé sous Node).
   Compare, pour chaque position, ce que dit le grand livre (Ledger.run, recalculé ici à la volée) avec ce qui est stocké
   (holdings.quantity / holdings.avgCost).
   Garanties : ne reçoit que l'état en lecture ; n'écrit rien (ni dans l'état, ni dans le stockage, ni dans Firebase) ; ne
   crée aucune opération d'ouverture ou d'ajustement ; ne recalcule aucune position ; n'appelle aucune fonction du grand livre qui modifie
   l'état (seulement entriesFor, run, referenceOf, qtyEq). Un test exécute le rapport sur un état entièrement gelé (Object.freeze récursif) :
   toute tentative d'écriture ferait échouer le test.
   ================================================================== */
(function (root) {
  'use strict';
  const Ledger = (typeof require === 'function' && typeof module !== 'undefined' && !root.Ledger) ? require('./ledger.js') : root.Ledger;
  const r2 = (x) => Math.round(x * 100) / 100, r8 = (x) => Math.round(x * 1e8) / 1e8;
  const num = (v) => { const n = Number(v); return isFinite(n) ? n : 0; };
  const TYPE_LABEL = { buy: 'Achat', sell: 'Vente', grant: 'Livraison gratuite', retire: 'Retrait de titres', split: 'Split / regroupement', removal: 'Sortie hors transaction' };
  const MOTIFS = {
    negative: 'Solde négatif dans l\'historique (ventes supérieures aux achats connus)',
    qty: 'Quantité stockée ≠ quantité du grand livre',
    pru: 'PRU stocké ≠ PRU du grand livre',
    pru_missing_stored: 'PRU absent de la position, calculable par l\'historique',
    pru_uncomputable: 'PRU non vérifiable : montants manquants dans l\'historique (achat sans prix ou en autre devise)',
    cost_currency: 'Mêmes chiffres mais devise du PRU différente de celle du grand livre : libellé de devise suspect'
  };
  const near = (d1, d2) => Math.abs(Date.parse(d1) - Date.parse(d2)) < 5 * 86400000;
  /* Rapport simple entier proche de 1/ratio ou ratio (split ou regroupement probable) */
  function ratioHint(a, b) {
    if (!(a > 0) || !(b > 0)) return null;
    const r = a / b, cand = r >= 1 ? r : 1 / r, k = Math.round(cand);
    if (k >= 2 && Math.abs(cand - k) <= 1e-6 * k) return r >= 1 ? k : 1 / k;
    return null;
  }

  function auditOne(state, h, kind, ref) {
    const { entries, cur, txs } = Ledger.entriesFor(state, h);
    const allTx = (state.transactions || []).filter((t) => t.holdingId === h.id);
    const trade = allTx.filter((t) => t.type === 'buy' || t.type === 'sell');
    const undated = trade.filter((t) => !t.date).length, otherTypes = allTx.length - trade.length;
    const isin = Ledger.holdingIsin(h);
    const storedQty = num(h.quantity), pruRaw = num(h.avgCost), storedPru = pruRaw > 0 ? pruRaw : null, storedCostCur = h.costCurrency || h.currency || 'EUR';
    const rec = {
      id: h.id, kind, name: h.name || h.displayTicker || h.ticker || isin || '—', isin, ticker: h.displayTicker || h.ticker || '', account: h.account || null,
      priceCur: h.currency || 'EUR', storedCostCur, ledgerCur: cur,
      storedQty, storedPru, derived: h.derived === true, manual: h.manual === true, source: h.source || null, addedAt: h.addedAt || null,
      ops: txs.length, corpOps: entries.length - txs.length, zeroOps: txs.filter((t) => t.corp).length, openingOps: txs.filter((t) => t.opening).length,
      ledgerQty: null, ledgerPru: null, ledgerCost: null, qtyDiff: null, pruDiff: null, pruDiffPct: null, pruComparable: false,
      category: 'coherent', reasons: [], hints: [], anomalies: [], refQty: ref && ref.rec ? ref.rec.qty : null, refMode: ref ? ref.mode : null, rows: []
    };
    if (undated) rec.anomalies.push(undated + ' opération(s) sans date : ignorée(s) par le grand livre');
    if (otherTypes) rec.anomalies.push(otherTypes + ' enregistrement(s) rattaché(s) à la position qui ne sont ni achat ni vente (non pris en compte)');
    if (!txs.length) {
      rec.category = 'noOps';
      if (rec.derived) rec.anomalies.push('Position marquée « issue d\'un import » mais sans aucune opération enregistrée');
      if (rec.corpOps) rec.anomalies.push(rec.corpOps + ' opération(s) sur titres validée(s) sans achat ni vente associé');
      if (!storedPru) rec.anomalies.push('Aucun PRU enregistré');
      if (ref && ref.rec) rec.hints.push('Relevé de référence : ' + ref.rec.qty + ' titre(s)' + (Math.abs(ref.rec.qty - storedQty) > 1e-6 * Math.max(1, storedQty) ? ' (≠ quantité stockée ' + storedQty + ')' : ' (= quantité stockée)') + '.');
      return rec;
    }
    const led = Ledger.run(entries);
    rec.ledgerQty = led.qty; rec.ledgerPru = led.pru; rec.ledgerCost = led.cost;
    rec.qtyDiff = r8(storedQty - led.qty);
    const qtyOk = Ledger.qtyNear(led.qty, storedQty, state);
    // anomalies informatives (toutes catégories)
    (led.issues || []).forEach((i) => rec.anomalies.push(i.date + ' : ' + i.msg));
    const warned = txs.filter((t) => t.warn && t.warn.length).length; if (warned) rec.anomalies.push(warned + ' opération(s) importée(s) avec alerte de lecture');
    if (rec.zeroOps) rec.anomalies.push(rec.zeroOps + ' mouvement(s) de titres sans montant (livraison gratuite, retrait, échange, transfert ?)');
    const noAmt = entries.filter((e) => (e.type === 'buy' || e.type === 'sell') && e.amt == null).length;
    if (led.costUnknown) rec.anomalies.push(led.costUnknown + ' achat(s) sans montant exploitable (PRU non calculable)');
    else if (noAmt) rec.anomalies.push(noAmt + ' opération(s) sans montant exploitable (résultat réalisé inconnu)');
    const mixed = txs.filter((t) => (t.acctCur || t.currency || 'EUR') !== cur).length; if (mixed) rec.anomalies.push(mixed + ' opération(s) dans une autre devise que la première (' + cur + ') : montants ignorés par le grand livre');
    if (led.cycles > 1) rec.anomalies.push(led.cycles + ' cycles d\'achat/vente totale dans l\'historique');
    if (rec.openingOps) rec.anomalies.push(rec.openingOps + ' opération(s) d\'ouverture approximative');
    // PRU comparable ?
    const sameCur = storedCostCur === cur;
    if (led.negative) rec.reasons.push('negative');
    if (!qtyOk) rec.reasons.push('qty');
    if (led.costUnknown > 0) { if (storedPru !== null) rec.reasons.push('pru_uncomputable'); }
    else if (led.pru === null) { /* quantité nulle dans le grand livre : pas de PRU à comparer */ }
    else if (storedPru === null) rec.reasons.push('pru_missing_stored');
    else if (!sameCur) {
      // devises différentes : sans taux de change historique la comparaison est impossible. Mêmes chiffres à 0,5 % près = libellé de devise suspect (divergence) ; sinon : information, pas une divergence.
      const rel = led.pru > 0 ? Math.abs(storedPru - led.pru) / led.pru : 1;
      if (rel <= 0.005) rec.reasons.push('cost_currency'); else rec.anomalies.push('PRU enregistré en ' + storedCostCur + ', grand livre en ' + cur + ' : non comparable sans taux de change historique (les quantités sont cohérentes)');
    }
    else {
      rec.pruComparable = true; rec.pruDiff = storedPru - led.pru; rec.pruDiffPct = led.pru > 0 ? rec.pruDiff / led.pru : null;
      if (!Ledger.pruNear(storedPru, led.pru, state)) rec.reasons.push('pru');          // marge d'erreur réglable (Paramètres) : 3 % par défaut
    }
    if (rec.reasons.length) rec.category = 'divergent';
    // aides au diagnostic (opérations manquantes ou causes probables)
    if (!qtyOk) {
      if (rec.qtyDiff > 0) rec.hints.push('La position stockée compte ' + rec.qtyDiff + ' titre(s) de plus que l\'historique : achat, livraison ou transfert entrant absent de l\'historique, ou split non validé.');
      else rec.hints.push('La position stockée compte ' + Math.abs(rec.qtyDiff) + ' titre(s) de moins que l\'historique : vente ou sortie présente dans l\'historique mais pas reportée sur la position (position modifiée à la main ?).');
      const rh = ratioHint(storedQty, led.qty); if (rh) rec.hints.push('Le rapport stocké / historique vaut ' + (rh >= 1 ? '×' + rh : '÷' + Math.round(1 / rh)) + ' : ressemble à un split ou un regroupement non validé.');
      const mkt = (h.splits || []).filter((x) => x && x.date && x.ratio > 0 && (!led.first || x.date >= led.first)), corpSplits = entries.filter((e) => e.type === 'split');
      const mktOnly = mkt.filter((x) => !corpSplits.some((c) => near(c.date, x.date)));
      if (mktOnly.length) {
        const wm = Ledger.run(entries.concat(mktOnly.map((x) => ({ date: x.date, time: '', type: 'split', qty: 0, ratio: x.ratio, amt: null }))));
        rec.marketSplits = { list: mktOnly.map((x) => ({ date: x.date, ratio: x.ratio })), qty: wm.qty, pru: wm.pru };
        if (Ledger.qtyEq(wm.qty, storedQty) || Math.abs(wm.qty - storedQty) <= 0.005) rec.hints.push('L\'écart disparaît' + (Ledger.qtyEq(wm.qty, storedQty) ? '' : ' (à l\'arrondi près : quantité enregistrée à 2 décimales)') + ' en appliquant ' + (mktOnly.length > 1 ? 'les splits de marché' : 'le split de marché') + ' ' + mktOnly.map((x) => '×' + x.ratio + ' (' + x.date + ')').join(', ') + ' : split non validé dans l\'application.');
        else rec.hints.push('Splits de marché connus mais non validés : ' + mktOnly.map((x) => '×' + x.ratio + ' (' + x.date + ')').join(', ') + ' (ils ne suffisent pas à expliquer l\'écart).');
      }
      if (ref && ref.rec) {
        if (Ledger.qtyEq(ref.rec.qty, storedQty)) rec.hints.push('Le relevé de portefeuille de référence (' + ref.rec.qty + ') correspond à la quantité stockée : c\'est l\'historique qui est incomplet.');
        else if (Ledger.qtyEq(ref.rec.qty, led.qty)) rec.hints.push('Le relevé de portefeuille de référence (' + ref.rec.qty + ') correspond au grand livre : c\'est la quantité stockée qui diffère.');
        else rec.hints.push('Le relevé de portefeuille de référence indique ' + ref.rec.qty + ' titre(s) : différent des deux.');
      }
    }
    if (rec.reasons.indexOf('pru') >= 0 && qtyOk) rec.hints.push('Quantités identiques mais PRU différents : prix saisi à la main, frais ou devise différents, ou opérations manquantes à prix distinct.');
    if (rec.reasons.indexOf('pru_missing_stored') >= 0) rec.hints.push('Le grand livre permet de calculer ' + (led.pru === null ? '' : r2(led.pru)) + ' ' + cur + ' ; la position n\'a pas de PRU enregistré.');
    // détail du grand livre (toujours fourni pour les divergentes ; les autres catégories n'en ont pas besoin)
    if (rec.category === 'divergent') {
      rec.rows = led.rows.map((r) => {
        const t = r.tx || null;
        return { date: r.date, time: r.time || '', type: r.type, label: TYPE_LABEL[r.type] || r.type, qty: r.type === 'split' ? null : num(r.qty), ratio: r.type === 'split' ? r.ratio : null,
          price: t && t.price !== '' && t.price != null ? num(t.price) : null, fees: t ? num(t.fees) : null, amt: r.amt == null ? null : r.amt, cur: t ? (t.acctCur || t.currency || null) : null,
          source: t ? (t.source || 'manual') : (r.source || 'opération sur titres'), flags: t ? [t.opening ? 'ouverture' : '', t.approx ? 'approx.' : '', t.corp ? 'sans montant' : '', t.liquidation ? 'liquidation' : '', t.warn && t.warn.length ? 'alerte' : ''].filter(Boolean) : ['opération sur titres'],
          extId: t && t.extId ? String(t.extId) : null, qtyAfter: r.qtyAfter, costAfter: r.costAfter, pruAfter: r.pruAfter, realized: r.realized == null ? null : r.realized, issue: r.issue || null };
      });
    }
    return rec;
  }

  /* Point d'entrée : état en lecture seule → rapport. */
  function positions(state, o) {
    o = o || {};
    const accName = new Map((state.accounts || []).map((a) => [a.id, a.name]));
    const out = { generatedAt: o.now || null, totals: { positions: 0, coherent: 0, noOps: 0, divergent: 0, ops: 0, byReason: {}, byAccount: [] }, coherent: [], noOps: [], divergent: [], archiveWithBalance: [], reasonLabels: MOTIFS, typeLabels: TYPE_LABEL };
    const byAcc = new Map();
    (state.holdings || []).forEach((h) => {
      const ref = (() => { try { const r = Ledger.referenceOf(state, h.account), k = Ledger.canon(state.isinAlias || {}, Ledger.holdingIsin(h)); return { mode: r.mode, rec: r.mode === 'file' && r.map && k ? r.map.get(k) || null : null }; } catch (e) { return null; } })();
      const rec = auditOne(state, h, 'holding', ref); rec.accountName = accName.get(rec.account) || '—';
      out[rec.category].push(rec); out.totals.positions++; out.totals[rec.category]++; out.totals.ops += rec.ops;
      rec.reasons.forEach((r) => { out.totals.byReason[r] = (out.totals.byReason[r] || 0) + 1; });
      const a = byAcc.get(rec.account) || { id: rec.account, name: rec.accountName, coherent: 0, noOps: 0, divergent: 0 }; a[rec.category]++; byAcc.set(rec.account, a);
    });
    out.totals.byAccount = Array.from(byAcc.values());
    const key = (a, b) => (a.name || '').localeCompare(b.name || '');
    out.coherent.sort(key); out.noOps.sort(key); out.divergent.sort((a, b) => Math.abs(b.qtyDiff || 0) - Math.abs(a.qtyDiff || 0) || key(a, b));
    // positions clôturées dont le grand livre indique encore des titres (information : hors des trois catégories demandées)
    (state.archive || []).filter((a) => !a.statementOnly).forEach((a) => {
      const { entries, txs } = Ledger.entriesFor(state, a); if (!txs.length) return;
      const led = Ledger.run(entries); if (led.qty > 1e-6 || led.negative) out.archiveWithBalance.push({ id: a.id, name: a.name || a.displayTicker || a.ticker || Ledger.holdingIsin(a) || '—', isin: Ledger.holdingIsin(a), ledgerQty: led.qty, negative: led.negative, ops: txs.length, accountName: accName.get(a.account) || '—' });
    });
    return out;
  }

  /* Exports texte (sans écriture) */
  const csvCell = (v) => { const s = v == null ? '' : String(v); return /[;"\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  const csvText = (head, rows) => '﻿' + [head].concat(rows).map((r) => r.map(csvCell).join(';')).join('\r\n') + '\r\n';
  const nf = (x, d) => (x == null ? '' : String(Math.round(x * Math.pow(10, d == null ? 6 : d)) / Math.pow(10, d == null ? 6 : d)).replace('.', ','));
  function summaryCsv(rep) {
    const head = ['Catégorie', 'Position', 'ISIN', 'Portefeuille', 'Devise cotation', 'Devise PRU stocké', 'Devise grand livre', 'Quantité stockée', 'Quantité grand livre', 'Écart quantité', 'PRU stocké', 'PRU grand livre', 'Écart PRU', 'Écart PRU %', 'Opérations', 'Motifs', 'Pistes', 'Anomalies'];
    const cat = { coherent: 'Cohérente', noOps: 'Sans opérations', divergent: 'Divergente' };
    const rows = [];
    ['divergent', 'noOps', 'coherent'].forEach((k) => rep[k].forEach((p) => rows.push([cat[k], p.name, p.isin, p.accountName, p.priceCur, p.storedCostCur, p.ledgerCur, nf(p.storedQty, 8), nf(p.ledgerQty, 8), nf(p.qtyDiff, 8), nf(p.storedPru, 6), nf(p.ledgerPru, 6), nf(p.pruDiff, 6), p.pruDiffPct == null ? '' : nf(p.pruDiffPct * 100, 2), p.ops, p.reasons.map((r) => MOTIFS[r]).join(' | '), p.hints.join(' | '), p.anomalies.join(' | ')])));
    return csvText(head, rows);
  }
  function detailCsv(rep) {
    const head = ['Position', 'ISIN', 'Portefeuille', 'Date', 'Heure', 'Opération', 'Quantité', 'Ratio', 'Prix', 'Frais', 'Montant (devise du compte)', 'Devise', 'Source', 'Indicateurs', 'Quantité après', 'Coût après', 'PRU après', 'Résultat réalisé', 'Anomalie', 'Identifiant'];
    const rows = [];
    rep.divergent.forEach((p) => p.rows.forEach((r) => rows.push([p.name, p.isin, p.accountName, r.date, r.time, r.label, nf(r.qty, 8), r.ratio == null ? '' : nf(r.ratio, 8), nf(r.price, 6), nf(r.fees, 4), nf(r.amt, 4), r.cur || '', r.source, r.flags.join(' '), nf(r.qtyAfter, 8), nf(r.costAfter, 2), nf(r.pruAfter, 6), nf(r.realized, 2), r.issue || '', r.extId || ''])));
    return csvText(head, rows);
  }

  root.Audit = { positions, summaryCsv, detailCsv, MOTIFS, TYPE_LABEL };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.Audit;
})(typeof self !== 'undefined' ? self : this);
