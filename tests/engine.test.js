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
