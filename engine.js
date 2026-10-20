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

  const Ledger = (typeof require === 'function' && typeof module !== 'undefined' && !root.Ledger) ? require('./ledger.js') : root.Ledger;

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
    const sl = h.dividend.slots;
    if (Array.isArray(sl) && sl.length) return sl.reduce(function (s, x) { return s + num(x.amount); }, 0);
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
    s.verified = sumEvents(evs.filter((e) => !e.unverified), mode, convert);    // versements confirmés par l'utilisateur
    s.unverifiedSum = sumEvents(evs.filter((e) => e.unverified), mode, convert); // générés d'après l'historique de marché
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
    const received = Array(12).fill(0), unverified = Array(12).fill(0), upcoming = Array(12).fill(0), unrecorded = Array(12).fill(0);
    evs.forEach((e) => {
      const c = convert(amount(e, mode).v, e.currency); if (c === null) return;
      const m = Number(e.date.slice(5, 7)) - 1;
      if (e.status === 'received') { if (e.verified === false) unverified[m] += c; else received[m] += c; }
      else if (e.status === 'unrecorded') unrecorded[m] += c;
      else upcoming[m] += c;
    });
    return { received, unverified, upcoming, unrecorded };
  }

  function yearlySeries(state, mode, convert, filterIds) {
    const years = {};
    (state.payments || []).forEach((p) => {
      if (filterIds && !filterIds.has(p.holdingId)) return;
      const d = p.payDate || p.exDate; if (!d) return;
      const y = d.slice(0, 4);
      const c = convert(amount({ gross: num(p.gross), net: p.net == null ? null : num(p.net) }, mode).v, p.currency || 'EUR');
      if (c === null) return;
      years[y] = years[y] || { total: 0, unverified: 0 };
      years[y].total += c; if (p.verified === false) years[y].unverified += c;
    });
    return Object.keys(years).sort().map((y) => ({ year: Number(y), total: years[y].total, unverified: years[y].unverified, verified: years[y].total - years[y].unverified }));
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

  /* ---------- évolution de la valeur dans le temps ---------- */
  const ymOf = (d) => d.getFullYear() + '-' + pad2(d.getMonth() + 1);
  const addYM = (y, n) => { const a = y.split('-').map(Number), t = a[0] * 12 + a[1] - 1 + n; return Math.floor(t / 12) + '-' + pad2((t % 12) + 1); };
  const lastDayOf = (y) => { const a = y.split('-').map(Number); return iso(a[0], a[1], new Date(a[0], a[1], 0).getDate()); };
  function closeAt(h, ym) {
    const hs = h.hist; if (!hs || !hs.c || !hs.c.length) return null;
    const i = (Number(ym.slice(0, 4)) - Number(hs.from.slice(0, 4))) * 12 + Number(ym.slice(5)) - Number(hs.from.slice(5));
    if (i < 0) { for (let k = 0; k < hs.c.length; k++) if (hs.c[k] > 0) return hs.c[k]; return null; }    // avant le début de l'historique : premier cours connu
    for (let k = Math.min(i, hs.c.length - 1); k >= 0; k--) if (hs.c[k] > 0) return hs.c[k];                // mois manquant : dernier cours connu
    return null;
  }
  /* Valeur du portefeuille mois par mois. Sans opérations, les quantités ACTUELLES sont appliquées à tout l'historique
     (« positions actuelles, rétrospectif ») ; avec des opérations cohérentes, les quantités réellement détenues. */
  function valueSeries(state, convertAt, o) {
    o = o || {}; const today = o.today || new Date(), ids = o.ids || null, months = o.months || 12;
    const endYM = ymOf(today);
    const hs = (state.holdings || []).filter((h) => (!ids || ids.has(h.id)) && num(h.quantity) > 0);
    const withHist = hs.filter((h) => h.hist && h.hist.c && h.hist.c.length), missing = hs.filter((h) => !(h.hist && h.hist.c && h.hist.c.length)).map((h) => h.displayTicker || h.ticker);
    if (!withHist.length) return { points: [], coverage: { have: 0, total: hs.length, missing }, retro: true };
    const minFrom = withHist.reduce((m, h) => (h.hist.from < m ? h.hist.from : m), '9999-99');
    const startYM = addYM(endYM, -(months - 1)) > minFrom ? addYM(endYM, -(months - 1)) : minFrom;
    const retro = !withHist.some((h) => (state.transactions || []).some((t) => t.holdingId === h.id && (t.type === 'buy' || t.type === 'sell')));
    const points = [];
    for (let ym = startYM; ym <= endYM; ym = addYM(ym, 1)) {
      let v = 0, n = 0;
      withHist.forEach((h) => {
        const q = retro ? num(h.quantity) : quantityAt(state, h, ym === endYM ? toISO(today) : lastDayOf(ym));
        if (q <= 0) return;
        const close = ym === endYM && h.price > 0 ? h.price : closeAt(h, ym); if (!(close > 0)) return;
        const c = convertAt(q * close, h.currency || 'EUR', ym); if (c === null) return;
        v += c; n++;
      });
      points.push({ ym, value: v, n });
    }
    return { points, coverage: { have: withHist.length, total: hs.length, missing }, retro };
  }


  /* ---------- historique reconstitué du portefeuille (opérations × cours historiques) ----------
     Pour chaque date : quantités détenues (opérations appliquées dans l'ordre, ramenées à la base actuelle des
     fractionnements) × cours de clôture à cette date × taux de change du mois. Jamais de cours inventé :
     un actif sans cours à une date est listé comme manquant et le point est marqué « partiel ».
     Actifs sans opérations cohérentes : quantité ACTUELLE appliquée au passé (rétrospectif, signalé).
     Performance : méthode pondérée dans le temps (Dietz modifié par intervalle) ; achats = apports, ventes = retraits. */
  const dayNum = (iso_) => { const a = iso_.split('-').map(Number); return Date.UTC(a[0], a[1] - 1, a[2]) / 86400000; };
  const isoOfNum = (n) => iso(Math.floor(n / 10000), Math.floor(n / 100) % 100, n % 100);
  const numOfIso = (s) => Number(s.slice(0, 4)) * 10000 + Number(s.slice(5, 7)) * 100 + Number(s.slice(8, 10));
  const dateAddMonths = (d, n) => { const t = new Date(d.getFullYear(), d.getMonth() + n, 1); const last = new Date(t.getFullYear(), t.getMonth() + 1, 0).getDate(); return new Date(t.getFullYear(), t.getMonth(), Math.min(d.getDate(), last)); };

  function priceLookup(inst) {
    const hs = inst.hist, d = hs && hs.d && hs.d.t && hs.d.t.length ? hs.d : null, mo = hs && hs.c && hs.c.length && hs.from ? hs : null;
    const d0 = d ? d.t[0] : null;
    return function (dateISO, live) {
      if (live && inst.price > 0) return inst.price;
      if (d && numOfIso(dateISO) >= d0) {
        const key = numOfIso(dateISO); let lo = 0, hi = d.t.length - 1, best = -1;
        while (lo <= hi) { const mid = (lo + hi) >> 1; if (d.t[mid] <= key) { best = mid; lo = mid + 1; } else hi = mid - 1; }
        return best >= 0 && d.c[best] > 0 ? d.c[best] : null;
      }
      if (mo) {
        const y = dateISO.slice(0, 7), i = (Number(y.slice(0, 4)) - Number(mo.from.slice(0, 4))) * 12 + Number(y.slice(5)) - Number(mo.from.slice(5));
        if (i < 0) return null;                                   // avant le début des données : aucun cours (rien n'est inventé)
        for (let k = Math.min(i, mo.c.length - 1); k >= Math.max(0, i - 2); k--) if (mo.c[k] > 0) return mo.c[k];
      }
      return null;
    };
  }

  const splitAfter = (sp, d) => { let f = 1; (sp || []).forEach((s) => { if (s.date > d) f *= s.ratio; }); return f; };
  function portfolioHistory(state, convertAt, o) {
    o = o || {};
    const today = o.today || new Date(), todayS = toISO(today), ids = o.ids || null, months = o.months === undefined ? 12 : o.months;
    const insts = (state.holdings || []).filter((h) => !ids || ids.has(h.id)).map((h) => ({ kind: 'holding', h }))
      .concat((state.archive || []).filter((a) => !ids || ids.has(a.id)).map((a) => ({ kind: 'archive', h: a })));
    const txAll = (state.transactions || []).filter((t) => (t.type === 'buy' || t.type === 'sell') && t.date);
    const byInst = {}; txAll.forEach((t) => { (byInst[t.holdingId] = byInst[t.holdingId] || []).push(t); });
    const sortTx = (a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : (a.time || '') < (b.time || '') ? -1 : (a.time || '') > (b.time || '') ? 1 : 0);

    const list = []; const coverage = { total: 0, missing: [], retro: [], noDaily: false };
    insts.forEach((it) => {
      const h = it.h, txs = (byInst[h.id] || []).slice().sort(sortTx), isin = Ledger ? Ledger.holdingIsin(h) : '';
      const sign = (t) => (t.type === 'buy' ? 1 : -1);
      // opérations sur titres VALIDÉES (state.corp) + fractionnements du marché non encore validés : le nombre de titres réellement détenus à chaque date.
      // Les cours Yahoo sont ajustés des splits du MARCHÉ : on ramène donc la quantité à la base actuelle avec ces seuls splits (h.splits).
      const corp = (state.corp || []).filter((c) => c.validated !== false && isin && c.isin === isin), mkt = (h.splits || []).filter((s) => s && s.date && s.ratio > 0);
      const corpSplits = corp.filter((c) => c.kind === 'split'), near = (d1, d2) => Math.abs(Date.parse(d1) - Date.parse(d2)) < 5 * 86400000;
      const mktOnly = mkt.filter((s) => !corpSplits.some((c) => near(c.date, s.date)));
      const toEntries = (withMkt) => txs.map((t) => {
        const cur = t.acctCur || t.currency || 'EUR', raw = t.amountAcct != null ? num(t.amountAcct) : (t.type === 'buy' ? num(t.qty) * num(t.price) + num(t.fees) : num(t.qty) * num(t.price) - num(t.fees));
        const c = convertAt(raw, cur, t.date.slice(0, 7));
        return { date: t.date, time: t.time || '', type: t.corp ? (t.type === 'buy' ? 'grant' : 'retire') : t.type, qty: num(t.qty), amt: t.corp ? 0 : (c === null ? null : c), fees: num(t.fees) };
      }).concat(corp.map((c) => ({ date: c.date, time: '', type: c.kind, qty: 0, ratio: c.ratio, amt: null })), withMkt ? mktOnly.map((s) => ({ date: s.date, time: '', type: 'split', qty: 0, ratio: s.ratio, amt: null })) : []);
      const cq = it.kind === 'holding' ? num(h.quantity) : 0, tol = 1e-6 * Math.max(1, cq);
      let ledgerRows = null, txMode = false;
      if (txs.length && Ledger) {
        const withM = Ledger.run(toEntries(true)), noM = Ledger.run(toEntries(false));
        txMode = it.kind === 'archive' || Math.abs(withM.qty - cq) <= tol || Math.abs(noM.qty - cq) <= tol;
        if (txMode) ledgerRows = Math.abs(withM.qty - cq) <= tol || it.kind === 'archive' ? withM.rows : noM.rows;
      }
      if (!txMode && !(it.kind === 'holding' && cq > 0)) return;               // ni opérations exploitables ni position actuelle
      const name = h.name || h.displayTicker || h.ticker || '—';
      const cumul = ledgerRows ? ledgerRows.map((r) => ({ date: r.date, q: r.qtyAfter })) : [];
      coverage.total++;
      if (!txMode) coverage.retro.push(name);
      list.push({ id: h.id, name, cur: h.currency || 'EUR', kind: it.kind, txMode, cumul, ledgerRows, price: priceLookup(h), live: it.kind === 'holding', hasHist: !!(h.hist && ((h.hist.c && h.hist.c.length) || (h.hist.d && h.hist.d.t.length))), hasDaily: !!(h.hist && h.hist.d && h.hist.d.t && h.hist.d.t.length),
        dailyStart: h.hist && h.hist.d && h.hist.d.t && h.hist.d.t.length ? h.hist.d.t[0] : null, q0: cq, firstTx: txs.length ? txs[0].date : null, histFrom: h.hist && h.hist.from ? h.hist.from + '-01' : null,
        rowsAt: ledgerRows, adjSplits: mkt });
    });
    if (!list.length) return { points: [], coverage, perf: { points: [], from: null }, summary: null, retro: true, empty: true };

    // fenêtre
    const firstTxAll = list.reduce((m, x) => (x.firstTx && x.firstTx < m ? x.firstTx : m), '9999-99-99');
    const histMin = list.reduce((m, x) => (x.histFrom && x.histFrom < m ? x.histFrom : m), '9999-99-99');
    // « Tout l'historique » : on part de la fin du mois précédant la première opération (valeur nulle), pour que les apports initiaux comptent comme flux
    let startD = months > 0 ? toISO(dateAddMonths(today, -months)) : (firstTxAll !== '9999-99-99' ? lastDayOf(addYM(firstTxAll.slice(0, 7), -1)) : histMin);
    if (startD === '9999-99-99') startD = toISO(dateAddMonths(today, -12));
    // dates d'échantillonnage : fins de mois, puis séances quotidiennes si TOUS les actifs utiles ont des cours quotidiens
    const useful = list.filter((x) => x.hasHist), allDaily = useful.length > 0 && useful.every((x) => x.hasDaily);
    coverage.noDaily = !allDaily && useful.length > 0;
    const dailyStart = allDaily ? Math.max.apply(null, useful.map((x) => x.dailyStart)) : null;
    const dates = {};
    const startYM = startD.slice(0, 7), endYM = ymOf(today);
    for (let y = startYM; y < endYM; y = addYM(y, 1)) { const e = lastDayOf(y); if (e >= startD && (!allDaily || numOfIso(e) < dailyStart)) dates[e] = 1; }
    if (allDaily) {
      const set = {};
      // séances : union des dates quotidiennes (≥ début de la fenêtre)
      insts.forEach((it) => { const d = it.h.hist && it.h.hist.d; if (d) d.t.forEach((t) => { if (t >= dailyStart) set[isoOfNum(t)] = 1; }); });
      Object.keys(set).forEach((k) => { if (k >= startD && k <= todayS) dates[k] = 1; });
    }
    dates[todayS] = 1;
    const sample = Object.keys(dates).sort();
    // quantité à une date (pointeurs croissants)
    const ptr = list.map(() => 0);
    const qtyAt = (x, i, d) => { if (!x.txMode) return x.q0; while (ptr[i] < x.cumul.length && x.cumul[ptr[i]].date <= d) ptr[i]++; return ptr[i] ? Math.max(0, x.cumul[ptr[i] - 1].q) : 0; };
    const costAt = (x, d) => { if (!x.txMode || !x.rowsAt) return null; let c = 0; for (let k = 0; k < x.rowsAt.length; k++) { if (x.rowsAt[k].date <= d) c = x.rowsAt[k].costAfter; else break; } return c; };
    const missingEver = {}, lastVals = {};
    const points = sample.map((d) => {
      const live = d === todayS, ymm = d.slice(0, 7);
      let value = 0, cost = 0, costKnown = true, partial = false; const miss = [], parts = [];
      list.forEach((x, i) => {
        const q0 = qtyAt(x, i, d); if (!(q0 > 1e-9)) return;
        const q = q0 * (x.txMode ? splitAfter(x.adjSplits, d) : 1);                // base actuelle des fractionnements du marché (cours ajustés)
        const p = x.price(d, live && x.live), cv = p > 0 ? convertAt(q * p, x.cur, ymm) : null;
        if (d === todayS) lastVals[x.id] = cv;
        if (cv === null) { partial = true; miss.push(x.name); missingEver[x.name] = missingEver[x.name] || { name: x.name, first: d, reason: p > 0 ? 'taux de change indisponible' : (x.hasHist ? 'cours indisponible à cette date' : 'aucun cours historique') }; return; }
        value += cv; parts.push([x.name, cv]);
        const c = costAt(x, d); if (c === null) costKnown = false; else cost += c;
      });
      parts.sort((a, b) => b[1] - a[1]);
      return { date: d, ym: ymm, value, cost: costKnown ? cost : null, partial, missing: miss.slice(0, 6), nMissing: miss.length, parts: parts.slice(0, 4), rest: parts.slice(4).reduce((s, x) => s + x[1], 0) };
    });
    coverage.missing = Object.keys(missingEver).map((k) => missingEver[k]);

    // flux (achats = apports, ventes = retraits), en devise de base au taux du mois d'exécution
    const flows = [];
    list.forEach((x) => { if (!x.txMode || !x.rowsAt) return; x.rowsAt.forEach((r) => { if (r.amt != null) flows.push({ date: r.date, f: (r.type === 'buy' ? 1 : -1) * r.amt }); }); });
    flows.sort((a, b) => (a.date < b.date ? -1 : 1));
    // sous-ensemble pour le rendement annuel (TRI) quand tout n'est pas exploitable : positions avec historique d'opérations cohérent ET valorisées aujourd'hui
    // (+ positions soldées) ; les autres sont exclues des flux ET de la valeur terminale, et comptées à part.
    const xs = { flows: [], endValue: 0, held: 0, total: list.filter((x) => x.live).length, excluded: [] };
    list.forEach((x) => {
      if (!x.live) { if (x.txMode && x.rowsAt) x.rowsAt.forEach((r) => { if (r.amt != null) xs.flows.push({ date: r.date, f: (r.type === 'buy' ? 1 : -1) * r.amt }); }); return; }
      const v = lastVals[x.id];
      if (!x.txMode || !x.rowsAt) { xs.excluded.push(x.name); return; }
      if (v === undefined) { /* position à zéro aujourd'hui : ses flux comptent, valeur terminale nulle */ } else if (v === null) { xs.excluded.push(x.name); return; } else { xs.endValue += v; xs.held++; }
      x.rowsAt.forEach((r) => { if (r.amt != null) xs.flows.push({ date: r.date, f: (r.type === 'buy' ? 1 : -1) * r.amt }); });
    });
    xs.flows.sort((a, b) => (a.date < b.date ? -1 : 1));
    // performance pondérée dans le temps
    const perf = { points: [], from: null, pct: null };
    let lastPartial = -1; points.forEach((p, i) => { if (p.partial) lastPartial = i; });
    const s0 = lastPartial + 1;
    if (s0 < points.length - 1) {
      let idx = 1; perf.from = points[s0].date; perf.points.push({ date: points[s0].date, pct: 0 });
      for (let k = s0 + 1; k < points.length; k++) {
        const d0 = points[k - 1].date, d1 = points[k].date, span = Math.max(1, dayNum(d1) - dayNum(d0));
        let F = 0, W = 0; flows.forEach((f) => { if (f.date > d0 && f.date <= d1) { F += f.f; W += f.f * ((dayNum(d1) - dayNum(f.date)) / span); } });
        const V0 = points[k - 1].value, V1 = points[k].value, den = V0 + W;
        if (den > 1e-9) idx *= 1 + (V1 - V0 - F) / den;
        perf.points.push({ date: d1, pct: idx - 1 });
      }
      perf.pct = perf.points[perf.points.length - 1].pct;
    }
    const first = points[0], last = points[points.length - 1];
    const netFlows = flows.filter((f) => f.date > first.date && f.date <= last.date).reduce((s, f) => s + f.f, 0);
    const summary = { startDate: first.date, endDate: last.date, startValue: first.value, endValue: last.value, netFlows, marketGain: last.value - first.value - netFlows, perfPct: perf.pct, partialStart: first.partial, partialEnd: last.partial,
      investedEnd: last.cost, firstTx: firstTxAll === '9999-99-99' ? null : firstTxAll };
    const retro = list.some((x) => !x.txMode);
    return { points, coverage, perf, summary, retro, empty: false, allTx: list.every((x) => x.txMode), flows, xirrSet: xs };
  }


  /* ---------- catégorie d'un actif : ETF / action / à classer (jamais « action » par défaut sans indice) ---------- */
  const ETF_NAME = /\b(etf|ucits|ishares|lyxor|xtrackers|spdr|wisdomtree|vaneck|etn|amundi (msci|s&p|stoxx|ftse|euro|index|pea|prime)|vanguard (s&p|ftse|msci|total|all-world|funds|global|ftse))\b/i;
  function category(h) {
    if (h.typeLocked || h.typeSource === 'user') return h.type === 'etf_dist' || h.type === 'etf_acc' ? 'etf' : 'stock';
    if (h.type === 'etf_dist' || h.type === 'etf_acc') return 'etf';
    const it = String(h.instrumentType || '').toUpperCase();
    if (it === 'ETF' || it === 'MUTUALFUND') return 'etf';
    if (it === 'EQUITY') return 'stock';
    if (ETF_NAME.test(h.name || '')) return 'etf';
    return 'unknown';
  }

  /* ---------- variation journalière : mouvement de marché de la dernière séance sur les quantités détenues à la clôture précédente
     (un achat ou une vente du jour, un dépôt ou un retrait n'y comptent pas) ---------- */
  function dailyChange(state, convert, ids, todayISO) {
    let amount = 0, base = 0, cnt = 0, total = 0, asOf = null; const missing = [];
    (state.holdings || []).forEach((h) => {
      if (ids && !ids.has(h.id)) return;
      if (!(num(h.quantity) > 0) || !(h.price > 0)) return;
      total++;
      if (!(h.prevClose > 0) || !h.prevCloseAt) { missing.push(h.name || h.displayTicker || h.ticker); return; }
      const q = quantityAt(state, h, h.prevCloseAt), a = convert(q * (h.price - h.prevClose), h.currency || 'EUR'), b = convert(q * h.prevClose, h.currency || 'EUR');
      if (a === null || b === null) { missing.push(h.name || h.displayTicker || h.ticker); return; }
      amount += a; base += b; cnt++; if (!asOf || h.prevCloseAt > asOf) asOf = h.prevCloseAt;
    });
    return { amount, pct: base > 0 ? amount / base : null, count: cnt, total, missing, prevDate: asOf };
  }

  /* ---------- rendement annualisé pondéré par les flux (TRI / XIRR) ----------
     Flux : chaque achat (−) et chaque vente (+) daté, en devise de base au taux du mois ; valeur terminale = valeur actuelle des positions détenues.
     Dividendes exclus. Calculé seulement si TOUTES les positions détenues ont un historique d'opérations cohérent, sont valorisées, et si l'historique couvre ≥ 1 an. */
  function xirr(hist, today) {
    const fail = (reason) => ({ rate: null, reason });
    if (!hist || hist.empty || !hist.flows || !hist.flows.length) return fail('aucune opération');
    const last = hist.points[hist.points.length - 1];
    const strict = hist.allTx && last && !last.partial;
    let flows0 = hist.flows, endV = last ? last.value : 0, scope = null;
    if (!strict) {                                               // repli : seulement les positions exploitables (historique d'opérations cohérent et cours disponible)
      const xs = hist.xirrSet;
      if (!xs || !xs.flows.length || !xs.held) return fail(!hist.allTx ? 'historique d\'opérations incomplet pour ' + hist.coverage.retro.length + ' position(s)' : 'cours manquants');
      flows0 = xs.flows; endV = xs.endValue; scope = { held: xs.held, total: xs.total, excluded: xs.excluded };
    }
    const flows = flows0.slice().sort((a, b) => (a.date < b.date ? -1 : 1)), t0 = flows[0].date, tN = toISO(today || new Date());
    const day = (d) => { const a = d.split('-').map(Number); return Date.UTC(a[0], a[1] - 1, a[2]) / 86400000; };
    const span = day(tN) - day(t0); if (span < 365) return fail('moins d\'un an d\'historique');
    const cfs = flows.map((f) => ({ t: (day(f.date) - day(t0)) / 365, v: -f.f })).concat([{ t: span / 365, v: endV }]);
    const f = (r) => cfs.reduce((s, c) => s + c.v / Math.pow(1 + r, c.t), 0);
    let lo = -0.95, hi = 10, flo = f(lo), fhi = f(hi);
    if (!isFinite(flo) || !isFinite(fhi) || flo * fhi > 0) return fail('calcul impossible');
    for (let i = 0; i < 200; i++) { const mid = (lo + hi) / 2, fm = f(mid); if (Math.abs(fm) < 1e-9) { lo = hi = mid; break; } if (flo * fm <= 0) { hi = mid; fhi = fm; } else { lo = mid; flo = fm; } }
    return { rate: (lo + hi) / 2, from: t0, years: span / 365, flows: flows.length, scope };
  }

  /* ---------- performance par actif et globale (PRU) ---------- */
  function performance(state, convert, ids) {
    const rows = []; let value = 0, cost = 0, gain = 0, valAll = 0;
    (state.holdings || []).forEach((h) => {
      if (ids && !ids.has(h.id)) return;
      const v = value_(h), inv = invested(h);
      const cv = v === null ? null : convert(v, h.currency || 'EUR'), ci = inv === null ? null : convert(inv, costCur(h));
      if (cv !== null) valAll += cv;
      const g = cv !== null && ci !== null ? cv - ci : null;
      if (g !== null) { value += cv; cost += ci; gain += g; }
      rows.push({ id: h.id, ticker: h.displayTicker || h.ticker, name: h.name || '', value: cv, cost: ci, gain: g, pct: g !== null && ci > 0 ? g / ci : null });
    });
    rows.forEach((r) => { r.weight = r.value !== null && valAll > 0 ? r.value / valAll : null; });
    const ranked = rows.filter((r) => r.pct !== null).sort((a, b) => b.pct - a.pct);
    return { rows, value, cost, gain, pct: cost > 0 ? gain / cost : null, count: ranked.length, valueAll: valAll, best: ranked.slice(0, 3), worst: ranked.slice(-3).reverse().filter((r) => r.pct < 0 || ranked.length > 3) };
  }
  const value_ = (h) => value(h);

  /* ---------- répartition (secteur, pays, devise, type, compte…) ---------- */
  function allocation(state, keyFn, basis, convert, ids, topN) {
    const sums = {}, counts = {}; let total = 0, excluded = 0, fallback = 0;
    (state.holdings || []).forEach((h) => {
      if (ids && !ids.has(h.id)) return;
      let w = null;
      if (basis === 'dividend') { const g = annualPerShare(h) * num(h.quantity); w = g > 0 ? convert(g, h.currency || 'EUR') : null; }
      else if (basis === 'cost') { const i = invested(h); w = i === null ? null : convert(i, costCur(h)); }
      else {                                       // valeur de marché ; à défaut, montant investi (compté à part)
        const v = value_(h); w = v === null ? null : convert(v, h.currency || 'EUR');
        if (w === null) { const i = invested(h); const ci = i === null ? null : convert(i, costCur(h)); if (ci !== null) { w = ci; fallback++; } }
      }
      if (w === null || !(w > 0)) { excluded++; return; }
      const k = keyFn(h) || 'Non renseigné'; sums[k] = (sums[k] || 0) + w; counts[k] = (counts[k] || 0) + 1; total += w;
    });
    const items = Object.keys(sums).map((k) => ({ key: k, value: sums[k], count: counts[k], pct: total > 0 ? sums[k] / total : 0 })).sort((a, b) => b.value - a.value);
    const top = items.slice(0, topN || 8), rest = items.slice(topN || 8);
    if (rest.length) top.push({ key: 'Autres', value: rest.reduce((s, x) => s + x.value, 0), count: rest.reduce((s, x) => s + x.count, 0), pct: rest.reduce((s, x) => s + x.pct, 0), rest: rest.map((x) => x.key) });
    return { items: top, all: items, total, excluded, fallback };
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
    valueSeries, portfolioHistory, category, dailyChange, xirr, performance, allocation, ymOf, addYM, closeAt, TYPES, isAccumulating, isPayer, dividendStatus, annualPerShare, taxRate, invested, costCur, value, portfolioValue, unrealized, yieldOnPrice, quantityAt, positionFromTransactions,
    buildEvents, amount, sumEvents, runRate, yieldOnCost, investedTotal, receivedBetween, yoy, monthlySeries, yearlySeries,
    forecast12, nextEvents, distribution, paymentKey, prefillPayments, toISO, parse, iso
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.Engine;
})(typeof self !== 'undefined' ? self : this);
