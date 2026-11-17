/* Tests de l'audit des positions (phase 0, lecture seule). Lancer : node tests/audit.test.js */
const assert = require('assert');
const A = require('../audit.js');
let failed = 0;
const t = (name, fn) => { try { fn(); console.log('ok   ' + name); } catch (e) { failed++; console.log('FAIL ' + name + '\n   ' + (e && e.message)); } };
const deepFreeze = (o) => { if (o && typeof o === 'object' && !Object.isFrozen(o)) { Object.freeze(o); Object.values(o).forEach(deepFreeze); } return o; };
const tx = (id, hid, date, type, qty, price, fees, extra) => Object.assign({ id, holdingId: hid, date, type, qty, price, fees: fees || 0, currency: 'EUR', amountAcct: type === 'buy' ? qty * price + (fees || 0) : qty * price - (fees || 0), acctCur: 'EUR', source: 'degiro', extId: 'dg:' + id }, extra || {});
const H = (id, o) => Object.assign({ id, name: 'Titre ' + id, isin: 'FR000000000' + id.slice(-1), currency: 'EUR', costCurrency: 'EUR', account: 'a', quantity: 0, avgCost: null }, o || {});
const mk = () => ({
  accounts: [{ id: 'a', name: 'DEGIRO' }],
  holdings: [
    H('h1', { quantity: 9, avgCost: 107.3333 }),                      // cohérente
    H('h2', { quantity: 12, avgCost: 50 }),                           // sans opérations
    H('h3', { quantity: 1000, avgCost: 1 }),                          // divergente : split ×10 non validé (stocké déjà après split)
    H('h4', { quantity: 10, avgCost: 120 }),                          // divergente : PRU
    H('h5', { quantity: 10, avgCost: null }),                         // divergente : PRU absent mais calculable
    H('h6', { quantity: 5, avgCost: 10, costCurrency: 'USD' }),       // divergente : devise du coût
    H('h7', { quantity: 5, avgCost: 100 }),                           // divergente : vente > achats
    H('h8', { quantity: 10, avgCost: 100 })                           // divergente : achat sans montant
  ].map((h, i) => (i === 2 ? Object.assign(h, { splits: [{ date: '2024-05-01', ratio: 10 }] }) : h)),
  archive: [{ id: 'z1', name: 'Soldée', isin: 'FR0000000009', currency: 'EUR', account: 'a' }],
  transactions: [
    tx('a1', 'h1', '2024-01-10', 'buy', 10, 100, 5), tx('a2', 'h1', '2024-03-05', 'buy', 5, 120, 5), tx('a3', 'h1', '2024-06-20', 'sell', 6, 150, 5),
    tx('b1', 'h3', '2023-01-10', 'buy', 100, 10, 0),
    tx('c1', 'h4', '2024-01-10', 'buy', 10, 100, 0),
    tx('d1', 'h5', '2024-01-10', 'buy', 10, 100, 0),
    tx('e1', 'h6', '2024-01-10', 'buy', 5, 10, 0),
    tx('f1', 'h7', '2024-01-10', 'buy', 5, 100, 0), tx('f2', 'h7', '2024-02-10', 'sell', 8, 120, 0),
    Object.assign(tx('g1', 'h8', '2024-01-10', 'buy', 10, 100, 0), { amountAcct: null, price: null }),
    tx('z1', 'z1', '2023-01-01', 'buy', 3, 10, 0)                     // clôturée dont le grand livre indique encore 3 titres
  ],
  payments: [], corp: []
});
const find = (rep, id) => ['coherent', 'noOps', 'divergent'].map((k) => rep[k].find((p) => p.id === id)).find(Boolean);

t('classement en trois catégories et totaux', () => {
  const r = A.positions(mk());
  assert.strictEqual(r.totals.positions, 8); assert.strictEqual(r.totals.coherent, 1); assert.strictEqual(r.totals.noOps, 1); assert.strictEqual(r.totals.divergent, 6);
  assert.strictEqual(find(r, 'h1').category, 'coherent'); assert.strictEqual(find(r, 'h2').category, 'noOps');
  assert.strictEqual(r.totals.ops, 3 + 1 + 1 + 1 + 1 + 2 + 1);
});
t('cohérente : quantité et PRU du grand livre, écarts nuls, pas de détail', () => {
  const p = find(A.positions(mk()), 'h1');
  assert.strictEqual(p.ledgerQty, 9); assert.ok(Math.abs(p.ledgerPru - 107.3333333) < 1e-5); assert.strictEqual(p.qtyDiff, 0); assert.ok(Math.abs(p.pruDiff) < 1e-3); assert.strictEqual(p.ops, 3); assert.strictEqual(p.rows.length, 0);
});
t('sans opérations : aucune valeur de grand livre', () => {
  const p = find(A.positions(mk()), 'h2'); assert.strictEqual(p.ledgerQty, null); assert.strictEqual(p.ops, 0); assert.strictEqual(p.storedQty, 12);
});
t('divergente par quantité : écart, rapport de split, split de marché non validé, détail du grand livre', () => {
  const p = find(A.positions(mk()), 'h3');
  assert.strictEqual(p.category, 'divergent'); assert.deepStrictEqual(p.reasons, ['qty', 'pru']); assert.strictEqual(p.ledgerQty, 100); assert.strictEqual(p.qtyDiff, 900);
  assert.ok(p.hints.some((h) => /×10/.test(h) && /split ou un regroupement/.test(h)), 'rapport ×10 détecté');
  assert.ok(p.hints.some((h) => /L'écart disparaît en appliquant le split de marché ×10/.test(h)), 'split de marché explicatif');
  assert.strictEqual(p.marketSplits.qty, 1000); assert.strictEqual(p.rows.length, 1); assert.strictEqual(p.rows[0].qtyAfter, 100); assert.strictEqual(p.rows[0].label, 'Achat');
});
t('divergente par PRU (quantités identiques)', () => { const p = find(A.positions(mk()), 'h4'); assert.deepStrictEqual(p.reasons, ['pru']); assert.strictEqual(p.qtyDiff, 0); assert.strictEqual(p.ledgerPru, 100); assert.strictEqual(p.pruDiff, 20); assert.ok(Math.abs(p.pruDiffPct - 0.2) < 1e-9); });
t('PRU absent mais calculable ; devise du coût différente ; solde négatif ; achat sans montant', () => {
  const r = A.positions(mk());
  assert.deepStrictEqual(find(r, 'h5').reasons, ['pru_missing_stored']);
  assert.deepStrictEqual(find(r, 'h6').reasons, ['cost_currency']); assert.strictEqual(find(r, 'h6').pruComparable, false);
  const n = find(r, 'h7'); assert.ok(n.reasons.indexOf('negative') >= 0 && n.reasons.indexOf('qty') >= 0); assert.ok(n.anomalies.some((a) => /Vente supérieure/.test(a)));
  const u = find(r, 'h8'); assert.deepStrictEqual(u.reasons, ['pru_uncomputable']); assert.ok(u.anomalies.some((a) => /sans montant exploitable/.test(a)));
});
t('clôturée dont le grand livre indique encore des titres : signalée à part', () => {
  const r = A.positions(mk()); assert.strictEqual(r.archiveWithBalance.length, 1); assert.strictEqual(r.archiveWithBalance[0].ledgerQty, 3);
});
t('relevé de portefeuille de référence : aide au diagnostic', () => {
  const s = mk(); s.reference = { account: 'a', positions: [{ isin: 'FR0000000003', qty: 1000 }], at: '2026-01-01' };
  const p = find(A.positions(s), 'h3'); assert.ok(p.hints.some((h) => /correspond à la quantité stockée : c'est l'historique qui est incomplet/.test(h)));
});
t('LECTURE SEULE : état gelé récursivement, aucune écriture, état identique avant/après', () => {
  const s = mk(), before = JSON.stringify(s); deepFreeze(s);
  const r = A.positions(s, { now: '2026-11-17T00:00:00Z' });          // une écriture sur l'état gelé lèverait une exception (mode strict)
  assert.strictEqual(r.totals.positions, 8); assert.strictEqual(JSON.stringify(s), before);
  A.summaryCsv(r); A.detailCsv(r);
});
t('exports CSV : synthèse (toutes positions) et détail (divergentes seulement)', () => {
  const r = A.positions(mk()), s = A.summaryCsv(r), d = A.detailCsv(r);
  assert.strictEqual(s.split('\r\n').filter(Boolean).length, 1 + 8); assert.ok(/Divergente/.test(s) && /Cohérente/.test(s) && /Sans opérations/.test(s));
  assert.strictEqual(d.split('\r\n').filter(Boolean).length, 1 + (1 + 1 + 1 + 1 + 2 + 1)); // h3,h4,h5,h6,h7(2),h8
});
t('état vide ou sans opérations : aucun plantage', () => { const r = A.positions({ holdings: [], transactions: [] }); assert.strictEqual(r.totals.positions, 0); const r2 = A.positions({}); assert.strictEqual(r2.totals.positions, 0); });
if (failed) process.exitCode = 1;
