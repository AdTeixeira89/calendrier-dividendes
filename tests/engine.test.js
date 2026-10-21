const assert = require('assert');
const E = require('../engine.js');
const today = new Date(2026, 9, 12); // 12 oct 2026
const conv = (a, c) => c === 'EUR' ? a : c === 'USD' ? a / 1.2 : null;
let n = 0; const t = (name, fn) => { try { fn(); n++; console.log('ok  ', name); } catch (e) { console.log('FAIL', name, '\n   ', e.message); process.exitCode = 1; } };

const mk = (o) => Object.assign({ id: 'h', ticker: 'T', displayTicker: 'T', name: 'T', type: 'stock', currency: 'EUR', quantity: 10, avgCost: 50,
  account: 'a', dividend: { lastAmount: 1, anchorMonth: 2, frequency: 'quarterly', dateKind: 'ex' } }, o);
const st = (holdings, payments, transactions) => ({ holdings, payments: payments || [], transactions: transactions || [] });

t('annual per share = last amount × 12/step', () => assert.strictEqual(E.annualPerShare(mk({})), 4));
t('accumulating ETF never forecast', () => { const h = mk({ type: 'etf_acc' }); assert.strictEqual(E.isPayer(h), false); assert.strictEqual(E.buildEvents(st([h]), new Date(2026,0,1), new Date(2026,11,31), today).length, 0); });
t('"none" asset never forecast', () => { const h = mk({ dividend: { none: true, lastAmount: 2, anchorMonth: 1, frequency: 'annual' } }); assert.strictEqual(E.isPayer(h), false); });
t('quarterly pattern yields 4 events/year, future ones are forecast', () => {
  const ev = E.buildEvents(st([mk({})]), new Date(2026,0,1), new Date(2026,11,31), today);
  assert.strictEqual(ev.length, 4);
  assert.deepStrictEqual(ev.map(e => e.status), ['unrecorded','unrecorded','unrecorded','forecast'].map((s,i)=> ev[i].date < '2026-10-12' ? 'unrecorded' : 'forecast'));
  const nov = ev.find(e => e.date.startsWith('2026-11')); assert.strictEqual(nov.status, 'forecast'); assert.strictEqual(nov.gross, 10); assert.strictEqual(nov.dateKind, 'ex');
});
t('received payment replaces forecast of same month (no double count)', () => {
  const p = { id: 'p1', holdingId: 'h', ticker: 'T', exDate: '2026-10-28', payDate: '2026-11-04', qty: 10, perShare: 1, gross: 10, tax: 3, net: 7, currency: 'EUR', source: 'manual' };
  const ev = E.buildEvents(st([mk({})], [p]), new Date(2026,10,1), new Date(2026,10,30), today);
  assert.strictEqual(ev.length, 1); assert.strictEqual(ev[0].status, 'received'); assert.strictEqual(ev[0].net, 7);
  // forecast anchored on ex-month (Feb/May/Aug/Nov) AND payment's exDate month (Oct): both suppressed
  const ev2 = E.buildEvents(st([mk({ dividend: { lastAmount: 1, anchorMonth: 10, frequency: 'quarterly', dateKind: 'ex' } })], [p]), new Date(2026,9,1), new Date(2026,10,30), today);
  assert.strictEqual(ev2.filter(e => e.status !== 'received').length, 0);
});
t('unrecorded limited to last 13 months and after addedAt', () => {
  const h = mk({ addedAt: '2026-06-01', dividend: { lastAmount: 1, anchorMonth: 1, frequency: 'monthly', dateKind: 'pay' } });
  const ev = E.buildEvents(st([h]), new Date(2025,0,1), new Date(2026,9,31), today);
  assert.ok(ev.every(e => e.date >= '2026-06-01'), 'nothing before addedAt');
});
t('run rate and yield on cost use quantity and cost', () => {
  const s = st([mk({}), mk({ id: 'h2', ticker: 'B', displayTicker: 'B', avgCost: null, quantity: 5 })]);
  assert.strictEqual(E.runRate(s, 'gross', conv).total, 40 + 20);
  const y = E.yieldOnCost(s, conv); assert.strictEqual(y.withCost, 1); assert.strictEqual(y.payers, 2); assert.ok(Math.abs(y.rate - 40/500) < 1e-9);
});
t('currency conversion + missing currency reported', () => {
  const s = st([mk({ currency: 'USD' }), mk({ id: 'x', currency: 'CHF' })]);
  const r = E.runRate(s, 'gross', conv); assert.ok(Math.abs(r.total - 40/1.2) < 1e-9); assert.deepStrictEqual(r.missing, ['CHF']);
});
t('net mode uses tax rate, falls back to gross and says so', () => {
  const s = st([mk({ dividend: { lastAmount: 1, anchorMonth: 2, frequency: 'quarterly', taxRate: 30 } }), mk({ id: 'h2' })]);
  const r = E.runRate(s, 'net', conv); assert.ok(Math.abs(r.total - (28 + 40)) < 1e-9); assert.strictEqual(r.fallbacks, 1);
});
t('received sum, year-to-date and yoy', () => {
  const pay = (id, d, g) => ({ id, holdingId: 'h', ticker: 'T', payDate: d, qty: 10, gross: g, net: g * 0.7, currency: 'EUR' });
  const s = st([mk({})], [pay('a', '2026-03-10', 100), pay('b', '2026-09-10', 50), pay('c', '2025-03-10', 100), pay('d', '2025-12-10', 999)]);
  const y = E.yoy(s, today, 'gross', conv); assert.strictEqual(y.cur, 150); assert.strictEqual(y.prev, 100); assert.ok(Math.abs(y.pct - 0.5) < 1e-9);
  assert.strictEqual(E.yoy(st([mk({})], [pay('a','2026-03-10',100)]), today, 'gross', conv).hasPrev, false);
});
t('quantityAt uses transactions only when consistent', () => {
  const h = mk({ quantity: 15 });
  const tx = [{ holdingId: 'h', type: 'buy', qty: 10, date: '2025-01-01' }, { holdingId: 'h', type: 'buy', qty: 5, date: '2026-05-01' }];
  assert.strictEqual(E.quantityAt(st([h], [], tx), h, '2025-06-01'), 10);
  assert.strictEqual(E.quantityAt(st([h], [], tx.slice(0,1)), h, '2025-06-01'), 15); // incohérent → quantité actuelle
});
t('position & weighted average cost from transactions', () => {
  const r = E.positionFromTransactions([{ type: 'buy', qty: 10, price: 10, fees: 0, date: '2025-01-01' }, { type: 'buy', qty: 10, price: 20, fees: 0, date: '2025-02-01' }, { type: 'sell', qty: 5, price: 30, date: '2025-03-01' }]);
  assert.strictEqual(r.quantity, 15); assert.strictEqual(r.avgCost, 15);
});
t('monthly series splits received / upcoming / unrecorded', () => {
  const p = { id: 'p', holdingId: 'h', ticker: 'T', payDate: '2026-02-15', qty: 10, gross: 10, net: 10, currency: 'EUR' };
  const m = E.monthlySeries(st([mk({})], [p]), 2026, 'gross', conv, today);
  assert.strictEqual(m.received[1], 10); assert.strictEqual(m.upcoming[10], 10); assert.strictEqual(m.unrecorded[4], 10); assert.strictEqual(m.upcoming[1], 0);
});
t('forecast12 spans 12 months from current month', () => {
  const f = E.forecast12(st([mk({})]), 'gross', conv, today);
  assert.strictEqual(f.length, 12); assert.strictEqual(f[0].month, 9); assert.strictEqual(f.reduce((s, x) => s + x.value, 0), 40);
});
t('prefill creates unverified payments, no duplicates', () => {
  const h = mk({ dividend: { lastAmount: 1, anchorMonth: 2, frequency: 'quarterly', history: [{ exDate: '2026-05-10', amount: 1 }, { exDate: '2026-08-10', amount: 1 }] } });
  const s = st([h]); let i = 0; const out = E.prefillPayments(s, [h], () => 'id' + (++i), '2026-01-01');
  assert.strictEqual(out.length, 2); assert.ok(out.every(p => p.verified === false && p.source === 'auto'));
  s.payments = out; assert.strictEqual(E.prefillPayments(s, [h], () => 'z', '2026-01-01').length, 0);
});
t('distribution groups the tail into "Autres"', () => {
  const hs = Array.from({ length: 12 }, (_, i) => mk({ id: 'h' + i, ticker: 'T' + i, displayTicker: 'T' + i, quantity: i + 1 }));
  const d = E.distribution(st(hs), 'gross', conv, null, 8); assert.strictEqual(d.items.length, 9); assert.strictEqual(d.items[8].ticker, 'Autres');
});
console.log(n + ' tests passed');
// ---- cours, valeur, plus-value ----
(() => {
  const t2 = (name, fn) => { try { fn(); console.log('ok  ', name); } catch (e) { console.log('FAIL', name, '\n   ', e.message); process.exitCode = 1; } };
  const cv = (a, c) => c === 'EUR' ? a : c === 'USD' ? a / 1.2 : null;
  const mk2 = (o) => Object.assign({ id: 'h', ticker: 'T', type: 'stock', currency: 'EUR', quantity: 10, avgCost: 50, price: 60, dividend: { lastAmount: 1, anchorMonth: 2, frequency: 'quarterly' } }, o);
  t2('valeur, plus-value et rendement sur cours', () => {
    const s = { holdings: [mk2({}), mk2({ id: 'b', price: null }), mk2({ id: 'c', avgCost: null, price: 100 })] };
    assert.strictEqual(E.value(s.holdings[0]), 600);
    const pv = E.portfolioValue(s, cv, null); assert.strictEqual(pv.total, 1600); assert.strictEqual(pv.count, 2); assert.strictEqual(pv.of, 3);
    const u = E.unrealized(s, cv, null); assert.strictEqual(u.gain, 100); assert.strictEqual(u.count, 1); assert.ok(Math.abs(u.pct - 0.2) < 1e-9);   // c exclu : pas de PRU
    const y = E.yieldOnPrice(s, cv, null); assert.ok(Math.abs(y.rate - (40 + 40) / 1600) < 1e-9); assert.strictEqual(y.count, 2);
  });
  t2('PRU dans une autre devise que l\'actif (action USD, PRU en EUR)', () => {
    const h = mk2({ currency: 'USD', costCurrency: 'EUR', price: 120, avgCost: 90, quantity: 10 });   // valeur 1200 USD = 1000 EUR ; coût 900 EUR
    const u = E.unrealized({ holdings: [h] }, cv, null); assert.ok(Math.abs(u.gain - 100) < 1e-9, 'gain = ' + u.gain);
    assert.strictEqual(E.investedTotal({ holdings: [h] }, cv, null).cost, 900);
  });
})();
// ---- créneaux (acompte + solde), versements vérifiés / à vérifier ----
(() => {
  const t3 = (name, fn) => { try { fn(); console.log('ok  ', name); } catch (e) { console.log('FAIL', name, '\n   ', e.message); process.exitCode = 1; } };
  const cv3 = (a, c) => (c === 'EUR' ? a : null);
  const nov = { id: 'n', ticker: 'NOVO-B.CO', type: 'stock', currency: 'EUR', quantity: 10, dividend: { lastAmount: 3.75, anchorMonth: 8, frequency: 'semiannual', dateKind: 'ex', slots: [{ month: 3, amount: 7.95 }, { month: 8, amount: 3.75 }] } };
  t3('créneaux : l\'estimation annuelle additionne acompte + solde (11,70 et non 2 × 3,75)', () => {
    assert.ok(Math.abs(E.annualPerShare(nov) - 11.7) < 1e-9);
    assert.ok(Math.abs(E.runRate({ holdings: [nov] }, 'gross', cv3, null).total - 117) < 1e-9);
    const evs = E.buildEvents({ holdings: [nov], payments: [] }, new Date(2027, 0, 1), new Date(2027, 11, 31), new Date(2026, 9, 14));
    assert.deepStrictEqual(evs.map((e) => [e.date.slice(5, 7), e.gross]), [['03', 79.5], ['08', 37.5]]);
  });
  t3('sans créneaux : comportement inchangé (dernier montant × fréquence)', () => {
    const h = Object.assign({}, nov, { dividend: { lastAmount: 3.75, anchorMonth: 8, frequency: 'semiannual' } });
    assert.ok(Math.abs(E.annualPerShare(h) - 7.5) < 1e-9);
  });
  const pays = [
    { id: 'a', holdingId: 'n', payDate: '2026-03-10', qty: 10, gross: 100, net: null, currency: 'EUR', verified: true },
    { id: 'b', holdingId: 'n', payDate: '2026-05-10', qty: 10, gross: 40, net: null, currency: 'EUR', verified: false },
    { id: 'c', holdingId: 'n', payDate: '2026-06-10', qty: 10, gross: 10, net: null, currency: 'EUR', verified: false }];
  t3('« reçus » : les versements vérifiés sont séparés de ceux générés d\'après l\'historique', () => {
    const r = E.receivedBetween({ holdings: [nov], payments: pays }, '2026-01-01', '2026-10-14', 'gross', cv3, null);
    assert.strictEqual(r.total, 150); assert.strictEqual(r.verified.total, 100); assert.strictEqual(r.unverifiedSum.total, 50); assert.strictEqual(r.unverified, 2);
    const m = E.monthlySeries({ holdings: [nov], payments: pays }, 2026, 'gross', cv3, new Date(2026, 9, 14), null);
    assert.strictEqual(m.received[2], 100); assert.strictEqual(m.unverified[4], 40); assert.strictEqual(m.unverified[5], 10); assert.strictEqual(m.received[4], 0);
    const y = E.yearlySeries({ holdings: [nov], payments: pays }, 'gross', cv3, null); assert.deepStrictEqual([y[0].verified, y[0].unverified], [100, 50]);
  });
})();
// ---- valeur dans le temps, performance, répartition ----
(() => {
  const t4 = (name, fn) => { try { fn(); console.log('ok  ', name); } catch (e) { console.log('FAIL', name, '\n   ', e.message); process.exitCode = 1; } };
  const today = new Date(2026, 9, 14);
  const cvA = (a, c) => (c === 'EUR' ? a : c === 'USD' ? a / 1.2 : null);
  const cvAt = (a, c, ym) => (c === 'EUR' ? a : c === 'USD' ? a / (ym < '2026-06' ? 1.0 : 1.2) : null);
  const hh = (id, o) => Object.assign({ id, ticker: id, type: 'stock', currency: 'EUR', quantity: 10, avgCost: 50, price: 60, hist: { from: '2026-05', c: [40, 45, 50, 55, 58, 60] }, account: 'a', dividend: { lastAmount: 1, anchorMonth: 2, frequency: 'quarterly' } }, o || {});
  t4('valeur mensuelle : quantités actuelles (rétrospectif), dernier point = cours actuel, devise historique', () => {
    const s = { holdings: [hh('a'), hh('b', { currency: 'USD', hist: { from: '2026-05', c: [100, 100, 100, 100, 100, 100] }, price: 120, quantity: 1 })], transactions: [] };
    const v = E.valueSeries(s, cvAt, { months: 12, today });
    assert.strictEqual(v.retro, true); assert.strictEqual(v.points.length, 6); assert.strictEqual(v.points[0].ym, '2026-05');
    assert.ok(Math.abs(v.points[0].value - (400 + 100 / 1.0)) < 1e-9, 'mai : 400 + 100 USD au taux de mai : ' + v.points[0].value);
    assert.ok(Math.abs(v.points[5].value - (600 + 120 / 1.2)) < 1e-9, 'octobre = cours actuel : ' + v.points[5].value);
    assert.deepStrictEqual(v.coverage, { have: 2, total: 2, missing: [] });
  });
  t4('valeur mensuelle : les actifs sans historique sont signalés, jamais inventés ; les opérations pilotent les quantités', () => {
    const s = { holdings: [hh('a'), hh('b', { hist: null })], transactions: [] };
    const v = E.valueSeries(s, cvAt, { months: 3, today }); assert.deepStrictEqual(v.coverage.missing, ['b']); assert.strictEqual(v.points.length, 3);
    const s2 = { holdings: [hh('a', { quantity: 15 })], transactions: [{ holdingId: 'a', type: 'buy', qty: 10, date: '2026-04-01' }, { holdingId: 'a', type: 'buy', qty: 5, date: '2026-09-10' }] };
    const v2 = E.valueSeries(s2, cvAt, { months: 12, today }); assert.strictEqual(v2.retro, false);
    assert.strictEqual(v2.points[0].value, 10 * 40); assert.strictEqual(v2.points[4].value, 15 * 58);   // septembre : 15 titres au cours de septembre
  });
  t4('performance : gain et % par actif et global (PRU), classement', () => {
    const s = { holdings: [hh('a'), hh('b', { price: 40 }), hh('c', { avgCost: null })] };
    const p = E.performance(s, cvA, null);
    assert.strictEqual(p.gain, 100 - 100); assert.strictEqual(p.cost, 1000); assert.strictEqual(p.count, 2);
    assert.strictEqual(p.rows.find((r) => r.id === 'a').pct, 0.2); assert.strictEqual(p.rows.find((r) => r.id === 'c').pct, null, 'sans PRU : pas de performance');
    assert.strictEqual(p.best[0].id, 'a'); assert.strictEqual(p.worst[0].id, 'b'); assert.ok(Math.abs(p.rows.find((r) => r.id === 'a').weight - 600 / 1600) < 1e-9);
  });
  t4('répartition : somme à 100 %, « Autres » regroupe la queue, valeur à défaut investi (compté à part), exclusions signalées', () => {
    const hs = Array.from({ length: 12 }, (_, i) => hh('h' + i, { sector: 'S' + (i % 10), quantity: i + 1 }));
    hs.push(hh('np', { price: null, hist: null, sector: 'S1' }));      // sans cours : investi
    hs.push(hh('nz', { price: null, avgCost: null, hist: null }));      // sans rien : exclu
    const a = E.allocation({ holdings: hs }, (h) => h.sector, 'value', cvA, null, 5);
    assert.strictEqual(a.items.length, 6); assert.strictEqual(a.items[5].key, 'Autres'); assert.ok(Math.abs(a.items.reduce((s, x) => s + x.pct, 0) - 1) < 1e-9);
    assert.strictEqual(a.fallback, 1); assert.strictEqual(a.excluded, 1);
    assert.strictEqual(E.allocation({ holdings: hs }, (h) => h.sector || 'Non renseigné', 'dividend', cvA, null, 5).excluded, 0 + 2 - 2 + (hs.filter((h) => !E.isPayer(h)).length));
  });
})();

/* ---------- historique reconstitué : opérations × cours historiques ---------- */
(function () {
  const cvAt = (a, c) => (c === 'EUR' ? a : c === 'USD' ? a / 1.25 : null);       // 1 EUR = 1,25 USD
  const td = new Date(2026, 9, 14);                                                // 14 oct 2026
  const monthly = (from, c) => ({ from, c });
  const daily = (days, start) => { const t = [], c = []; const d0 = new Date(2026, 6, 1); for (let i = 0; i < days; i++) { const d = new Date(d0.getTime() + i * 86400000); if (d.getDay() === 0 || d.getDay() === 6) continue; t.push(d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate()); c.push(start + t.length); } return { t, c }; };
  const hh = (id, o) => Object.assign({ id, ticker: id, displayTicker: id, name: id.toUpperCase(), type: 'stock', currency: 'EUR', quantity: 0, avgCost: null, account: 'a', dividend: {} }, o);
  const tx = (id, h, date, type, qty, price, amt) => ({ id, holdingId: h, date, type, qty, price, fees: 0, currency: 'EUR', amountAcct: amt === undefined ? qty * price : amt, acctCur: 'EUR', source: 'degiro' });
  // A : achetée en janvier 2026, 10 × 100 ; B : achetée puis soldée (archive) ; cours mensuels 2025-12 → 2026-10
  const mA = monthly('2025-12', [100, 100, 110, 120, 130, 120, 140, 150, 160, 170]);
  const A = hh('a', { quantity: 10, avgCost: 100, price: 175, hist: Object.assign(monthly('2025-12', mA.c), {}) });
  const B = hh('b', { hist: monthly('2025-12', [50, 50, 55, 60, 65, 60, 70, 75, 80, 85]) });
  const s = { holdings: [A], archive: [B], payments: [], transactions: [tx('1', 'a', '2026-01-15', 'buy', 10, 100), tx('2', 'b', '2026-01-20', 'buy', 20, 50), tx('3', 'b', '2026-05-10', 'sell', 20, 65, 1300)] };
  t('historique : quantités par date issues des opérations, positions soldées incluses, valeur réelle (pas la somme des achats)', () => {
    const h = E.portfolioHistory(s, cvAt, { months: 0, today: td });
    const at = (d) => h.points.find((p) => p.date === d);
    assert.strictEqual(h.empty, false); assert.strictEqual(h.points[0].value, 0, 'part de zéro avant la première opération');
    assert.strictEqual(at('2026-01-31').value, 10 * 100 + 20 * 50);          // A + B au cours de fin janvier (A = 100, B = 50)
    assert.strictEqual(at('2026-04-30').value, 10 * 130 + 20 * 65);            // B encore détenue
    assert.strictEqual(at('2026-05-31').value, 10 * 120, 'B vendue le 10/05 : plus comptée'); assert.strictEqual(at('2026-10-14').value, 10 * 175, 'aujourd\'hui : dernier cours de l\'actif');
    assert.ok(h.points.every((p) => !p.partial), 'tous les cours connus'); assert.strictEqual(h.retro, false);
  });
  t('historique : coût de revient restant et flux nets (achats = apports, ventes = retraits)', () => {
    const h = E.portfolioHistory(s, cvAt, { months: 0, today: td }), at = (d) => h.points.find((p) => p.date === d);
    assert.strictEqual(at('2026-01-31').cost, 1000 + 1000); assert.strictEqual(at('2026-06-30').cost, 1000, 'B vendue : son coût sort du capital investi');
    assert.strictEqual(h.summary.netFlows, 1000 + 1000 - 1300, 'apports nets = achats − ventes'); assert.strictEqual(h.summary.startValue, 0);
  });
  t('historique : performance pondérée dans le temps neutralise les apports (un achat ne crée pas de performance)', () => {
    // un actif à cours constant 100 ; achat de 10 puis de 10 de plus : performance nulle
    const C = hh('c', { quantity: 20, price: 100, hist: monthly('2026-01', [100, 100, 100, 100, 100, 100, 100, 100, 100, 100]) });
    const s2 = { holdings: [C], archive: [], payments: [], transactions: [tx('1', 'c', '2026-01-10', 'buy', 10, 100), tx('2', 'c', '2026-06-10', 'buy', 10, 100)] };
    const h = E.portfolioHistory(s2, cvAt, { months: 0, today: td });
    assert.ok(Math.abs(h.perf.pct) < 1e-9, 'performance nulle malgré le doublement du capital : ' + h.perf.pct); assert.ok(h.points[h.points.length - 1].value === 2000);
    // cours +10 % sur la période avec un apport au milieu : la performance reflète le marché, pas l'apport
    const D = hh('d', { quantity: 20, price: 110, hist: monthly('2026-01', [100, 100, 100, 100, 100, 100, 100, 105, 108, 110]) });
    const s3 = { holdings: [D], archive: [], payments: [], transactions: [tx('1', 'd', '2026-01-10', 'buy', 10, 100), tx('2', 'd', '2026-06-10', 'buy', 10, 100)] };
    const h3 = E.portfolioHistory(s3, cvAt, { months: 0, today: td }); assert.ok(h3.perf.pct > 0.09 && h3.perf.pct < 0.111, 'environ +10 % : ' + h3.perf.pct);
  });
  t('historique : cours manquant = point partiel signalé, jamais de cours inventé ni de valeur « au prix d\'achat »', () => {
    const X = hh('x', { quantity: 5, price: 20, hist: monthly('2026-06', [10, 11, 12, 13, 14]) });        // cours seulement depuis juin 2026
    const s2 = { holdings: [X], archive: [], payments: [], transactions: [tx('1', 'x', '2026-02-01', 'buy', 5, 9)] };
    const h = E.portfolioHistory(s2, cvAt, { months: 0, today: td }), p = h.points.find((q) => q.date === '2026-03-31');
    assert.strictEqual(p.partial, true); assert.strictEqual(p.value, 0); assert.deepStrictEqual(p.missing, ['X']); assert.strictEqual(h.coverage.missing[0].name, 'X');
    assert.strictEqual(h.points.find((q) => q.date === '2026-07-31').partial, false); assert.strictEqual(h.perf.from >= '2026-06-30', true, 'performance seulement sur la partie entièrement valorisée');
    const noHist = hh('n', { quantity: 5, price: 20, hist: null }); const h2 = E.portfolioHistory({ holdings: [noHist], archive: [], payments: [], transactions: [] }, cvAt, { months: 12, today: td });
    assert.ok(h2.points.every((q) => q.partial || q.value === 100)); assert.ok(h2.coverage.missing.length === 1);
  });
  t('historique : devises converties au taux de la date (jamais au taux du jour pour le passé)', () => {
    const U = hh('u', { currency: 'USD', quantity: 10, price: 125, hist: monthly('2026-01', [100, 100, 100, 100, 100, 100, 100, 100, 100, 125]) });
    const cvHist = (a, c, ymm) => (c === 'EUR' ? a : c === 'USD' ? a / (ymm < '2026-06' ? 1 : 1.25) : null);        // EUR/USD 1,00 jusqu'en mai puis 1,25
    const s2 = { holdings: [U], archive: [], payments: [], transactions: [tx('1', 'u', '2026-01-10', 'buy', 10, 100, 1000)] };
    const h = E.portfolioHistory(s2, cvHist, { months: 0, today: td }), at = (d) => h.points.find((p) => p.date === d);
    assert.strictEqual(at('2026-03-31').value, 1000); assert.strictEqual(at('2026-07-31').value, 800);
  });
  t('historique : actif sans opérations cohérentes = quantité actuelle appliquée au passé (rétrospectif signalé)', () => {
    const R = hh('r', { quantity: 10, price: 50, hist: monthly('2026-01', [40, 40, 40, 40, 40, 40, 40, 40, 40, 50]) });
    const h = E.portfolioHistory({ holdings: [R], archive: [], payments: [], transactions: [] }, cvAt, { months: 6, today: td });
    assert.strictEqual(h.retro, true); assert.deepStrictEqual(h.coverage.retro, ['R']); assert.strictEqual(h.points[0].value, 400); assert.strictEqual(h.points[0].cost, null);
  });
  t('historique : séances quotidiennes sur les derniers mois, fins de mois avant', () => {
    const Dd = hh('dd', { quantity: 10, price: 200, hist: Object.assign(monthly('2026-01', [100, 110, 120, 130, 140, 150, 160, 170, 180, 190]), { d: daily(90, 150) }) });
    const h1 = E.portfolioHistory({ holdings: [Dd], archive: [], payments: [], transactions: [] }, cvAt, { months: 1, today: td });
    assert.ok(h1.points.length >= 10, 'au moins ~10 séances sur 1 mois : ' + h1.points.length); assert.strictEqual(h1.coverage.noDaily, false);
    const hAll = E.portfolioHistory({ holdings: [Dd], archive: [], payments: [], transactions: [] }, cvAt, { months: 12, today: td }); assert.ok(hAll.points.length > h1.points.length);
    const noD = hh('nd', { quantity: 10, price: 200, hist: monthly('2026-01', [100, 110, 120, 130, 140, 150, 160, 170, 180, 190]) });
    const h2 = E.portfolioHistory({ holdings: [noD], archive: [], payments: [], transactions: [] }, cvAt, { months: 3, today: td }); assert.strictEqual(h2.coverage.noDaily, true);
  });
  t('historique : fractionnement (10 pour 1) — les anciennes quantités sont ramenées à la base actuelle', () => {
    const S = hh('s', { quantity: 50, price: 100, splits: [{ date: '2026-06-10', ratio: 10 }], hist: monthly('2026-01', [40, 40, 40, 40, 40, 100, 100, 100, 100, 100]) });  // cours déjà ajustés (÷10 avant le split)
    const s2 = { holdings: [S], archive: [], payments: [], transactions: [tx('1', 's', '2026-02-01', 'buy', 5, 400)] };
    const h = E.portfolioHistory(s2, cvAt, { months: 0, today: td }), at = (d) => h.points.find((p) => p.date === d);
    assert.strictEqual(h.retro, false, '5 × 10 = 50 : opérations cohérentes avec la position actuelle'); assert.strictEqual(at('2026-03-31').value, 50 * 40, 'valeur avant split = 2 000 (5 titres × 400), pas 200');
  });
})();

/* ---------- catégorie, variation journalière, TRI ---------- */
(function () {
  const hh = (o) => Object.assign({ id: 'h', ticker: 'T', name: 'T', type: 'stock', currency: 'EUR', quantity: 10, avgCost: 50, dividend: {} }, o);
  t('catégorie : ETF / action / à classer — jamais « action » par défaut sans indice ; choix manuel prioritaire', () => {
    assert.strictEqual(E.category(hh({})), 'unknown'); assert.strictEqual(E.category(hh({ instrumentType: 'EQUITY' })), 'stock'); assert.strictEqual(E.category(hh({ instrumentType: 'ETF' })), 'etf');
    assert.strictEqual(E.category(hh({ name: 'iShares Core MSCI World UCITS ETF' })), 'etf'); assert.strictEqual(E.category(hh({ name: 'MSCI Inc' })), 'unknown', 'une société nommée MSCI n\'est pas un ETF');
    assert.strictEqual(E.category(hh({ type: 'etf_acc' })), 'etf'); assert.strictEqual(E.category(hh({ instrumentType: 'ETF', type: 'stock', typeLocked: true })), 'stock', 'choix manuel prioritaire');
    assert.strictEqual(E.category(hh({ typeSource: 'user', type: 'etf_dist', instrumentType: 'EQUITY' })), 'etf');
  });
  t('variation journalière : quantités détenues à la clôture précédente ; l\'achat du jour et les actifs sans clôture ne comptent pas', () => {
    const a = hh({ id: 'a', quantity: 10, price: 120, prevClose: 118, prevCloseAt: '2026-10-13' }), b = hh({ id: 'b', quantity: 5, price: 50, prevClose: 40, prevCloseAt: '2026-10-13' }), c = hh({ id: 'c', price: 10, prevClose: null });
    const tx = [{ id: '1', holdingId: 'b', date: '2026-10-14', type: 'buy', qty: 5, price: 50, fees: 0, currency: 'EUR' }, { id: '2', holdingId: 'a', date: '2020-01-01', type: 'buy', qty: 10, price: 100, fees: 0, currency: 'EUR' }];
    const d = E.dailyChange({ holdings: [a, b, c], transactions: tx }, (x) => x, null, '2026-10-14');
    assert.strictEqual(d.amount, 20); assert.strictEqual(d.count, 2); assert.deepStrictEqual(d.missing, ['T']); assert.ok(Math.abs(d.pct - 20 / 1180) < 1e-12, 'achat du jour de b : quantité à la clôture précédente = 0');
  });
  t('TRI (XIRR) : rendement annualisé pondéré par les flux ; « données insuffisantes » sans historique d\'un an, avec positions rétrospectives ou cours manquants', () => {
    const mkHist = (flows, last, partial, allTx) => ({ empty: false, allTx: allTx !== false, flows, points: [{ date: '2024-01-01', value: 0, partial: false }, { date: '2026-01-01', value: last, partial: !!partial }], coverage: { retro: [] } });
    const ref = new Date(2026, 0, 1);
    const r = E.xirr(mkHist([{ date: '2024-01-01', f: 1000 }], 1210), ref); assert.ok(Math.abs(r.rate - 0.1) < 2e-3, '1 000 € → 1 210 € en 2 ans = 10 %/an (pas 21 %/2) : ' + r.rate);
    const r2 = E.xirr(mkHist([{ date: '2024-01-01', f: 1000 }, { date: '2025-01-01', f: 1000 }], 2310), ref); assert.ok(Math.abs(r2.rate - 0.1) < 3e-3, 'apport en cours de route : ' + r2.rate);
    const r3 = E.xirr(mkHist([{ date: '2024-01-01', f: 1000 }, { date: '2025-01-01', f: -500 }], 600), ref); assert.ok(r3.rate !== null && r3.rate > 0 && r3.rate < 0.2, 'retrait : ' + r3.rate);
    assert.strictEqual(E.xirr(mkHist([{ date: '2025-09-01', f: 1000 }], 1100), ref).rate, null); assert.ok(/un an/.test(E.xirr(mkHist([{ date: '2025-09-01', f: 1000 }], 1100), ref).reason));
    assert.strictEqual(E.xirr(mkHist([{ date: '2024-01-01', f: 1000 }], 1100, true), ref).rate, null); assert.strictEqual(E.xirr(mkHist([{ date: '2024-01-01', f: 1000 }], 1100, false, false), ref).rate, null);
  });
  t('TRI (XIRR) sur les seules positions exploitables : positions rétrospectives ou sans cours exclues et comptées à part, jamais inventées', () => {
    const cvAt = (a, c) => a; const td2 = new Date(2026, 9, 14);
    const hh2 = (id, o) => Object.assign({ id, ticker: id, displayTicker: id, name: id.toUpperCase(), type: 'stock', currency: 'EUR', quantity: 0, avgCost: null, account: 'a', dividend: {} }, o);
    const mk = (id, date, type, qty, price) => ({ id: id + date, holdingId: id, date, type, qty, price, fees: 0, currency: 'EUR', amountAcct: qty * price, acctCur: 'EUR', source: 'degiro' });
    // A : achetée il y a plus de 2 ans, cours ×1,21 ; B : sans opérations (rétrospective) ; C : avec opérations mais sans cours aujourd'hui
    const A = hh2('a', { quantity: 10, price: 121, hist: { from: '2024-09', c: [100, 110, 115, 121] } }), B = hh2('b', { quantity: 5, price: 50, hist: { from: '2026-01', c: [50, 50] } }), Cc = hh2('c', { quantity: 3, price: 0 });
    const s = { holdings: [A, B, Cc], archive: [], payments: [], transactions: [mk('a', '2024-09-10', 'buy', 10, 100), mk('c', '2025-01-10', 'buy', 3, 10)] };
    const h = E.portfolioHistory(s, cvAt, { months: 0, today: td2 }), x = E.xirr(h, td2);
    assert.ok(x.rate !== null && x.scope, 'calculé sur le sous-ensemble : ' + JSON.stringify(x)); assert.deepStrictEqual([x.scope.held, x.scope.total], [1, 3]); assert.ok(x.scope.excluded.includes('B') && x.scope.excluded.includes('C'), 'exclues : ' + x.scope.excluded);
    assert.ok(x.rate > 0.05 && x.rate < 0.15, '1 000 € → 1 210 € en ~2 ans ≈ 10 %/an : ' + x.rate);
    const s2 = { holdings: [B], archive: [], payments: [], transactions: [] }; assert.strictEqual(E.xirr(E.portfolioHistory(s2, cvAt, { months: 0, today: td2 }), td2).rate, null, 'aucune opération : données insuffisantes');
  });
  t('RENTABILITÉ DE PÉRIODE : gain = marché + dividendes, apports neutralisés (TWR), périodes tronquées à l\'historique, jamais d\'achat compté comme gain', () => {
    const cvAt = (a) => a, td2 = new Date(2026, 9, 14);
    const c = Array(12).fill(100).concat(Array(12).fill(120), Array(10).fill(132));              // 2024-01 … 2026-10
    const A = { id: 'a', ticker: 'A', displayTicker: 'A', name: 'A', type: 'stock', currency: 'EUR', quantity: 20, price: 132, avgCost: 110, account: 'a', dividend: {}, hist: { from: '2024-01', c } };
    const mk = (date, qty, price) => ({ id: 't' + date, holdingId: 'a', date, type: 'buy', qty, price, fees: 0, currency: 'EUR', amountAcct: qty * price, acctCur: 'EUR', source: 'degiro' });
    const s = { holdings: [A], archive: [], payments: [], transactions: [mk('2024-01-10', 10, 100), mk('2025-06-10', 10, 120)] };
    const all = E.periodReturn(E.portfolioHistory(s, cvAt, { months: 0, today: td2 }), [], td2);
    assert.ok(all.ok); assert.strictEqual(all.V1, 2640); assert.strictEqual(all.netFlows, 2200, 'apports = achats'); assert.ok(Math.abs(all.totalGain - 440) < 1e-6, 'gain = 2 640 − 2 200 : ' + all.totalGain);
    assert.ok(Math.abs(all.pct - 0.32) < 1e-6, '+20 % puis +10 % = +32 % malgré l\'apport de juin 2025 : ' + all.pct); assert.ok(all.annualized !== null && all.annualized > 0.08 && all.annualized < 0.12, 'TRI : ' + all.annualized);
    const y1 = E.periodReturn(E.portfolioHistory(s, cvAt, { months: 12, today: td2 }), [], td2);
    assert.ok(y1.ok && y1.netFlows === 0 && Math.abs(y1.totalGain - 240) < 1e-6 && Math.abs(y1.pct - 0.10) < 1e-6, '12 mois : 2 400 → 2 640 = +10 % : ' + JSON.stringify([y1.from, y1.V0, y1.totalGain, y1.pct]));
    const y5 = E.periodReturn(E.portfolioHistory(s, cvAt, { months: 60, today: td2 }), [], td2, { from: '2021-10-14' });
    assert.ok(y5.ok && Math.abs(y5.pct - 0.32) < 1e-6 && y5.truncated && y5.from < '2024-02-01', '5 ans demandés, historique depuis 2024 : calcul depuis le début effectif, signalé : ' + y5.from);
    const withDiv = E.periodReturn(E.portfolioHistory(s, cvAt, { months: 12, today: td2 }), [{ date: '2026-03-01', v: 50 }, { date: '2020-01-01', v: 999 }], td2);
    assert.ok(Math.abs(withDiv.totalGain - 290) < 1e-6 && withDiv.dividends === 50, 'dividende dans la période seulement : ' + withDiv.totalGain); assert.ok(withDiv.pct > 0.118 && withDiv.pct < 0.123, 'dividende = rendement : ' + withDiv.pct);
    // un apport pur ne crée AUCUNE performance ; une vente n'est pas une perte
    const flat = { holdings: [Object.assign({}, A, { quantity: 20, price: 100, hist: { from: '2024-01', c: Array(34).fill(100) } })], archive: [], payments: [], transactions: [mk('2024-01-10', 10, 100), mk('2025-06-10', 10, 100)] };
    const fr = E.periodReturn(E.portfolioHistory(flat, cvAt, { months: 0, today: td2 }), [], td2); assert.ok(Math.abs(fr.pct) < 1e-9 && Math.abs(fr.totalGain) < 1e-6, 'cours constant : performance nulle malgré 2 000 € versés : ' + fr.pct);
    const sold = { holdings: [Object.assign({}, A, { quantity: 10 })], archive: [], payments: [], transactions: [mk('2024-01-10', 20, 100), Object.assign(mk('2025-06-10', 10, 120), { type: 'sell', amountAcct: 1200 })] };
    const sr = E.periodReturn(E.portfolioHistory(sold, cvAt, { months: 0, today: td2 }), [], td2); assert.ok(sr.sells === 1200 && sr.buys === 2000 && Math.abs(sr.totalGain - (1320 + 1200 - 2000)) < 1e-6, 'gain = valeur 1 320 + vente 1 200 − achats 2 000 = 520 : ' + sr.totalGain);
    assert.strictEqual(E.periodReturn(E.portfolioHistory({ holdings: [], archive: [], payments: [], transactions: [] }, cvAt, { months: 12, today: td2 }), [], td2).ok, false, 'rien à mesurer');
  });
})();
