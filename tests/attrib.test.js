/* Tests de attrib.js : attribution d'actions gratuites Air Liquide, prime de fidélité, rompus, doublons.
   Résultats attendus tirés des EXEMPLES OFFICIELS du Guide de l'actionnaire Air Liquide 2026 (fiches pratiques n° 3 et n° 5).
   Lancer :  node tests/attrib.test.js */
const assert = require('assert');
const A = require('../attrib.js');
const L = require('../ledger.js');
let n = 0, failed = 0; const t = (name, fn) => { try { fn(); n++; console.log('ok  ', name); } catch (e) { failed++; console.log('FAIL', name, '\n   ', e.stack.split('\n').slice(0, 3).join(' | ')); process.exitCode = 1; } };
const near = (a, b, m) => assert.ok(Math.abs(a - b) < 1e-6, (m || '') + ' : ' + a + ' ≠ ' + b);
let u = 0; const deps = { uid: () => 'u' + (++u), today: '2026-11-25' };
const ISIN = 'FR0000120073';
const OP24 = { id: 'T-2024', isin: ISIN, name: 'Air Liquide', N: 10, bonusPct: 10, exDate: '2024-06-03', creditDate: '2024-06-05', exConfirmed: true, creditConfirmed: true, source: 'test' };
const buy = (id, h, date, qty, price, extra) => Object.assign({ id, holdingId: h, date, type: 'buy', qty, price, fees: 0, currency: 'EUR', amountAcct: qty * price, acctCur: 'EUR', source: 'manual' }, extra || {});
const mk = (mode, qty, txs, extra) => ({ holdings: [Object.assign({ id: 'h', ticker: 'AI.PA', displayTicker: 'AI.PA', isin: ISIN, name: 'Air Liquide', currency: 'EUR', costCurrency: 'EUR', account: 'a', quantity: qty, avgCost: 100, holdMode: mode, addedAt: '2019-01-01' }, extra || {})], archive: [], corp: [], attributions: [OP24], transactions: txs });

t('ancienneté : les inscriptions à partir du 29 décembre comptent l\'année suivante ; éligible à partir de Y + 3', () => {
  assert.strictEqual(A.effYear('2021-12-31'), 2022); assert.strictEqual(A.effYear('2021-12-28'), 2021); assert.strictEqual(A.effYear('2020-03-01'), 2020);
});
t('exemple officiel n° 1 (au nominatif) : 100 actions éligibles → 10 gratuites + 1 de prime de fidélité = 11', () => {
  const st = mk('registered', 100, [buy('t1', 'h', '2020-03-01', 100, 100)]); const c = A.compute(st, st.holdings[0], OP24);
  assert.deepStrictEqual([c.held, c.eligible, c.base, c.bonus, c.free, c.after], [100, 100, 10, 1, 11, 111]); near(c.rompuQty, 0); assert.deepStrictEqual(c.reasons, [], 'données fiables, opération confirmée');
});
t('exemple officiel n° 2 : 225 actions dont 112 éligibles → 22 + 1 ; rompus 0,5 + 0,12', () => {
  const st = mk('registered', 225, [buy('t1', 'h', '2021-05-01', 112, 100), buy('t2', 'h', '2022-03-01', 113, 100)]); const c = A.compute(st, st.holdings[0], OP24);
  assert.deepStrictEqual([c.held, c.eligible, c.base, c.bonus, c.free], [225, 112, 22, 1, 23]); near(c.rompuQty, 0.62, 'rompus : 0,5 + 0,12');
});
t('au porteur (compte-titres, PEA) : attribution de base, jamais de prime de fidélité ; rompus à part', () => {
  const st = mk('bearer', 16, [buy('t1', 'h', '2019-05-01', 16, 100)]); const c = A.compute(st, st.holdings[0], OP24);
  assert.deepStrictEqual([c.eligible, c.base, c.bonus, c.free], [0, 1, 0, 1]); near(c.rompuQty, 0.6);
});
t('actions achetées trop récemment ou transférées au nominatif tard : non éligibles à la prime (date d\'inscription au nominatif)', () => {
  let st = mk('registered', 30, [buy('t1', 'h', '2023-02-10', 30, 100)]); assert.strictEqual(A.compute(st, st.holdings[0], OP24).eligible, 0, 'acheté en 2023 : prime à partir de 2026');
  st = mk('registered', 30, [buy('t1', 'h', '2019-02-10', 30, 100, { nomSince: '2023-06-01' })]); assert.strictEqual(A.compute(st, st.holdings[0], OP24).eligible, 0, 'acheté en 2019 au porteur, inscrit au nominatif en 2023 : pas éligible');
  st = mk('registered', 30, [buy('t1', 'h', '2019-02-10', 30, 100, { nomSince: '2021-06-01' })]); assert.strictEqual(A.compute(st, st.holdings[0], OP24).eligible, 30, 'inscrit au nominatif en 2021 : éligible en 2024');
});
t('mode de détention non indiqué, cessions, historique incomplet, date non confirmée : « à vérifier » avec les raisons (jamais d\'application silencieuse)', () => {
  let st = mk(undefined, 10, [buy('t1', 'h', '2020-03-01', 10, 100)]); assert.ok(A.compute(st, st.holdings[0], OP24).reasons.some((r) => /mode de détention/.test(r)));
  st = mk('registered', 8, [buy('t1', 'h', '2020-03-01', 10, 100), { id: 's1', holdingId: 'h', date: '2022-01-01', type: 'sell', qty: 2, price: 120, fees: 0, currency: 'EUR', amountAcct: 240, acctCur: 'EUR', source: 'manual' }]); assert.ok(A.compute(st, st.holdings[0], OP24).reasons.some((r) => /cessions/.test(r)));
  st = mk('bearer', 10, []); assert.ok(A.compute(st, st.holdings[0], OP24).reasons.some((r) => /aucune opération/.test(r)));
  const st26 = mk('registered', 30, [buy('t1', 'h', '2026-02-10', 30, 100)]); st26.attributions = []; const pr = A.proposals(st26, '2026-11-25'); assert.strictEqual(pr.length, 1); assert.strictEqual(pr[0].status, 'review'); assert.ok(pr[0].calc.reasons.some((r) => /détachement non confirmée/.test(r)));
  assert.strictEqual(pr[0].calc.eligible, 0, 'actions achetées en 2026 : prime à partir de 2029'); assert.strictEqual(pr[0].calc.free, 3, '30 titres : 3 gratuites');
});
t('application : livraison gratuite (quantité + gratuites, coût total inchangé, PRU recalculé), trace, jamais deux fois, annulable, rompus à part', () => {
  const st = mk('registered', 100, [buy('t1', 'h', '2020-03-01', 100, 100)]); st.holdings[0].avgCost = 100; const r = A.apply(st, 'T-2024', 'h', deps); assert.ok(r.ok, r.error);
  near(st.holdings[0].quantity, 111); near(st.holdings[0].avgCost, 100 * 100 / 111, 'PRU : coût total inchangé / 111'); assert.strictEqual(r.rec.free, 11); assert.strictEqual(r.rec.bonus, 1);
  const tx = st.transactions.find((x) => x.id === r.rec.txId); assert.ok(tx.corp && tx.amountAcct === 0 && tx.attribId === 'T-2024', 'livraison gratuite sans montant, rattachée à l\'opération');
  assert.ok(!A.apply(st, 'T-2024', 'h', deps).ok, 'deuxième application refusée'); near(st.holdings[0].quantity, 111, 'quantité inchangée au second essai'); assert.strictEqual(st.transactions.length, 2);
  assert.strictEqual(A.proposals(st, '2026-11-25')[0].status, 'applied');
  assert.ok(A.setRompuCash(st, r.rec.id, 12.34).ok); assert.strictEqual(st.attribApplied[0].rompuCash, 12.34); assert.strictEqual((st.payments || []).length, 0, 'l\'indemnité de rompus n\'est pas un dividende');
  const rv = A.revert(st, r.rec.id); assert.ok(rv.ok); near(st.holdings[0].quantity, 100); near(st.holdings[0].avgCost, 100); assert.strictEqual(st.attribApplied.length, 0);
  // la mise à jour du grand livre reste cohérente
  const st2 = mk('bearer', 16, [buy('t1', 'h', '2019-05-01', 16, 100)]); A.apply(st2, 'T-2024', 'h', deps); const led = L.run(L.entriesFor(st2, st2.holdings[0]).entries); near(led.qty, 17); near(led.pru, st2.holdings[0].avgCost, 'grand livre : PRU identique');
});
t('doublons : une livraison gratuite déjà saisie ou importée à la même période = « déjà appliquée » (jamais appliquée une seconde fois)', () => {
  const st = mk('bearer', 17, [buy('t1', 'h', '2019-05-01', 16, 100), buy('g1', 'h', '2024-06-05', 1, 0, { corp: true, price: null, amountAcct: 0 })]); const pr = A.proposals(st, '2026-11-25'); assert.strictEqual(pr[0].status, 'applied'); assert.strictEqual(pr[0].applied.by, 'ledger');
  assert.ok(!A.apply(st, 'T-2024', 'h', deps).ok);
});
t('chaque compte reste distinct : DEGIRO (porteur) et nominatif pur calculés séparément, les autres positions ne sont jamais modifiées', () => {
  const st = { holdings: [{ id: 'dg', ticker: 'AI.PA', isin: ISIN, name: 'Air Liquide', currency: 'EUR', costCurrency: 'EUR', account: 'degiro', quantity: 16, avgCost: 150, holdMode: 'bearer', addedAt: '2019-01-01' },
    { id: 'nm', ticker: 'AI.PA', isin: ISIN, name: 'Air Liquide', currency: 'EUR', costCurrency: 'EUR', account: 'nom', quantity: 100, avgCost: 120, holdMode: 'registered', addedAt: '2019-01-01' },
    { id: 'other', ticker: 'AAA', isin: 'FR0000000001', name: 'Autre', currency: 'EUR', quantity: 5, avgCost: 10, account: 'degiro' }], archive: [], corp: [], attributions: [OP24],
    transactions: [buy('a1', 'dg', '2019-05-01', 16, 150, {}), buy('b1', 'nm', '2020-03-01', 100, 120, {})] }; st.transactions[0].holdingId = 'dg'; st.transactions[1].holdingId = 'nm';
  const pr = A.proposals(st, '2026-11-25').filter((p) => p.op.id === 'T-2024'); assert.strictEqual(pr.length, 2); const by = {}; pr.forEach((p) => { by[p.h.id] = p.calc; });
  assert.deepStrictEqual([by.dg.free, by.dg.bonus, by.nm.free, by.nm.bonus], [1, 0, 11, 1]); A.apply(st, 'T-2024', 'nm', deps); assert.strictEqual(st.holdings[0].quantity, 16, 'DEGIRO inchangé'); assert.strictEqual(st.holdings[2].quantity, 5, 'autre position inchangée'); assert.strictEqual(st.holdings[1].quantity, 111);
});
t('détection d\'après les données de marché : un fractionnement 1,1 inconnu = opération « à vérifier » ; connu du catalogue = ignoré', () => {
  const st = mk('bearer', 16, [buy('t1', 'h', '2019-05-01', 16, 100)], { splits: [{ date: '2022-06-06', ratio: 1.1 }, { date: '2024-06-03', ratio: 1.1 }] });
  const c = A.detectFromMarket(st, '2026-11-25'); assert.deepStrictEqual(c.map((x) => [x.id, x.N, x.exConfirmed]), [['AI-mkt-2022-06-06', 10, false]], 'le 3 juin 2024 est déjà connu');
  assert.strictEqual(A.detectFromMarket(mk('bearer', 16, [], { splits: [{ date: '2026-06-08', ratio: 1.1 }] }), '2026-11-25').length, 0, 'opération du catalogue (2026-06-08)');
});

t('position SANS ISIN (nominatif pur saisi à la main) reconnue par son nom ; mode de détention déduit du NOM DU PORTEFEUILLE (nominatif / DEGIRO, CTO, PEA) ; choix explicite prioritaire', () => {
  const st = { accounts: [{ id: 'dg', name: 'DEGIRO' }, { id: 'nom', name: 'Air Liquide Nominatif Pur' }, { id: 'x', name: 'Mon portefeuille' }],
    holdings: [{ id: 'a', ticker: 'AI.PA', isin: ISIN, name: 'AIR LIQUIDE', currency: 'EUR', costCurrency: 'EUR', account: 'dg', quantity: 16, avgCost: 150, addedAt: '2019-01-01' },
      { id: 'b', ticker: 'AI.PA', isin: '', name: "L'Air Liquide S.A.", currency: 'EUR', costCurrency: 'EUR', account: 'nom', quantity: 100, avgCost: 120, addedAt: '2019-01-01' },
      { id: 'c', ticker: 'AI.PA', isin: ISIN, name: 'Air Liquide', currency: 'EUR', costCurrency: 'EUR', account: 'x', quantity: 10, avgCost: 120, addedAt: '2019-01-01' },
      { id: 'd', ticker: 'AAA', isin: '', name: 'Autre société', currency: 'EUR', account: 'nom', quantity: 5, avgCost: 10 }], archive: [], corp: [], attributions: [OP24],
    transactions: [buy('ta', 'a', '2019-05-01', 16, 150), buy('tb', 'b', '2020-03-01', 100, 120), buy('tc', 'c', '2020-03-01', 10, 120)] };
  assert.strictEqual(A.issuerOf(st.holdings[1]), ISIN, 'sans ISIN : reconnue par son nom'); assert.strictEqual(A.issuerOf(st.holdings[3]), null, 'autre société : ignorée');
  assert.deepStrictEqual([A.modeOf(st, st.holdings[0]).mode, A.modeOf(st, st.holdings[1]).mode, A.modeOf(st, st.holdings[2]).mode], ['bearer', 'registered', null], 'DEGIRO : porteur ; « Nominatif Pur » : nominatif ; nom inconnu : à indiquer');
  assert.strictEqual(A.modeOf(st, st.holdings[1]).inferred, true); st.holdings[2].holdMode = 'registered'; assert.deepStrictEqual([A.modeOf(st, st.holdings[2]).mode, A.modeOf(st, st.holdings[2]).inferred], ['registered', false], 'choix explicite');
  const by = {}; A.proposals(st, '2026-11-25').filter((p) => p.op.id === 'T-2024').forEach((p) => { by[p.h.id] = p.calc; });
  assert.deepStrictEqual([by.a.free, by.a.bonus, by.b.free, by.b.bonus, by.b.mode], [1, 0, 11, 1, 'registered'], 'DEGIRO : 1 gratuite, pas de prime ; nominatif pur : 11 dont 1 de prime'); assert.ok(!by.b.reasons.some((r) => /mode de détention/.test(r)), 'mode connu par le nom du portefeuille');
  assert.strictEqual(by.d, undefined, 'les autres positions ne sont pas concernées');
});

t('indemnité de rompus : revenu perçu enregistré sous son vrai libellé, rattaché à la position, comptée dans les revenus mais jamais prise pour un dividende ; modifiable, supprimée avec l\'opération', () => {
  const D = require('../dividends.js'), E = require('../engine.js');
  const st = mk('registered', 100, [buy('t1', 'h', '2020-03-01', 100, 100)]); st.holdings[0].avgCost = 100; const r = A.apply(st, 'T-2024', 'h', deps); assert.ok(r.ok);
  assert.ok(A.setRompuCash(st, r.rec.id, 3.2, deps).ok); let p = st.payments; assert.strictEqual(p.length, 1); assert.deepStrictEqual([p[0].kind, p[0].holdingId, p[0].gross, p[0].net, p[0].payDate, p[0].rompuKey, p[0].verified], ['rompu', 'h', 3.2, 3.2, '2024-06-05', 'attrib:' + r.rec.id, true]);
  assert.ok(/Régularisation rompus Air Liquide 2024/.test(p[0].label) && p[0].category === 'Indemnisation des rompus' && p[0].rompuType === 'Indemnisation de fractions d\'actions', 'libellé et catégorie explicites'); assert.ok(D.isReal(p[0]) && !D.isDividend(p[0]), 'revenu perçu, mais pas un dividende');
  const sm0 = D.summary(st, { from: '2024-01-01', to: '2024-12-31', convert: (v) => v }); assert.deepStrictEqual([sm0.gross, sm0.count, sm0.rompu.gross, sm0.rompu.count], [0, 0, 3.2, 1], 'catégorie séparée : hors totaux de dividendes, comptée dans les revenus de rompus');
  A.setRompuCash(st, r.rec.id, 4.5, deps); assert.strictEqual(st.payments.length, 1, 'idempotent : une seule écriture'); assert.strictEqual(st.payments[0].gross, 4.5);
  st.holdings[0].divHist = { at: '2026-11-01', currency: 'EUR', items: [['2024-06-03', 2]] }; const props = E.dividendProposals(st, new Date(2026, 10, 25), () => 'x', {}); assert.ok(props.proposals.some((q) => q.exDate === '2024-06-03') || props.already.length === 0, 'l\'indemnité n\'est pas prise pour le dividende du même mois');
  A.setRompuCash(st, r.rec.id, null, deps); assert.strictEqual(st.payments.length, 0, 'montant vide : écriture supprimée'); A.setRompuCash(st, r.rec.id, 2, deps); assert.ok(A.revert(st, r.rec.id).ok); assert.strictEqual(st.payments.length, 0, 'annulation de l\'opération : l\'indemnité est retirée');
  // attribution déjà enregistrée (livraison gratuite saisie / importée)
  const st2 = mk('bearer', 17, [buy('t1', 'h', '2019-05-01', 16, 100), buy('g1', 'h', '2024-06-05', 1, 0, { corp: true, price: null, amountAcct: 0 })]); assert.ok(A.setRompuOnTx(st2, 'g1', 1.1, deps).ok); assert.deepStrictEqual([st2.payments.length, st2.payments[0].rompuKey, st2.transactions[1].rompuCash], [1, 'tx:g1', 1.1]);
});

t('indemnisation des rompus saisie à part (virement « ROMPUS AIR LIQUIDE 2026 », année seule) : catégorie indépendante, ni dividende, ni action gratuite, quantité et PRU intacts, rendement des dividendes inchangé', () => {
  const D = require('../dividends.js'), E = require('../engine.js');
  const st = { accounts: [{ id: 'nom', name: 'Air Liquide Nominatif Pur' }], holdings: [{ id: 'h', ticker: 'AI.PA', isin: '', name: "L'Air Liquide S.A.", currency: 'EUR', costCurrency: 'EUR', account: 'nom', quantity: 33, avgCost: 136.36, price: 170, addedAt: '2026-02-10', dividend: { lastAmount: 3.7, frequency: 'annual', none: false } }], archive: [], corp: [], payments: [],
    transactions: [buy('t1', 'h', '2026-02-10', 30, 150), buy('g1', 'h', '2026-06-10', 3, 0, { corp: true, price: null, amountAcct: 0 })] };
  const before = JSON.stringify([st.holdings[0].quantity, st.holdings[0].avgCost, st.transactions]);
  const r = D.addRompu(st, { holdingId: 'h', year: '2026', amount: 99.37 }, deps); assert.ok(r.ok, r.error); const p = st.payments[0];
  assert.deepStrictEqual([p.kind, p.category, p.rompuType, p.label, p.gross, p.net, p.payDate, p.dateKnown, p.year, p.holdingId], ['rompu', 'Indemnisation des rompus', 'Indemnisation de fractions d\'actions', "Régularisation rompus L'Air Liquide S.A. 2026", 99.37, 99.37, '2026-01-01', false, '2026', 'h'], 'année seule : date à compléter, libellé par défaut');
  assert.strictEqual(JSON.stringify([st.holdings[0].quantity, st.holdings[0].avgCost, st.transactions]), before, 'quantité, PRU et opérations inchangés');
  const sm = D.summary(st, { convert: (v) => v }); assert.deepStrictEqual([sm.count, sm.gross, sm.rompu.count, sm.rompu.gross], [0, 0, 1, 99.37], 'revenu séparé : aucun dividende compté');
  assert.strictEqual(E.receivedBetween(st, '2026-01-01', '2026-12-31', 'gross', (v) => v, null).total, 0, 'les dividendes perçus de l\'année restent à 0');
  const ev = E.buildEvents(st, new Date(2026, 0, 1), new Date(2026, 11, 31), new Date(2026, 10, 25), null).filter((x) => x.status === 'received'); assert.strictEqual(ev.length, 0, 'pas d\'événement « dividende reçu » dans le calendrier');
  // date exacte + libellé personnalisé + modification (même écriture)
  assert.ok(D.addRompu(st, { id: p.id, holdingId: 'h', date: '2026-06-19', amount: 99.37, label: 'Régularisation rompus Air Liquide 2026' }, deps).ok); assert.strictEqual(st.payments.length, 1, 'modifiée, sans doublon'); assert.deepStrictEqual([st.payments[0].payDate, st.payments[0].dateKnown], ['2026-06-19', true]);
  assert.ok(!D.addRompu(st, { holdingId: 'h', year: '2026', amount: 0 }, deps).ok, 'montant obligatoire'); assert.ok(!D.addRompu(st, { holdingId: 'zz', year: '2026', amount: 5 }, deps).ok, 'position inconnue');
  assert.ok(!D.recordDue(st, [], deps).added);
});

console.log('\n' + n + ' tests réussis' + (failed ? ', ' + failed + ' échec(s)' : ''));
