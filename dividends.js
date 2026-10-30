/* ==================================================================
   dividends.js — MOTEUR CENTRAL des dividendes (module PUR : ni DOM, ni stockage ; testé sous Node).

   Trois catégories indépendantes :
     A. PERÇU       versements réellement crédités : relevés / CSV importés des courtiers, ou saisie manuelle.
                    C'est la SEULE source de « Dividendes perçus » (aucune estimation n'y entre jamais).
     B. DÛ          droits théoriques : quantité détenue la veille du détachement (achats / ventes datés) × dividende de marché.
                    Calculé à la demande (Engine.dividendProposals), jamais stocké dans les versements.
     C. PRÉVISION   versements futurs estimés (Engine.runRate / buildEvents). Calculé à la demande.

   Ce module : classification A, totaux (brut / retenue / net, par courtier, par entreprise, par mois), import idempotent
   (identifiant stable, compte rendu), migration réversible des anciennes données.
   Rien n'est inventé : un net ou une retenue inconnus restent inconnus (signalés), jamais remplacés par le brut.
   ================================================================== */
(function (root) {
  'use strict';
  const Ledger = (typeof require === 'function' && typeof module !== 'undefined' && !root.Ledger) ? require('./ledger.js') : root.Ledger;
  const r2 = (x) => Math.round(x * 100) / 100;
  const num = (v) => { const n = Number(v); return isFinite(n) ? n : 0; };
  const dateOf = (p) => p.payDate || p.exDate || null;
  const cents = (v) => Math.round(num(v) * 100);
  const hash = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; } return h.toString(36); };

  /* ---------- A. classification ---------- */
  /* Un versement est PERÇU s'il vient d'un courtier (relevé, CSV) ou d'une saisie de l'utilisateur.
     Les estimations (« market-history »), les brouillons générés (« auto ») et tout versement marqué « à vérifier » ne le sont jamais. */
  function isReal(p) {
    if (!p || p.estimated || p.verified === false) return false;
    return p.source !== 'auto' && p.source !== 'market-history';
  }
  const knownIds = (state) => new Set((state.holdings || []).concat(state.archive || []).map((h) => h.id));
  /* Versements perçus rattachés à une position existante (un versement orphelin n'est jamais compté). */
  function realPayments(state) { const k = knownIds(state); return (state.payments || []).filter((p) => isReal(p) && k.has(p.holdingId)); }
  /* Anciennes estimations encore présentes dans les versements, ou déjà rangées dans state.estimates. */
  function estimatesOf(state) { return (state.payments || []).filter((p) => !isReal(p)).concat(state.estimates || []); }

  /* Montants normalisés d'un versement : retenue et net restent null s'ils ne sont pas connus. */
  function amounts(p) {
    const gross = num(p.gross), fees = p.fees == null ? 0 : num(p.fees);
    let tax = p.tax == null ? null : Math.abs(num(p.tax)), net = p.net == null ? null : num(p.net);
    if (net === null && tax !== null) net = gross - tax - fees;
    if (tax === null && net !== null) tax = Math.max(0, gross - net - fees);
    return { gross, tax, net };
  }

  /* ---------- totaux ---------- */
  const brokerName = (state, h) => { const a = h && (state.accounts || []).find((x) => x.id === h.account); return a ? a.name : 'Sans compte'; };
  const companyKey = (state, h, p) => {
    const isin = h ? Ledger.canon(state.isinAlias || {}, Ledger.holdingIsin(h)) : '';
    return isin ? 'i:' + isin : 'n:' + Ledger.norm((h && h.name) || p.name || p.ticker || '?').replace(/ /g, '');
  };
  /* o : { from, to (ISO, inclus), ids (Set d'ids de positions | null), accounts (Set d'ids de comptes | null), convert(v, cur) → nombre | null, year (pour la série mensuelle) }
     Retourne les totaux convertis + le détail. Les montants non convertibles (taux absent) sont comptés à part, jamais ignorés en silence. */
  function summary(state, o) {
    o = o || {}; const convert = o.convert || ((v) => v), insts = new Map((state.holdings || []).concat(state.archive || []).map((h) => [h.id, h]));
    const out = { count: 0, gross: 0, tax: 0, net: 0, taxUnknown: 0, netUnknown: 0, netUnknownGross: 0, unconverted: 0, byBroker: [], byCompany: [], byMonth: [], items: [] };
    const brokers = new Map(), cos = new Map(); if (o.year) for (let m = 0; m < 12; m++) out.byMonth.push({ gross: 0, tax: 0, net: 0, count: 0 });
    const bump = (t, a) => { t.count++; t.gross += a.g; if (a.t !== null) t.tax += a.t; if (a.n !== null) t.net += a.n; };
    realPayments(state).forEach((p) => {
      const d = dateOf(p); if (!d || (o.from && d < o.from) || (o.to && d > o.to)) return;
      const h = insts.get(p.holdingId); if (o.ids && !o.ids.has(p.holdingId)) return; if (o.accounts && !(h && o.accounts.has(h.account))) return;
      const am = amounts(p), cur = p.currency || (h && h.currency) || 'EUR', g = convert(am.gross, cur);
      if (g === null) { out.unconverted++; return; }
      const t = am.tax === null ? null : convert(am.tax, cur), n = am.net === null ? null : convert(am.net, cur);
      const a = { g, t, n }; out.count++; out.gross += g; if (t === null) out.taxUnknown++; else out.tax += t; if (n === null) { out.netUnknown++; out.netUnknownGross += g; } else out.net += n;
      const bn = brokerName(state, h), bk = h ? h.account || '' : '', ck = companyKey(state, h, p);
      const b = brokers.get(bk) || { id: bk, name: bn, count: 0, gross: 0, tax: 0, net: 0 }; brokers.set(bk, b); bump(b, a);
      const c = cos.get(ck) || { key: ck, name: (h && h.name) || p.name || p.ticker || '—', count: 0, gross: 0, tax: 0, net: 0, ids: new Set(), brokers: new Set() }; cos.set(ck, c); bump(c, a); c.ids.add(p.holdingId); c.brokers.add(bn);
      if (o.year && d.slice(0, 4) === String(o.year)) { const m = out.byMonth[Number(d.slice(5, 7)) - 1]; bump(m, a); }
      out.items.push({ id: p.id, holdingId: p.holdingId, companyKey: ck, broker: bn, date: d, currency: cur, gross: am.gross, tax: am.tax, net: am.net, grossC: g, taxC: t, netC: n, origin: p.origin || null, source: p.source || 'manual', extId: p.extId || null });
    });
    out.byBroker = Array.from(brokers.values()).sort((x, y) => y.gross - x.gross);
    out.byCompany = Array.from(cos.values()).map((c) => Object.assign(c, { ids: Array.from(c.ids), brokers: Array.from(c.brokers) })).sort((x, y) => y.gross - x.gross);
    out.items.sort((x, y) => (x.date < y.date ? 1 : x.date > y.date ? -1 : 0));
    ['gross', 'tax', 'net', 'netUnknownGross'].forEach((k) => { out[k] = r2(out[k]); });
    return out;
  }

  /* B. Droits théoriques non encore enregistrés (calcul à la demande ; Engine.dividendProposals reconstitue la quantité à chaque détachement). */
  function entitled(state, today, uid, opt) {
    const E = root.Engine || (typeof require === 'function' ? require('./engine.js') : null);
    return E.dividendProposals(state, today, uid || (() => 'x'), opt || {});
  }

  /* ---------- import idempotent ----------
     incoming : [{ account, holdingId, isin, name, payDate, currency, gross, tax, net, qty, perShare, brokerId (identifiant du courtier, sinon null), origin }]
     Identifiant stable : l'identifiant du courtier s'il existe ; sinon une empreinte (compte, ISIN ou nom, date, devise, brut, retenue) + n° d'occurrence DANS le fichier,
     de sorte que deux versements légitimes identiques (même montant, même date) sont conservés tous les deux, et qu'un fichier réimporté redonne les mêmes identifiants. */
  function stableIds(items, prefix) {
    const seen = {};
    items.forEach((it) => {
      if (it.brokerId) { it.extId = it.brokerId; return; }
      const base = [it.account || '', it.isin || Ledger.norm(it.name || ''), it.payDate, it.currency || '', cents(it.gross), it.tax == null ? '' : cents(it.tax)].join('|');
      seen[base] = (seen[base] || 0) + 1; it.extId = (prefix || 'fp') + ':' + hash(base) + ':' + seen[base];
    });
    return items;
  }
  /* Rapprochement avec l'existant (pur) : { fresh, known, updated, ignored, anomalies }.
     1. même identifiant → connu (ou mis à jour si un montant a changé, avec historique des révisions) ;
     2. identifiant d'ancien format (opts.legacyIds(it) → liste) ou même position + même date + même devise + même brut → adopté (l'ancien versement reçoit l'identifiant) ;
     3. sinon nouveau. Jamais de suppression, jamais de rapprochement « à peu près » entre deux versements réels. */
  function reconcile(state, incoming, opts) {
    opts = opts || {}; const res = { fresh: [], known: [], updated: [], adopted: [], ignored: [], anomalies: [] };
    const real = (state.payments || []).filter(isReal), byExt = new Map(); real.forEach((p) => { if (p.extId) byExt.set(p.extId, p); });
    const used = new Set();
    incoming.forEach((it) => {
      const bad = !it.payDate || !(num(it.gross) > 0) || !it.holdingId;
      if (bad) { res.ignored.push({ item: it, reason: !it.payDate ? 'date manquante' : !(num(it.gross) > 0) ? 'montant brut nul ou manquant' : 'position introuvable' }); return; }
      let ex = byExt.get(it.extId);
      if (!ex && opts.legacyIds) for (const id of opts.legacyIds(it)) { ex = byExt.get(id); if (ex) break; }
      let how = 'id';
      if (!ex) { ex = real.find((p) => !used.has(p.id) && !p.extId && p.holdingId === it.holdingId && p.payDate === it.payDate && (p.currency || '') === (it.currency || '') && cents(p.gross) === cents(it.gross)); how = 'adopt'; }
      if (ex && used.has(ex.id)) { res.anomalies.push({ item: it, reason: 'versement déjà rapproché d\'une autre ligne du fichier' }); ex = null; how = ''; }
      if (!ex) { res.fresh.push(it); return; }
      used.add(ex.id);
      const diff = []; if (cents(ex.gross) !== cents(it.gross)) diff.push('gross'); if ((ex.tax == null) !== (it.tax == null) || (it.tax != null && cents(ex.tax) !== cents(it.tax))) diff.push('tax');
      if (ex.payDate !== it.payDate) diff.push('payDate'); if (ex.holdingId !== it.holdingId) diff.push('holdingId');
      if (how === 'adopt') res.adopted.push({ id: ex.id, item: it }); else if (!diff.length) res.known.push({ id: ex.id, item: it }); else res.updated.push({ id: ex.id, item: it, diff });
    });
    return res;
  }
  /* Applique un rapprochement : ajoute les nouveaux, met à jour les modifiés (révision conservée), donne l'identifiant aux adoptés. Retourne le compte rendu. */
  function applyReconcile(state, res, ctx) {
    ctx = ctx || {}; const uid = ctx.uid, now = ctx.at || new Date().toISOString(), importId = ctx.importId || null;
    const byId = new Map((state.payments || []).map((p) => [p.id, p]));
    const build = (it) => ({ id: uid(), holdingId: it.holdingId, ticker: it.ticker || '', name: it.name || '', exDate: it.exDate || null, payDate: it.payDate, qty: it.qty == null ? null : it.qty, perShare: it.perShare == null ? null : it.perShare,
      gross: r2(num(it.gross)), tax: it.tax == null ? null : r2(Math.abs(num(it.tax))), fees: null, net: it.net == null ? null : r2(num(it.net)), currency: it.currency, source: it.source || 'csv', verified: true, extId: it.extId,
      amountBasis: it.amountBasis, origin: Object.assign({ importId, at: now }, it.origin || {}) });
    res.fresh.forEach((it) => { state.payments.push(build(it)); });
    res.adopted.forEach(({ id, item }) => { const p = byId.get(id); if (!p) return; p.extId = item.extId; p.origin = p.origin || Object.assign({ importId, at: now }, item.origin || {}); });
    res.updated.forEach(({ id, item, diff }) => {
      const p = byId.get(id); if (!p) return;
      p.revisions = (p.revisions || []).concat([{ at: now, importId, before: { gross: p.gross, tax: p.tax, net: p.net, payDate: p.payDate, holdingId: p.holdingId } }]);
      p.gross = r2(num(item.gross)); p.tax = item.tax == null ? null : r2(Math.abs(num(item.tax))); p.net = item.net == null ? null : r2(num(item.net)); p.payDate = item.payDate; p.extId = item.extId;
    });
    return { fresh: res.fresh.length, known: res.known.length, updated: res.updated.length, adopted: res.adopted.length, ignored: res.ignored.length, anomalies: res.anomalies.length };
  }

  /* Journal des importations de dividendes (conservé : nom du fichier, date, compte rendu). */
  function logImport(state, e) { state.dividendImports = (state.dividendImports || []).concat([{ id: e.id, at: e.at || new Date().toISOString(), kind: e.kind, name: e.name || null, account: e.account || null, report: e.report }]).slice(-300); }

  /* ---------- migration réversible des anciennes données ----------
     1. versements réels sans position → rattachés (ISIN, sinon nom) ou position archivée « relevé seul » (Ledger.auditPayments) ;
     2. brut Trade Republic lu comme net → corrigé (Ledger.auditPayments, classe « tr_gross ») ;
     3. TOUTES les estimations (« auto », « market-history », « à vérifier ») sont rangées dans state.estimates (catégorie B) : conservées, jamais comptées.
     Rien n'est supprimé. L'état d'avant est conservé dans state.migrations (annulation possible). */
  function planMigration(state) {
    const audit = Ledger.auditPayments(state), items = audit.items.filter((i) => i.kind === 'orphan_relink' || i.kind === 'orphan_stub' || i.kind === 'tr_gross');
    const estimates = (state.payments || []).filter((p) => !isReal(p)).map((p) => p.id);
    return { audit, items, estimates, empty: !items.length && !estimates.length };
  }
  function applyMigration(state, plan, ctx) {
    ctx = ctx || {}; const at = ctx.at || new Date().toISOString(), id = 'div-v3-' + (ctx.id || hash(at));
    const before = { payments: JSON.parse(JSON.stringify(state.payments || [])), archive: JSON.parse(JSON.stringify(state.archive || [])), estimates: JSON.parse(JSON.stringify(state.estimates || [])) };
    // les estimations liées à une position supprimée ne sont pas rattachées : elles sont simplement rangées
    const keys = new Set(plan.items.map((i) => i.key)), r = Ledger.applyAudit(state, { items: plan.audit.items.filter((i) => keys.has(i.key)), stubs: plan.audit.stubs }, keys, ctx.uid);
    const moved = (state.payments || []).filter((p) => !isReal(p)); state.estimates = (state.estimates || []).concat(moved.map((p) => Object.assign({}, p, { movedAt: at, movedBy: id })));
    state.payments = (state.payments || []).filter((p) => isReal(p));
    state.migrations = (state.migrations || []).concat([{ id, at, label: 'Dividendes : séparation perçu / dû / prévision', before, report: { relinked: r.relinked, stubs: r.stubs, regrossed: r.regrossed, estimatesMoved: moved.length } }]);
    return state.migrations[state.migrations.length - 1].report;
  }
  function undoMigration(state, id) {
    const m = (state.migrations || []).find((x) => x.id === id); if (!m) return false;
    state.payments = m.before.payments; state.archive = m.before.archive; state.estimates = m.before.estimates; state.migrations = state.migrations.filter((x) => x.id !== id); return true;
  }

  root.Dividends = { isReal, realPayments, estimatesOf, amounts, summary, entitled, stableIds, reconcile, applyReconcile, logImport, planMigration, applyMigration, undoMigration, dateOf };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.Dividends;
})(typeof self !== 'undefined' ? self : this);
