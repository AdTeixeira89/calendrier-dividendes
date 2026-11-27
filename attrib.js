/* ==================================================================
   attrib.js — OPÉRATIONS SUR TITRES « ACTIONS GRATUITES » (Air Liquide) : droits, prime de fidélité, rompus.
   Module PUR (testable sous Node). Il PROPOSE ; seule la fonction apply() modifie l'état, sur validation, une seule fois par (opération × position).

   Règles officielles (Air Liquide, Guide de l'actionnaire 2026, fiches pratiques n°3 et n°5) :
   - attribution de 1 action gratuite pour N détenues (N = 10), compte par compte et mode de détention par mode de détention ; pas de fongibilité des rompus ;
   - fraction (rompu) : la valeur de la fraction est versée en espèces (montant connu après l'opération) ;
   - PRIME DE FIDÉLITÉ : + 10 % sur le nombre d'actions gratuites distribuées, pour les actions détenues AU NOMINATIF (pur ou administré) depuis plus de deux années
     civiles pleines (du 1er janvier au 31 décembre), toujours détenues la veille de l'attribution. Les actions achetées en année Y (conversion au nominatif avant le 29 décembre,
     actions achetées les 30 et 31 décembre comptées l'année suivante) bénéficient de la prime à partir de Y + 3. Les actions gratuites reçues gardent l'ancienneté des actions d'origine.
     Exemple officiel : 100 actions éligibles → 10 gratuites + 1 de prime ; 225 actions dont 112 éligibles → 22 + 1, rompus 0,5 + 0,12.
   - Au porteur (compte-titres, PEA) : attribution de base seulement, pas de prime de fidélité.
   Rien n'est supposé : un cas incertain (cessions, ancienneté approximative, historique incomplet, mode de détention non indiqué, date non confirmée) est « à vérifier ».
   ================================================================== */
(function (root) {
  'use strict';
  const Ledger = (typeof require === 'function' && typeof module !== 'undefined' && !root.Ledger) ? require('./ledger.js') : root.Ledger;
  const num = (v) => { const n = Number(v); return isFinite(n) ? n : 0; };
  const r6 = (x) => Math.round(x * 1e6) / 1e6;
  const EPS = 1e-9;
  const addDays = (iso, n) => { const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
  const dayNum = (iso) => Date.parse(iso + 'T00:00:00Z') / 86400000;

  /* Opérations OFFICIELLES connues (jamais de date inventée : ce qui n'est pas confirmé est marqué comme tel). */
  const CATALOGUE = [
    { id: 'AI-2026-06', isin: 'FR0000120073', name: 'Air Liquide', N: 10, bonusPct: 10, agDate: '2026-05-05', creditDate: '2026-06-10', exDate: '2026-06-08', exConfirmed: false, creditConfirmed: true,
      source: 'Air Liquide — Guide de l\'actionnaire 2026 (fiche pratique n° 5) : attribution de 1 pour 10 en juin 2026, Assemblée Générale du 5 mai 2026 ; jour du détachement non confirmé par un avis officiel' }
  ];
  const ISINS = Array.from(new Set(CATALOGUE.map((o) => o.isin)));
  const isEligibleIsin = (isin) => ISINS.indexOf(String(isin || '').toUpperCase()) >= 0;
  /* Émetteur d'une position : par ISIN, ou — quand la position n'a pas d'ISIN (ex. nominatif pur saisi à la main) — par son nom ou son symbole. */
  const ISSUER_NAMES = { 'FR0000120073': { name: /air\s*liquide/i, tickers: ['AI.PA', 'AI'] } };
  function issuerOf(h) {
    const isin = String((Ledger && Ledger.holdingIsin ? Ledger.holdingIsin(h) : h.isin) || '').toUpperCase();
    if (isin) return isEligibleIsin(isin) ? isin : null;
    const nm = String(h.name || ''), tk = String(h.ticker || h.displayTicker || '').toUpperCase();
    for (const k of Object.keys(ISSUER_NAMES)) if (ISSUER_NAMES[k].name.test(nm) || ISSUER_NAMES[k].tickers.indexOf(tk) >= 0) return k;
    return null;
  }
  const matches = (h) => issuerOf(h) !== null;
  /* Mode de détention : choix explicite de l'utilisateur, sinon DÉDUIT DU NOM DU PORTEFEUILLE (« nominatif », « Uptevia » → nominatif ; DEGIRO, CTO, PEA, compte-titres, courtier → porteur). */
  function modeOf(state, h) {
    if (h.holdMode === 'registered' || h.holdMode === 'bearer') return { mode: h.holdMode, inferred: false };
    const acc = ((state.accounts || []).find((a) => a.id === h.account) || {}).name || '';
    if (/nominatif|uptevia|registered/i.test(acc)) return { mode: 'registered', inferred: true, from: acc };
    if (/degiro|cto|pea|compte[-\s]*titres|trade\s*republic|boursorama|saxo|interactive|bourse|courtier|broker/i.test(acc)) return { mode: 'bearer', inferred: true, from: acc };
    return { mode: null, inferred: false };
  }

  const holdingIsin = (h) => (Ledger && Ledger.holdingIsin ? Ledger.holdingIsin(h) : String(h.isin || '').toUpperCase());
  /* Opérations connues : catalogue + opérations ajoutées (détection de marché, saisie) ; une opération d'état de même identifiant remplace celle du catalogue. */
  function operations(state) {
    const byId = {}; CATALOGUE.forEach((o) => { byId[o.id] = Object.assign({}, o); });
    (state.attributions || []).forEach((o) => { if (o && o.id) byId[o.id] = Object.assign({}, byId[o.id] || {}, o); });
    return Object.keys(byId).map((k) => byId[k]).sort((a, b) => ((a.creditDate || a.exDate) < (b.creditDate || b.exDate) ? -1 : 1));
  }

  /* Ancienneté au nominatif : année « effective » d'inscription (les inscriptions à partir du 29 décembre comptent l'année suivante). */
  const effYear = (since) => { const y = Number(String(since).slice(0, 4)); return String(since).slice(5, 10) >= '12-29' ? y + 1 : y; };

  /* Lots détenus la veille de la date de référence (rejoués depuis le grand livre : achats, livraisons gratuites, cessions, splits). */
  function lotsAt(state, h, refDate) {
    const info = { lots: [], hadSells: false, approx: false, noHistory: false, inconsistent: false };
    const e = Ledger.entriesFor(state, h), txs = e.txs;
    if (!txs.length) { info.noHistory = true; const q = num(h.quantity); if (q > EPS) info.lots.push({ qty: q, since: h.addedAt ? String(h.addedAt).slice(0, 10) : null, approx: true }); info.approx = true; return info; }
    const led = Ledger.run(e.entries), cq = num(h.quantity); if (Math.abs(led.qty - cq) > 1e-6 * Math.max(1, cq)) info.inconsistent = true;
    const sorted = e.entries.slice().sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : (a.time || '') < (b.time || '') ? -1 : (a.time || '') > (b.time || '') ? 1 : 0));
    sorted.forEach((x) => {
      if (x.date > refDate) return; const q = num(x.qty), tx = x.tx || {};
      if (x.type === 'buy') { const ap = !!tx.approx; if (ap) info.approx = true; info.lots.push({ qty: q, since: tx.nomSince || x.date, approx: ap }); }
      else if (x.type === 'grant') { const tot = info.lots.reduce((s, l) => s + l.qty, 0); if (tot > EPS) info.lots.forEach((l) => { l.qty += q * l.qty / tot; }); else info.lots.push({ qty: q, since: tx.nomSince || x.date, approx: false }); }
      else if (x.type === 'split') { const r = num(x.ratio); if (r > 0) info.lots.forEach((l) => { l.qty *= r; }); }
      else if (x.type === 'sell' || x.type === 'retire') { info.hadSells = true; let left = q; for (let i = 0; i < info.lots.length && left > EPS; i++) { const t = Math.min(left, info.lots[i].qty); info.lots[i].qty -= t; left -= t; } }
    });
    info.lots = info.lots.filter((l) => l.qty > EPS);
    return info;
  }

  /* Calcul des droits d'UNE position pour UNE opération. mode : 'bearer' | 'registered' | undefined. */
  function compute(state, h, op, opt) {
    opt = opt || {};
    const ref = addDays(op.exDate || op.creditDate, -1), refYear = Number(ref.slice(0, 4)), mode = modeOf(state, h).mode;
    const lots = lotsAt(state, h, ref), held = r6(lots.lots.reduce((s, l) => s + l.qty, 0)), reasons = [];
    let eligible = 0;
    if (mode === 'registered') {
      lots.lots.forEach((l) => { if (l.since && effYear(l.since) <= refYear - 3) eligible += l.qty; });
      if (opt.eligibleOverride != null && opt.eligibleOverride >= 0) eligible = Math.min(held, Number(opt.eligibleOverride));
    }
    eligible = r6(eligible);
    const N = num(op.N), pct = num(op.bonusPct), base = N > 0 ? Math.floor(held / N + EPS) : 0, bonusExact = mode === 'registered' && N > 0 ? eligible / N * pct / 100 : 0, bonus = Math.floor(bonusExact + EPS);
    const rompuQty = r6((N > 0 ? held / N - base : 0) + (bonusExact - bonus));
    if (!mode) reasons.push('mode de détention non indiqué (au porteur ou au nominatif)');
    if (lots.noHistory) reasons.push('aucune opération enregistrée : date de détention inconnue');
    if (lots.inconsistent) reasons.push('historique d\'opérations incohérent avec la quantité enregistrée');
    if (mode === 'registered' && lots.approx && !lots.noHistory) reasons.push('date d\'acquisition approximative (opération d\'ouverture)');
    if (mode === 'registered' && lots.hadSells) reasons.push('des cessions ont eu lieu : l\'ordre des titres cédés détermine l\'ancienneté restante');
    if (!op.exConfirmed) reasons.push('date de détachement non confirmée par un avis officiel');
    if (!op.creditDate) reasons.push('date d\'attribution inconnue');
    return { holdingId: h.id, opId: op.id, mode, refDate: ref, held, eligible, N, bonusPct: pct, base, bonus, free: base + bonus, rompuQty, after: r6(held + base + bonus), lots: lots.lots.map((l) => ({ qty: r6(l.qty), since: l.since, eligible: mode === 'registered' && !!l.since && effYear(l.since) <= refYear - 3 })), reasons };
  }

  /* Opération déjà appliquée à cette position ? (enregistrement de cette fonction, ou livraison gratuite saisie / importée à la même période) */
  function appliedOf(state, h, op) {
    const rec = (state.attribApplied || []).find((a) => a.opId === op.id && a.holdingId === h.id); if (rec) return { rec, by: 'attrib' };
    const center = op.creditDate || op.exDate; if (!center) return null;
    const tx = (state.transactions || []).find((t) => t.holdingId === h.id && t.corp && t.type === 'buy' && t.date && Math.abs(dayNum(t.date) - dayNum(center)) <= 10);
    return tx ? { tx, by: 'ledger' } : null;
  }

  const allOps = (state, todayISO) => operations(state).concat(detectFromMarket(state, todayISO).filter((c) => !operations(state).some((o) => o.id === c.id)));

  /* Statut et proposition de chaque (opération × position) : 'applied' | 'proposed' (données fiables, à valider) | 'review' (à vérifier) | 'none' (non concernée). */
  function proposals(state, todayISO) {
    const out = [], held = (state.holdings || []).filter(matches);
    allOps(state, todayISO).forEach((op) => {
      const date = op.creditDate || op.exDate; if (!date || date > todayISO) { return; }
      held.filter((h) => issuerOf(h) === op.isin.toUpperCase()).forEach((h) => {
        const ap = appliedOf(state, h, op);
        if (ap) { out.push({ status: 'applied', op, h, applied: ap }); return; }
        if (h.addedAt && String(h.addedAt).slice(0, 10) > date && !(state.transactions || []).some((t) => t.holdingId === h.id && t.date && t.date <= date)) { return; }     // position entrée après l'opération
        const c = compute(state, h, op);
        if (c.held <= EPS) return;
        out.push({ status: c.free <= 0 ? 'rompu_only' : (c.reasons.length ? 'review' : 'proposed'), op, h, calc: c });       // 'rompu_only' : moins de N titres, aucune action gratuite entière — rien à appliquer ni à valider
      });
    });
    return out;
  }

  /* Candidat d'après les données de marché : un fractionnement ≈ 1 + 1/N (ex. 1,1) détecté sur la position signale une attribution, sans source officielle → « à vérifier ». */
  function detectFromMarket(state, todayISO) {
    const found = [], known = operations(state);
    (state.holdings || []).filter(matches).forEach((h) => {
      (h.splits || []).forEach((s) => {
        if (!s || !s.date || !(num(s.ratio) > 1.05 && num(s.ratio) < 1.25) || s.date > todayISO) return;
        if (known.some((o) => Math.abs(dayNum(o.exDate || o.creditDate) - dayNum(s.date)) <= 12)) return;
        const N = Math.round(1 / (num(s.ratio) - 1)); if (!(N >= 2 && N <= 100)) return;
        const id = 'AI-mkt-' + s.date; if (!found.some((f) => f.id === id)) found.push({ id, isin: issuerOf(h), name: h.name || 'Air Liquide', N, bonusPct: 10, exDate: s.date, creditDate: addDays(s.date, 2), exConfirmed: false, creditConfirmed: false, origin: 'market',
          source: 'Données de marché : fractionnement ' + s.ratio + ' détecté au ' + s.date + ' (aucun avis officiel trouvé) ; date d\'attribution estimée' });
      });
    });
    return found;
  }

  /* APPLICATION (validée par l'utilisateur) : une livraison gratuite (quantité + gratuites, coût total inchangé, PRU recalculé) + trace de l'opération. Jamais deux fois. */
  function apply(state, opId, holdingId, deps, opt) {
    const err = (error) => ({ ok: false, error });
    const op = allOps(state, deps.today).find((o) => o.id === opId); if (!op) return err('Opération inconnue.');
    const h = (state.holdings || []).find((x) => x.id === holdingId); if (!h) return err('Position introuvable.');
    if (appliedOf(state, h, op)) return err('Cette opération est déjà appliquée à cette position.');
    const c = compute(state, h, op, opt); if (!(c.free > 0)) return err('Aucune action gratuite entière à attribuer (' + c.held + ' titre(s) détenu(s) pour 1 pour ' + c.N + ').');
    const date = op.creditDate || op.exDate; if (!date || date > deps.today) return err('Date d\'attribution invalide.');
    const r = Ledger.recordFreeShares(state, holdingId, { date, qty: c.free, note: 'Attribution ' + op.name + ' 1 pour ' + op.N + (c.bonus ? ' (dont ' + c.bonus + ' de prime de fidélité)' : '') }, deps);
    if (!r.ok) return r;
    const tx = state.transactions.find((t) => t.id === r.id); if (tx) tx.attribId = op.id;
    state.attributions = state.attributions || []; if (!state.attributions.some((o) => o.id === op.id)) state.attributions.push(Object.assign({}, op, { savedAt: deps.today }));
    state.attribApplied = state.attribApplied || [];
    const rec = { id: deps.uid(), opId: op.id, holdingId, txId: r.id, date, mode: c.mode, before: c.held, eligible: c.eligible, base: c.base, bonus: c.bonus, free: c.free, rompuQty: c.rompuQty, rompuCash: null, after: r6(num(h.quantity)), at: deps.today, reasons: c.reasons, uncertainOverride: !!(opt && opt.eligibleOverride != null) };
    state.attribApplied.push(rec);
    return { ok: true, rec, result: r };
  }
  /* Indemnité de rompus (espèces) : enregistrée À PART, jamais dans les dividendes. */
  function setRompuCash(state, appliedId, amount, deps) {
    const rec = (state.attribApplied || []).find((a) => a.id === appliedId); if (!rec) return { ok: false, error: 'Opération introuvable.' };
    const D = (typeof require === 'function' && typeof module !== 'undefined' && !root.Dividends) ? require('./dividends.js') : root.Dividends;
    if (amount === null || amount === '' || amount === undefined) { rec.rompuCash = null; if (D && deps) D.setRompu(state, { key: 'attrib:' + rec.id, holdingId: rec.holdingId }, deps); return { ok: true }; }
    const v = Number(amount); if (!(v >= 0)) return { ok: false, error: 'Montant invalide.' }; rec.rompuCash = Math.round(v * 100) / 100;
    if (D && deps) D.setRompu(state, { key: 'attrib:' + rec.id, holdingId: rec.holdingId, date: rec.date, amount: rec.rompuCash }, deps);
    return { ok: true };
  }
  /* Même chose pour une attribution déjà enregistrée (livraison gratuite saisie ou importée) : l'indemnité est portée par l'opération. */
  function setRompuOnTx(state, txId, amount, deps) {
    const tx = (state.transactions || []).find((t) => t.id === txId); if (!tx) return { ok: false, error: 'Opération introuvable.' };
    const D = (typeof require === 'function' && typeof module !== 'undefined' && !root.Dividends) ? require('./dividends.js') : root.Dividends;
    const v = amount === null || amount === '' || amount === undefined ? null : Number(amount); if (v !== null && !(v >= 0)) return { ok: false, error: 'Montant invalide.' };
    if (v === null) delete tx.rompuCash; else tx.rompuCash = Math.round(v * 100) / 100;
    if (D && deps) D.setRompu(state, { key: 'tx:' + tx.id, holdingId: tx.holdingId, date: tx.date, amount: v }, deps);
    return { ok: true };
  }
  /* Annulation d'une application : défait la livraison gratuite (quantité et PRU) et retire la trace. */
  function revert(state, appliedId) {
    const i = (state.attribApplied || []).findIndex((a) => a.id === appliedId); if (i < 0) return { ok: false, error: 'Opération introuvable.' };
    const rec = state.attribApplied[i], r = Ledger.removePurchase(state, rec.txId); if (!r.ok) return r;
    state.attribApplied.splice(i, 1); state.payments = (state.payments || []).filter((p) => !(p.kind === 'rompu' && p.rompuKey === 'attrib:' + rec.id)); return { ok: true };
  }

  const api = { allOps, CATALOGUE, isEligibleIsin, issuerOf, matches, modeOf, operations, effYear, lotsAt, compute, appliedOf, proposals, detectFromMarket, apply, setRompuCash, setRompuOnTx, revert };
  root.Attrib = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof self !== 'undefined' ? self : this);
