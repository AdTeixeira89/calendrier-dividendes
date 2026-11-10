/* Tests de la fusion automatique entre appareils (sync.js). Résultats attendus écrits à la main.
   Lancer :  node tests/sync.test.js */
const assert = require('assert');
const S = require('../sync.js');
let n = 0, failed = 0; const t = (name, fn) => { try { fn(); n++; console.log('ok  ', name); } catch (e) { failed++; console.log('FAIL', name, '\n   ', e.message); process.exitCode = 1; } };

const clone = (x) => JSON.parse(JSON.stringify(x));
const BASE = () => ({ v: 2, accounts: [{ id: 'a1', name: 'DEGIRO' }], settings: { theme: 'auto', baseCurrency: 'EUR' }, meta: { uid: 'u' },
  holdings: [{ id: 'h1', account: 'a1', isin: 'FR0000120073', name: 'Air Liquide', quantity: 10, avgCost: 100, price: 150, hist: { c: [1, 2, 3] }, dividend: { lastAmount: 3, frequency: 'annual', history: [{ exDate: '2025-05-12', amount: 3 }] } }],
  archive: [], payments: [{ id: 'p1', holdingId: 'h1', payDate: '2026-05-20', gross: 55.5, extId: 'dgd2:aaa:1' }], transactions: [{ id: 't1', holdingId: 'h1', date: '2024-01-02', type: 'buy', qty: 10, price: 100, extId: 'dg:x:1' }], corp: [] });
const SB = () => S.slim(BASE());
const m3 = (b, l, r, pl) => S.merge3(b, l, r, pl === undefined ? true : pl);
const ids = (a) => a.map((x) => x.id).sort();

t('1. Ajout sur un appareil : il arrive sur l\'autre sans rien demander (et inversement)', () => {
  const base = SB(), A = clone(base); A.payments.push({ id: 'p2', holdingId: 'h1', payDate: '2026-08-20', gross: 56, extId: 'dgd2:bbb:1' });
  assert.deepStrictEqual(ids(m3(base, A, base).payments), ['p1', 'p2'], 'local ajoute, distant inchangé'); assert.deepStrictEqual(ids(m3(base, base, A, false).payments), ['p1', 'p2'], 'distant ajoute, local inchangé');
});
t('2. Suppression sur un appareil : elle est répercutée sur l\'autre (versement, position, opération)', () => {
  const base = SB(), A = clone(base); A.payments = []; A.transactions = [];
  const m = m3(base, base, A, false); assert.deepStrictEqual([m.payments.length, m.transactions.length, m.holdings.length], [0, 0, 1], 'supprimé à distance : supprimé ici');
  const B = clone(base); B.holdings = []; B.payments = []; assert.strictEqual(m3(base, B, base).holdings.length, 0, 'supprimé ici : supprimé là-bas');
});
t('3. Deux appareils modifient des champs DIFFÉRENTS du même élément : les deux modifications sont conservées', () => {
  const base = SB(), A = clone(base), B = clone(base); A.holdings[0].quantity = 12; B.holdings[0].avgCost = 95; B.holdings[0].dividend.frequency = 'semiannual'; A.holdings[0].dividend.payDay = 20;
  const h = m3(base, A, B).holdings[0]; assert.deepStrictEqual([h.quantity, h.avgCost, h.dividend.frequency, h.dividend.payDay], [12, 95, 'semiannual', 20]);
});
t('4. Même champ modifié des deux côtés : le plus récent l\'emporte', () => {
  const base = SB(), A = clone(base), B = clone(base); A.holdings[0].quantity = 12; B.holdings[0].quantity = 14;
  assert.strictEqual(m3(base, A, B, true).holdings[0].quantity, 12, 'local plus récent'); assert.strictEqual(m3(base, A, B, false).holdings[0].quantity, 14, 'distant plus récent');
});
t('5. Modification contre suppression : la modification est conservée (rien n\'est perdu)', () => {
  const base = SB(), A = clone(base), B = clone(base); A.holdings = []; B.holdings[0].quantity = 11;
  const h = m3(base, A, B).holdings; assert.deepStrictEqual([h.length, h[0].quantity], [1, 11]);
  const A2 = clone(base), B2 = clone(base); A2.payments[0].gross = 60; B2.payments = []; assert.strictEqual(m3(base, A2, B2).payments[0].gross, 60);
});
t('6. Même versement importé séparément sur les deux appareils (identifiants différents, même identifiant d\'import) : un seul reste', () => {
  const base = SB(), A = clone(base), B = clone(base); A.payments.push({ id: 'a-new', holdingId: 'h1', payDate: '2026-11-04', gross: 9.4, extId: 'dgd2:zzz:1' }); B.payments.push({ id: 'b-new', holdingId: 'h1', payDate: '2026-11-04', gross: 9.4, extId: 'dgd2:zzz:1' });
  const merged = m3(base, A, B), before = merged.payments.length, d = S.dedupe(merged, new Set(['h1'])); assert.strictEqual(before, 3); assert.deepStrictEqual([d.merged.payments.length, d.removed], [2, 1]);
  const dbl = SB(), X = clone(dbl); X.payments.push({ id: 'x1', holdingId: 'h1', payDate: '2026-12-01', gross: 5 }, { id: 'x2', holdingId: 'h1', payDate: '2026-12-01', gross: 5 }); assert.strictEqual(S.dedupe(m3(dbl, X, dbl), new Set()).merged.payments.length, 3, 'deux versements légitimes identiques sans identifiant d\'import : conservés');
});
t('7. La même suppression des deux côtés ne casse rien ; fusion idempotente', () => {
  const base = SB(), A = clone(base), B = clone(base); A.payments = []; B.payments = []; assert.strictEqual(m3(base, A, B).payments.length, 0);
  const X = clone(base); X.payments.push({ id: 'p9', holdingId: 'h1', payDate: '2026-09-09', gross: 1 }); const Xn = clone(X); delete Xn.meta; assert.strictEqual(S.st(m3(base, X, X)), S.st(Xn), 'deux versions identiques : inchangées');
  const once = m3(base, X, base), twice = m3(base, once, base); assert.strictEqual(S.st(once), S.st(twice));
});
t('8. Réglages : chaque clé fusionnée séparément ; listes sans identifiant (opérations sur titres) : union', () => {
  const base = SB(), A = clone(base), B = clone(base); A.settings.theme = 'dark'; B.settings.baseCurrency = 'USD'; A.corp.push({ isin: 'X1', date: '2026-01-01', kind: 'split', ratio: 2 }); B.corp.push({ isin: 'X2', date: '2026-02-01', kind: 'split', ratio: 3 });
  const m = m3(base, A, B); assert.deepStrictEqual([m.settings.theme, m.settings.baseCurrency, m.corp.length], ['dark', 'USD', 2]);
});
t('9. Les données de marché ne sont pas synchronisées : retirées de la version envoyée, remises depuis l\'appareil à la réception', () => {
  const full = BASE(), s = S.slim(full); assert.ok(!('hist' in s.holdings[0]) && !('price' in s.holdings[0]) && !('history' in s.holdings[0].dividend) && s.holdings[0].dividend.lastAmount === 3, 'version envoyée sans marché');
  const remote = clone(s); remote.holdings[0].quantity = 15; const merged = S.reattach(m3(s, S.slim(full), remote, false), full);
  assert.deepStrictEqual([merged.holdings[0].quantity, merged.holdings[0].price, merged.holdings[0].hist.c.length, merged.holdings[0].dividend.history.length], [15, 150, 3, 1], 'quantité distante + cours et historique locaux conservés');
  assert.ok(!('undo' in S.slim({ undo: { x: 1 }, holdings: [], archive: [] })), 'annulation locale jamais envoyée');
});
t('10. Positions ajoutées indépendamment sur les deux appareils : une seule (versements rattachés à celle gardée) ; position clôturée + même titre racheté : conservés tous les deux', () => {
  const base = SB(), A = clone(base), B = clone(base);
  A.holdings.push({ id: 'ha', account: 'a1', isin: 'US0378331005', name: 'Apple', quantity: 5 }); A.payments.push({ id: 'pa', holdingId: 'ha', payDate: '2026-11-01', gross: 2 });
  B.holdings.push({ id: 'hb', account: 'a1', isin: 'US0378331005', name: 'Apple', quantity: 5 });
  const d = S.dedupe(m3(base, A, B), new Set(['h1'])); const ap = d.merged.holdings.filter((h) => h.isin === 'US0378331005'); assert.strictEqual(ap.length, 1); assert.strictEqual(d.merged.payments.find((p) => p.id === 'pa').holdingId, ap[0].id, 'versement rattaché à la position gardée');
  const C = clone(base); C.archive.push({ id: 'old', account: 'a1', isin: 'FR0000120073', name: 'Air Liquide' }); const e = S.dedupe(m3(base, C, base), new Set(['h1'])); assert.deepStrictEqual([e.merged.holdings.length, e.merged.archive.length], [1, 1], 'clôturée et détenue : les deux restent');
});
t('11. Premier échange (aucune base) : union par identifiant, sans suppression, plus récent en cas de désaccord', () => {
  const A = SB(), B = SB(); A.payments.push({ id: 'pa', holdingId: 'h1', payDate: '2026-01-01', gross: 1 }); B.payments = [{ id: 'pb', holdingId: 'h1', payDate: '2026-02-02', gross: 2 }]; B.holdings[0].quantity = 99;
  const m = S.merge3(null, A, B, false); assert.deepStrictEqual([ids(m.payments), m.holdings[0].quantity], [['p1', 'pa', 'pb'], 99]);
});

console.log('\n' + n + ' tests réussis' + (failed ? ', ' + failed + ' échec(s)' : ''));
