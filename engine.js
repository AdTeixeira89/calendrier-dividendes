/* ==================================================================
   engine.js — calculs de dividendes (fonctions pures, sans DOM).
   Modèle de données, statuts des versements, prévisions, indicateurs.
   Chargé par la page ET testable sous Node.

   Statuts d'un versement :
     received    versement enregistré (saisi, importé ou à vérifier)
     confirmed   date/montant annoncés (confirmés par la société)
     forecast    prévision calculée à partir de l'historique (jamais confirmée)
     unrecorded  date passée sans versement enregistré (à vérifier)
   ================================================================== */
(function (root) {
  const P = (typeof require === 'function' && typeof module !== 'undefined' && !root.Payouts)
    ? require('./payouts.js').Payouts : root.Payouts;

  const pad2 = (n) => String(n).padStart(2, '0');
  const iso = (y, m, d) => y + '-' + pad2(m) + '-' + pad2(d);
  const parse = (s) => { if (!s) return null; const a = s.split('-').map(Number); return new Date(a[0], a[1] - 1, a[2]); };
  const toISO = (d) => iso(d.getFullYear(), d.getMonth() + 1, d.getDate());
  const ym = (s) => (s || '').slice(0, 7);
  const num = (v) => { const n = Number(v); return isFinite(n) ? n : 0; };

  const TYPES = { stock: 'Action', etf_dist: 'ETF distribuant', etf_acc: 'ETF capitalisant' };

  /* ---------- modèle ---------- */
  function isAccumulating(h) { return h.type === 'etf_acc'; }

  /* Un actif génère-t-il des prévisions ? (jamais inventer de dividende) */
  function isPayer(h) {
    const d = h.dividend || {};
    return !isAccumulating(h) && !d.none && num(d.lastAmount) > 0 && !!d.anchorMonth && P.freqMonths(d.frequency) > 0;
  }

  /* Statut de la donnée de dividende d'un actif (pour filtres et badges). */
  function dividendStatus(h) {
    const d = h.dividend || {};
    if (isAccumulating(h)) return 'accumulating';
    if (d.none) return 'none';
    if (isPayer(h)) return 'payer';
    if (num(d.lastAmount) > 0 && d.frequency === 'irregular') return 'irregular';
    return 'missing';
  }

  function annualPerShare(h) {
    if (!isPayer(h)) return 0;
    const step = P.freqMonths(h.dividend.frequency);
    return num(h.dividend.lastAmount) * (12 / step);
  }
  function taxRate(h) {
    const r = h.dividend && h.dividend.taxRate;
    return (r === null || r === undefined || r === '' || !isFinite(Number(r))) ? null : Number(r);
  }
  function invested(h) { return h.avgCost > 0 && h.quantity > 0 ? h.quantity * h.avgCost : null; }
  /* Devise du prix de revient (peut différer de celle de l'actif : ex. action en USD achetée via un compte en EUR). */
  function costCur(h) { return h.costCurrency || h.currency || 'EUR'; }
  /* Valeur de marché de la position : quantité × dernier cours (devise de l'actif). */
  function value(h) { return h.price > 0 && h.quantity > 0 ? h.quantity * h.price : null; }

  /* Quantité détenue à une date : on utilise les opérations seulement si elles
     reconstituent exactement la quantité actuelle (sinon l'historique est
     incomplet et la quantité actuelle reste la référence). */
  function quantityAt(state, h, dateISO) {
    const txs = (state.transactions || []).filter((t) => t.holdingId === h.id && (t.type === 'buy' || t.type === 'sell'));
    if (!txs.length) return num(h.quantity);
    const signed = (t) => (t.type === 'buy' ? 1 : -1) * num(t.qty);
    const total = txs.reduce((s, t) => s + signed(t), 0);
    if (Math.abs(total - num(h.quantity)) > 1e-6) return num(h.quantity);
    return Math.max(0, txs.filter((t) => t.date <= dateISO).reduce((s, t) => s + signed(t), 0));
  }

  /* Position et prix de revient moyen pondéré à partir d'opérations. */
  function positionFromTransactions(txs) {
    const sorted = txs.slice().sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    let qty = 0, cost = 0;
    sorted.forEach((t) => {
      const q = num(t.qty);
      if (t.type === 'buy') { cost += q * num(t.price) + num(t.fees); qty += q; }
      else if (t.type === 'sell') {
        const avg = qty > 0 ? cost / qty : 0;
        const sold = Math.min(q, qty);
        cost -= avg * sold; qty -= sold;
      }
    });
    qty = Math.round(qty * 1e8) / 1e8;
    return { quantity: qty, avgCost: qty > 0 ? cost / qty : null };
  }

  /* ---------- événements ---------- */
  function eventNet(e) { return e.net !== null && e.net !== undefined ? e.net : null; }

  function makeEvent(base, over) { return Object.assign({ id: '', holdingId: '', ticker: '', name: '', logo: null, currency: 'EUR', account: null,
    date: '', dateKind: 'pay', status: 'forecast', perShare: 0, qty: 0, gross: 0, tax: null, net: null, verified: true }, base, over); }

  /* Tous les versements (reçus, confirmés, prévus) entre deux dates incluses.
     Dédoublonnage : un versement reçu supprime la prévision du même actif
     dans le même mois (que le mois soit celui du détachement ou du paiement). */
  function buildEvents(state, from, to, today, filterIds) {
    today = today || new Date();
    const todayISO = toISO(today);
    const oldestUnrecorded = toISO(new Date(today.getFullYear(), today.getMonth() - 13, today.getDate()));
    const fromISO = toISO(from), toISO_ = toISO(to);
    const holdings = state.holdings || [];
    const byId = {};
    holdings.forEach((h) => { byId[h.id] = h; });
    const keep = (hid) => !filterIds || filterIds.has(hid);
    const events = [];
    const taken = new Set();   // holdingId|YYYY-MM déjà couverts par un versement réel

    (state.payments || []).forEach((p) => {
      [p.exDate, p.payDate].forEach((d) => { if (d) taken.add(p.holdingId + '|' + ym(d)); });
      const date = p.payDate || p.exDate;
      if (!date || date < fromISO || date > toISO_ || !keep(p.holdingId)) return;
      const h = byId[p.holdingId];
      events.push(makeEvent({
        id: p.id, holdingId: p.holdingId, ticker: p.ticker || (h && (h.displayTicker || h.ticker)) || '?', name: p.name || (h && h.name) || '',
        logo: h ? h.logo : null, isin: h ? h.isin : null, currency: p.currency || (h && h.currency) || 'EUR', account: h ? h.account : null
      }, {
        date, dateKind: p.payDate ? 'pay' : 'ex', status: 'received', perShare: num(p.perShare), qty: num(p.qty),
        gross: num(p.gross), tax: p.tax == null ? null : Math.abs(num(p.tax)), net: p.net == null ? null : num(p.net),
        verified: p.verified !== false, paymentId: p.id
      }));
    });

    holdings.forEach((h) => {
      if (!keep(h.id) || !isPayer(h) && !((h.dividend || {}).confirmed || []).length) return;
      const base = { holdingId: h.id, ticker: h.displayTicker || h.ticker, name: h.name || '', logo: h.logo, isin: h.isin, currency: h.currency || 'EUR', account: h.account };
      const rate = taxRate(h);
      for (let y = from.getFullYear(); y <= to.getFullYear(); y++) {
        for (let m = 1; m <= 12; m++) {
          const key = h.id + '|' + y + '-' + pad2(m);
          if (taken.has(key)) continue;
          let p = null;
          // annoncé / confirmé par la société : prioritaire
          const conf = ((h.dividend || {}).confirmed || []).find((c) => c.payDate && ym(c.payDate) === y + '-' + pad2(m));
          if (conf) {
            const amt = num(conf.amount) || num((h.dividend || {}).lastAmount);
            p = { date: conf.payDate, amount: amt, confirmed: true };
          } else if (isPayer(h)) {
            const q = P.payoutInMonth(h, y, m);
            if (q) p = { date: q.date, amount: q.amount, confirmed: false };
          }
          if (!p || p.date < fromISO || p.date > toISO_) continue;
          // Passé sans versement enregistré : on ne signale que les 13 derniers mois et jamais avant l'ajout de l'actif.
          if (p.date < todayISO && !p.confirmed && (p.date < oldestUnrecorded || (h.addedAt && p.date < h.addedAt))) continue;
          const confirmed = p.confirmed;
          const qty = p.date > todayISO ? num(h.quantity) : quantityAt(state, h, p.date);
          if (qty <= 0) continue;
          const gross = p.amount * qty;
          events.push(makeEvent(base, {
            id: 'f-' + h.id + '-' + p.date, date: p.date,
            dateKind: confirmed ? 'pay' : ((h.dividend || {}).dateKind || 'pay'),
            status: p.date < todayISO ? 'unrecorded' : (confirmed ? 'confirmed' : 'forecast'),
            perShare: p.amount, qty, gross,
            tax: rate === null ? null : gross * rate / 100, net: rate === null ? null : gross * (1 - rate / 100)
          }));
        }
      }
    });
    events.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.ticker < b.ticker ? -1 : 1));
    return events;
  }

  /* ---------- agrégation ---------- */
  /* amount(e, mode) : brut ou net. Le net est "estimé" quand il est inconnu :
     on retombe alors sur le brut et on le signale (netFallback). */
  function amount(e, mode) {
    if (mode === 'net') { const n = eventNet(e); return n === null ? { v: e.gross, fallback: true } : { v: n, fallback: false }; }
    return { v: e.gross, fallback: false };
  }

  /* Somme d'événements, convertie dans la devise de base. convert(a, cur) → nombre ou null. */
  function sumEvents(events, mode, convert) {
    let total = 0, fallbacks = 0; const missing = new Set(); const byCur = {};
    events.forEach((e) => {
      const a = amount(e, mode);
      if (a.fallback) fallbacks++;
      byCur[e.currency] = (byCur[e.currency] || 0) + a.v;
      const c = convert(a.v, e.currency);
      if (c === null) missing.add(e.currency); else total += c;
    });
    return { total, byCur, missing: Array.from(missing), fallbacks, count: events.length };
  }

  function runRate(state, mode, convert, filterIds) {
    let total = 0, fallbacks = 0; const missing = new Set(); const per = [];
    (state.holdings || []).forEach((h) => {
      if (filterIds && !filterIds.has(h.id)) return;
      const g = annualPerShare(h) * num(h.quantity);
      if (!g) return;
      const rate = taxRate(h);
      let v = g;
      if (mode === 'net') { if (rate === null) fallbacks++; else v = g * (1 - rate / 100); }
      const c = convert(v, h.currency || 'EUR');
      if (c === null) { missing.add(h.currency); return; }
      total += c; per.push({ holdingId: h.id, ticker: h.displayTicker || h.ticker, name: h.name, value: c, currency: h.currency });
    });
    return { total, fallbacks, missing: Array.from(missing), per };
  }

  /* Rendement sur coût : revenu annuel brut des actifs dont le prix de revient est connu / montant investi. */
  function yieldOnCost(state, convert, filterIds) {
    let income = 0, cost = 0, withCost = 0, payers = 0;
    (state.holdings || []).forEach((h) => {
      if (filterIds && !filterIds.has(h.id)) return;
      if (!isPayer(h)) return;
      payers++;
      const inv = invested(h);
      if (inv === null) return;
      const ci = convert(annualPerShare(h) * num(h.quantity), h.currency || 'EUR');
      const cc = convert(inv, costCur(h));
      if (ci === null || cc === null) return;
      income += ci; cost += cc; withCost++;
    });
    return { rate: cost > 0 ? income / cost : null, withCost, payers, income, cost };
  }

  function investedTotal(state, convert, filterIds) {
    let cost = 0, n = 0; const missing = new Set();
    (state.holdings || []).forEach((h) => {
      if (filterIds && !filterIds.has(h.id)) return;
      const inv = invested(h); if (inv === null) return;
      const c = convert(inv, costCur(h));
      if (c === null) { missing.add(costCur(h)); return; }
      cost += c; n++;
    });
    return { cost, count: n, missing: Array.from(missing) };
  }

  /* Valeur de marché du portefeuille (actifs ayant un cours). */
  function portfolioValue(state, convert, filterIds) {
    let total = 0, n = 0, all = 0; const missing = new Set(); let latest = null;
    (state.holdings || []).forEach((h) => {
      if (filterIds && !filterIds.has(h.id)) return;
      all++;
      const v = value(h); if (v === null) return;
      const c = convert(v, h.currency || 'EUR');
      if (c === null) { missing.add(h.currency); return; }
      total += c; n++;
      if (h.priceAt && (!latest || h.priceAt > latest)) latest = h.priceAt;
    });
    return { total, count: n, of: all, missing: Array.from(missing), latest };
  }

  /* Plus ou moins-value latente : uniquement sur les actifs ayant à la fois un cours ET un prix de revient. */
  function unrealized(state, convert, filterIds) {
    let gain = 0, cost = 0, n = 0;
    (state.holdings || []).forEach((h) => {
      if (filterIds && !filterIds.has(h.id)) return;
      const v = value(h), inv = invested(h); if (v === null || inv === null) return;
      const cv = convert(v, h.currency || 'EUR'), ci = convert(inv, costCur(h)); if (cv === null || ci === null) return;
      gain += cv - ci; cost += ci; n++;
    });
    return { gain, cost, pct: cost > 0 ? gain / cost : null, count: n };
  }

  /* Rendement sur cours : dividendes annuels estimés ÷ valeur actuelle, sur les actifs payeurs ayant un cours. */
  function yieldOnPrice(state, convert, filterIds) {
    let income = 0, val = 0, n = 0;
    (state.holdings || []).forEach((h) => {
      if (filterIds && !filterIds.has(h.id) || !isPayer(h)) return;
      const v = value(h); if (v === null) return;
      const ci = convert(annualPerShare(h) * num(h.quantity), h.currency || 'EUR'), cv = convert(v, h.currency || 'EUR'); if (ci === null || cv === null) return;
      income += ci; val += cv; n++;
    });
    return { rate: val > 0 ? income / val : null, count: n };
  }

  function receivedBetween(state, fromISO, toISOd, mode, convert, filterIds) {
    const evs = (state.payments || []).filter((p) => { const d = p.payDate || p.exDate; return d && d >= fromISO && d <= toISOd && (!filterIds || filterIds.has(p.holdingId)); })
      .map((p) => ({ currency: p.currency || 'EUR', gross: num(p.gross), net: p.net == null ? null : num(p.net), unverified: p.verified === false }));
    const s = sumEvents(evs, mode, convert);
    s.unverified = evs.filter((e) => e.unverified).length;
    return s;
  }

  /* Évolution vs année précédente (même période de l'année : du 1er janvier à aujourd'hui). */
  function yoy(state, today, mode, convert, filterIds) {
    const y = today.getFullYear();
    const md = pad2(today.getMonth() + 1) + '-' + pad2(today.getDate());
    const cur = receivedBetween(state, y + '-01-01', y + '-' + md, mode, convert, filterIds);
    const prev = receivedBetween(state, (y - 1) + '-01-01', (y - 1) + '-' + md, mode, convert, filterIds);
    if (!prev.count || prev.total <= 0) return { pct: null, cur: cur.total, prev: prev.total, hasPrev: false };
    return { pct: (cur.total - prev.total) / prev.total, cur: cur.total, prev: prev.total, hasPrev: true };
  }

  /* Série mensuelle d'une année : reçu (réel) + à venir (confirmé/prévu), en devise de base. */
  function monthlySeries(state, year, mode, convert, today, filterIds) {
    const evs = buildEvents(state, new Date(year, 0, 1), new Date(year, 11, 31), today, filterIds);
    const received = Array(12).fill(0), upcoming = Array(12).fill(0), unrecorded = Array(12).fill(0);
    evs.forEach((e) => {
      const c = convert(amount(e, mode).v, e.currency); if (c === null) return;
      const m = Number(e.date.slice(5, 7)) - 1;
      if (e.status === 'received') received[m] += c;
      else if (e.status === 'unrecorded') unrecorded[m] += c;
      else upcoming[m] += c;
    });
    return { received, upcoming, unrecorded };
  }

  function yearlySeries(state, mode, convert, filterIds) {
    const years = {};
    (state.payments || []).forEach((p) => {
      if (filterIds && !filterIds.has(p.holdingId)) return;
      const d = p.payDate || p.exDate; if (!d) return;
      const y = d.slice(0, 4);
      const c = convert(amount({ gross: num(p.gross), net: p.net == null ? null : num(p.net) }, mode).v, p.currency || 'EUR');
      if (c === null) return;
      years[y] = (years[y] || 0) + c;
    });
    return Object.keys(years).sort().map((y) => ({ year: Number(y), total: years[y] }));
  }

  /* Prévision des 12 prochains mois (à partir du mois courant). */
  function forecast12(state, mode, convert, today, filterIds) {
    const start = new Date(today.getFullYear(), today.getMonth(), 1);
    const end = new Date(today.getFullYear(), today.getMonth() + 12, 0);
    const evs = buildEvents(state, start, end, today, filterIds).filter((e) => e.status === 'forecast' || e.status === 'confirmed' || e.status === 'received');
    const out = [];
    for (let i = 0; i < 12; i++) {
      const d = new Date(today.getFullYear(), today.getMonth() + i, 1);
      out.push({ year: d.getFullYear(), month: d.getMonth(), value: 0, confirmed: 0 });
    }
    evs.forEach((e) => {
      const c = convert(amount(e, mode).v, e.currency); if (c === null) return;
      const idx = (Number(e.date.slice(0, 4)) - today.getFullYear()) * 12 + Number(e.date.slice(5, 7)) - 1 - today.getMonth();
      if (idx >= 0 && idx < 12) { out[idx].value += c; if (e.status !== 'forecast') out[idx].confirmed += c; }
    });
    return out;
  }

  function nextEvents(state, today, horizonDays, filterIds) {
    const end = new Date(today.getFullYear(), today.getMonth(), today.getDate() + horizonDays);
    const start = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    return buildEvents(state, start, end, today, filterIds).filter((e) => e.status === 'forecast' || e.status === 'confirmed' || (e.status === 'received' && e.date >= toISO(today)));
  }

  /* Répartition du revenu annuel par actif (top N + autres). */
  function distribution(state, mode, convert, filterIds, topN) {
    const r = runRate(state, mode, convert, filterIds);
    const per = r.per.slice().sort((a, b) => b.value - a.value);
    const top = per.slice(0, topN || 8);
    const rest = per.slice(topN || 8).reduce((s, x) => s + x.value, 0);
    return { items: top.concat(rest > 0 ? [{ ticker: 'Autres', name: 'Autres', value: rest }] : []), total: r.total };
  }

  /* Anti-doublon à l'import / à la saisie : un même versement = même actif + même date + même montant. */
  function paymentKey(p) {
    return [p.holdingId || p.ticker, p.payDate || p.exDate || '', Math.round(num(p.gross) * 100)].join('|');
  }

  /* Pré-remplissage de l'historique d'après les dates de détachement passées
     (quantité actuelle supposée) — toujours marqué « à vérifier ». */
  function prefillPayments(state, holdingsList, uid, sinceISO) {
    const existing = new Set((state.payments || []).map(paymentKey));
    const taken = new Set();
    (state.payments || []).forEach((p) => { [p.exDate, p.payDate].forEach((d) => { if (d) taken.add(p.holdingId + '|' + ym(d)); }); });
    const out = [];
    holdingsList.forEach((h) => {
      if (isAccumulating(h)) return;
      ((h.dividend || {}).history || []).forEach((x) => {
        const d = x.payDate || x.exDate;
        if (!d || d < sinceISO || d > toISO(new Date()) || !(num(x.amount) > 0)) return;
        if (taken.has(h.id + '|' + ym(d)) || taken.has(h.id + '|' + ym(x.exDate))) return;
        const qty = quantityAt(state, h, x.exDate || d);
        if (qty <= 0) return;
        const rate = taxRate(h), gross = Math.round(num(x.amount) * qty * 100) / 100;
        const p = { id: uid(), holdingId: h.id, ticker: h.displayTicker || h.ticker, name: h.name || '', exDate: x.exDate || null, payDate: x.payDate || null,
          qty, perShare: x.amount, gross, tax: rate === null ? null : Math.round(gross * rate) / 100,
          net: rate === null ? null : Math.round(gross * (100 - rate)) / 100, fees: null, currency: h.currency || 'EUR', source: 'auto', verified: false };
        if (existing.has(paymentKey(p))) return;
        out.push(p);
      });
    });
    return out;
  }

  root.Engine = {
    TYPES, isAccumulating, isPayer, dividendStatus, annualPerShare, taxRate, invested, costCur, value, portfolioValue, unrealized, yieldOnPrice, quantityAt, positionFromTransactions,
    buildEvents, amount, sumEvents, runRate, yieldOnCost, investedTotal, receivedBetween, yoy, monthlySeries, yearlySeries,
    forecast12, nextEvents, distribution, paymentKey, prefillPayments, toISO, parse, iso
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.Engine;
})(typeof self !== 'undefined' ? self : this);
