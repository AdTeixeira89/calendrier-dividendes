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
