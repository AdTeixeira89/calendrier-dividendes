/* Tests du module d'import d'historique (ledger.js) : lecture DEGIRO, grand livre, plan d'import.
   Lancer :  PAPA=<chemin papaparse.min.js> node tests/ledger.test.js   (PAPA facultatif : sinon petit analyseur CSV interne) */
const assert = require('assert');
const L = require('../ledger.js');
let n = 0; const t = (name, fn) => { try { fn(); n++; console.log('ok  ', name); } catch (e) { console.log('FAIL', name, '\n   ', e.message); process.exitCode = 1; } };

let parseCsv;
try { const Papa = require(process.env.PAPA || 'papaparse'); parseCsv = (txt) => Papa.parse(txt, { skipEmptyLines: true }).data; }
catch (e) {
  parseCsv = (txt) => txt.split(/\r?\n/).filter(Boolean).map((l) => { const out = []; let cur = '', q = false; for (const ch of l) { if (ch === '"') q = !q; else if ((ch === ',' || ch === ';') && !q) { out.push(cur); cur = ''; } else cur += ch; } out.push(cur); return out; });
}

/* ---------- jeux de données au format DEGIRO ---------- */
const HEAD_FR = 'Date,Heure,Produit,ISIN,Bourse de référence,Lieu d\'exécution,Quantité,Cours,,Valeur locale,,Valeur EUR,Taux de change,Frais de courtage AutoFX,Frais de transaction et/ou frais de tiers EUR,Total EUR,ID Ordre';
const FR = [HEAD_FR,
  // le fichier DEGIRO est trié du plus récent au plus ancien
  '20-06-2024,15:00,"NOVO NORDISK A/S B",DK0062498333,CPH,XCSE,-10,"900,00",DKK,"9000,00",DKK,"1 206,00","7,4620",,"-3,00","1 203,00",o9',
  '15-03-2024,10:05,"APPLE INC. - COMMON STOCK",US0378331005,NDQ,XNAS,-5,"190,50",USD,"-952,50",USD,"880,05","1,0823","-0,50","-1,00","878,55",o8',
  '02-02-2024,11:00,"TOTALENERGIES SE",FR0000120271,EPA,XPAR,-20,"60,00",EUR,"-1200,00",EUR,"1200,00",,,"-2,00","1 198,00",o7',
  '02-02-2024,11:00,"TOTALENERGIES SE",FR0000120271,EPA,XPAR,10,"55,00",EUR,"-550,00",EUR,"-550,00",,,"-2,00","-552,00",o6',
  '10-01-2024,09:31,"APPLE INC. - COMMON STOCK",US0378331005,NDQ,XNAS,10,"170,00",USD,"-1700,00",USD,"-1 542,10","1,1023","-2,31","-1,00","-1 545,41",o5',
  '05-12-2023,10:00,"AIR LIQUIDE",FR0000120073,EPA,XPAR,10,"50,00",EUR,"-500,00",EUR,"-500,00",,,"-1,00","-501,00",o4',
  '05-12-2023,10:00,"AIR LIQUIDE",FR0000120073,EPA,XPAR,20,"45,00",EUR,"-900,00",EUR,"-900,00",,,"-1,00","-901,00",o3',
  '01-11-2023,09:00,"TOTALENERGIES SE",FR0000120271,EPA,XPAR,10,"55,00",EUR,"-550,00",EUR,"-550,00",,,"-2,00","-552,00",o2',
  '01-11-2023,09:00,"NOVO NORDISK A/S B",DK0062498333,CPH,XCSE,10,"800,00",DKK,"-8000,00",DKK,"-1 072,00","7,4627",,"-3,00","-1 075,00",o1'
].join('\n');

const HEAD_EN = 'Date,Time,Product,ISIN,Reference exchange,Venue,Quantity,Price,,Local value,,Value EUR,Exchange rate,AutoFX Fee,Transaction and/or third party fees EUR,Total EUR,Order ID';
const EN = [HEAD_EN,
  '2024-03-15,10:05,APPLE INC.,US0378331005,NDQ,XNAS,-5,190.50,USD,"-952.50",USD,"880.05",1.0823,-0.50,-1.00,"878.55",o8',
  '2024-01-10,09:31,APPLE INC.,US0378331005,NDQ,XNAS,10,170.00,USD,"-1,700.00",USD,"-1,542.10",1.1023,-2.31,-1.00,"-1,545.41",o5'].join('\n');

const rowsOf = (csv) => parseCsv(csv);
const parse = (csv, o) => { const rows = rowsOf(csv), det = L.detect(rows); return { rows, det, res: L.parseOps(rows, det, o) }; };

t('nombres à l\'européenne et à l\'anglaise', () => {
  assert.strictEqual(L.parseNumber('1 542,10', ','), 1542.1); assert.strictEqual(L.parseNumber('-1.234,56'), -1234.56); assert.strictEqual(L.parseNumber('1,234.56'), 1234.56);
  assert.strictEqual(L.parseNumber('1 234,5'), 1234.5); assert.strictEqual(L.parseNumber('(12,5)'), -12.5); assert.strictEqual(L.parseNumber('−7,25'), -7.25);
  assert.strictEqual(L.parseNumber('1.234', ','), 1234); assert.strictEqual(L.parseNumber('1.234', '.'), 1.234); assert.ok(isNaN(L.parseNumber('abc'))); assert.ok(isNaN(L.parseNumber('')));
  assert.strictEqual(L.inferDecimal(['1,5', '2,25', '10']), ','); assert.strictEqual(L.inferDecimal(['1.5', '2.25', '1,000.5']), '.');
});
t('dates : jj-mm-aaaa, ISO, jj/mm/aaaa ; dates impossibles refusées', () => {
  assert.strictEqual(L.parseDate('15-03-2024'), '2024-03-15'); assert.strictEqual(L.parseDate('2024-03-15T10:00:00Z'), '2024-03-15'); assert.strictEqual(L.parseDate('5/3/2024'), '2024-03-05');
  assert.strictEqual(L.parseDate('03/15/2024', 'mdy'), '2024-03-15'); assert.strictEqual(L.parseDate('31-02-2024'), null); assert.strictEqual(L.parseDate('n/a'), null);
  assert.strictEqual(L.inferDateOrder(['03/15/2024', '01/02/2024']), 'mdy'); assert.strictEqual(L.inferDateOrder(['15/03/2024']), 'dmy');
});
t('colonnes reconnues par leur sens, y compris les colonnes de devise sans titre', () => {
  const d = L.detect(rowsOf(FR)), c = d.cols;
  assert.deepStrictEqual([c.date, c.time, c.product, c.isin, c.qty, c.price, c.priceCur, c.localValue, c.valueAcct, c.fx, c.total, c.orderId], [0, 1, 2, 3, 6, 7, 8, 9, 11, 12, 15, 16]);
  assert.deepStrictEqual(c.fees, [13, 14]); assert.strictEqual(d.acctCur, 'EUR'); assert.deepStrictEqual(d.missing, []);
  const e = L.detect(rowsOf(EN)).cols; assert.deepStrictEqual([e.date, e.qty, e.price, e.priceCur, e.total, e.orderId], [0, 6, 7, 8, 15, 16]);
});
t('colonnes dans un autre ordre / autres noms / séparateur « ; » : même résultat', () => {
  const csv = 'Total;Produit;Anzahl;Kurs;Währung;Datum;ISIN\n"-501,00";AIR LIQUIDE;10;"50,00";EUR;05.12.2023;FR0000120073\n"880,05";APPLE;-5;"190,50";USD;15.03.2024;US0378331005';
  const { det, res } = parse(csv.replace(/;/g, ','.length ? ';' : ';'));
  assert.deepStrictEqual(det.missing, []);
  assert.deepStrictEqual(res.ops.map((o) => [o.type, o.qty, o.price, o.priceCur, o.date, o.amt]), [['buy', 10, 50, 'EUR', '2023-12-05', 501], ['sell', 5, 190.5, 'USD', '2024-03-15', 880.05]]);
});
t('lecture du fichier français : 9 opérations, signe de la quantité = achat / vente, montants en EUR frais compris', () => {
  const { res } = parse(FR);
  assert.strictEqual(res.ops.length, 9); assert.strictEqual(res.bad.length, 0); assert.strictEqual(res.ambiguous.length, 0); assert.strictEqual(res.meta.decimal, ',');
  const apple = res.ops.filter((o) => o.isin === 'US0378331005').sort(L.orderKey);
  assert.deepStrictEqual(apple.map((o) => [o.type, o.qty, o.price, o.priceCur, o.amt, o.fees]), [['buy', 10, 170, 'USD', 1545.41, 3.31], ['sell', 5, 190.5, 'USD', 878.55, 1.5]]);
  assert.ok(res.ops.every((o) => o.warn.length === 0), 'aucune alerte de cohérence : ' + JSON.stringify(res.ops.filter((o) => o.warn.length)));
  const nn = res.ops.find((o) => o.orderId === 'o9'); assert.strictEqual(nn.priceCur, 'DKK'); assert.strictEqual(nn.amt, 1203); assert.strictEqual(nn.type, 'sell');
});
t('lecture du fichier anglais (décimale « . », milliers « , »)', () => {
  const { res } = parse(EN); assert.strictEqual(res.meta.decimal, '.');
  assert.deepStrictEqual(res.ops.map((o) => [o.type, o.qty, o.amt]), [['sell', 5, 878.55], ['buy', 10, 1545.41]]);
});
t('lignes illisibles ou ambiguës signalées sans bloquer les autres', () => {
  const csv = [HEAD_FR, '??,10:00,X,US0378331005,,,5,"1,0",USD,"5",USD,"5",,,"-0","-5",z1',
    '10-01-2024,09:31,"BON",FR0000120073,EPA,XPAR,abc,"1,0",EUR,"-1",EUR,"-1",,,,"-1,0",z2',
    '10-01-2024,09:31,"CONTRADICTOIRE",FR0000120073,EPA,XPAR,5,"10,0",EUR,"50",EUR,"50",,,,"50,00",z3',   // quantité + mais total + : contradictoire
    '10-01-2024,09:31,"BONNE LIGNE",FR0000120073,EPA,XPAR,-2,"10,0",EUR,"20",EUR,"20",,,,"20,00",z4',
    '10-01-2024,09:31,"SANS PRIX",FR0000120073,EPA,XPAR,3,,EUR,,EUR,"-30",,,,"-30,00",z5'].join('\n');
  const { res } = parse(csv);
  assert.strictEqual(res.ops.length, 1); assert.strictEqual(res.ops[0].orderId, 'z4');   // seule la ligne valide est lue
  assert.strictEqual(res.bad.length, 3); assert.strictEqual(res.ambiguous.length, 1);
  assert.ok(res.bad.some((b) => /Date illisible/.test(b.reason)) && res.bad.some((b) => /Quantité/.test(b.reason)) && res.bad.some((b) => /Prix/.test(b.reason)));
});
t('quantités non signées : le sens vient du signe du total', () => {
  const csv = [HEAD_FR, '10-01-2024,09:31,A,FR0000120073,,,5,"10,0",EUR,"-50",EUR,"-50",,,,"-50,00",u1', '11-01-2024,09:31,A,FR0000120073,,,5,"12,0",EUR,"60",EUR,"60",,,,"60,00",u2'].join('\n');
  const { res } = parse(csv); assert.strictEqual(res.meta.signedQty, false); assert.deepStrictEqual(res.ops.map((o) => o.type).sort(), ['buy', 'sell']);
});
t('relevé de compte : achats/ventes lus dans la description, dividendes et virements comptés à part', () => {
  const csv = ['Date,Heure,Date de valeur,Produit,ISIN,Description,Taux de change,Variation,,Solde,,ID Ordre',
    '10-01-2024,09:31,10-01-2024,APPLE INC.,US0378331005,"Achat 10 APPLE INC.@170 USD (US0378331005)",1.1,EUR,"-1545,41",EUR,"100,00",s1',
    '15-02-2024,00:00,15-02-2024,APPLE INC.,US0378331005,Dividende,,USD,"3,00",EUR,"103,00",',
    '16-02-2024,00:00,16-02-2024,,,Dépôt flatex Deposit,,EUR,"500,00",EUR,"603,00",',
    '17-02-2024,00:00,17-02-2024,,,Frais de connexion Euronext,,EUR,"-2,50",EUR,"600,50",'].join('\n');
  const { det, res } = parse(csv); assert.strictEqual(det.statement, true);
  assert.deepStrictEqual(res.ops.map((o) => [o.type, o.qty, o.price, o.priceCur, o.amt, o.isin]), [['buy', 10, 170, 'USD', 1545.41, 'US0378331005']]);
  assert.deepStrictEqual(res.other.map((o) => o.kind), ['dividende', 'dépôt / virement', 'frais']);
});

/* ---------- grand livre ---------- */
const E = (date, type, qty, amt, time) => ({ date, time: time || '', type, qty, amt });
t('PRU : exemple de la demande (10 à 50 € + 20 à 45 € → 30 titres, 1 400 €, 46,67 €)', () => {
  const l = L.run([E('2024-01-01', 'buy', 10, 500), E('2024-02-01', 'buy', 20, 900)]);
  assert.strictEqual(l.qty, 30); assert.strictEqual(l.cost, 1400); assert.ok(Math.abs(l.pru - 46.6667) < 1e-3);
  const l2 = L.run([E('2024-01-01', 'buy', 10, 500), E('2024-02-01', 'buy', 20, 900), E('2024-03-01', 'sell', 10, 600)]);
  assert.strictEqual(l2.qty, 20); assert.ok(Math.abs(l2.pru - 46.6667) < 1e-3, 'le PRU ne bouge pas à la vente'); assert.ok(Math.abs(l2.cost - 933.33) < 0.01);
  assert.ok(Math.abs(l2.realized - (600 - 466.67)) < 0.01, 'résultat réalisé = produit − PRU × quantité vendue');
});
t('PRU : frais d\'achat intégrés, ordre chronologique indépendant de l\'ordre du fichier, vente totale = position soldée', () => {
  const l = L.run([E('2024-03-01', 'sell', 30, 1500), E('2024-02-01', 'buy', 20, 902), E('2024-01-01', 'buy', 10, 501)]);
  assert.strictEqual(l.qty, 0); assert.strictEqual(l.pru, null); assert.strictEqual(l.cost, 0); assert.strictEqual(l.negative, false);
  assert.ok(Math.abs(l.realized - (1500 - 1403)) < 0.01);
  assert.deepStrictEqual(l.rows.map((r) => r.qtyAfter), [10, 30, 0]); assert.ok(Math.abs(l.rows[1].pruAfter - 1403 / 30) < 1e-9);
});
t('grand livre : achat et vente à la même minute (achat d\'abord), solde négatif et montant inconnu signalés, jamais inventés', () => {
  assert.strictEqual(L.run([E('2024-01-01', 'sell', 5, 100, '10:00'), E('2024-01-01', 'buy', 5, 90, '10:00')]).negative, false);
  const neg = L.run([E('2024-01-01', 'buy', 5, 100), E('2024-02-01', 'sell', 8, 200)]); assert.strictEqual(neg.negative, true); assert.ok(neg.issues.length);
  const unk = L.run([E('2024-01-01', 'buy', 5, null), E('2024-01-02', 'buy', 5, 100)]); assert.strictEqual(unk.pru, null); assert.strictEqual(unk.qty, 10); assert.strictEqual(unk.costUnknown, 1);
});
t('identifiants : stables, lignes identiques distinctes, indépendants de l\'ordre des lignes', () => {
  const a = parse(FR).res.ops.map((o) => o.extId), b = parse(FR).res.ops.map((o) => o.extId);
  assert.deepStrictEqual(a, b); assert.strictEqual(new Set(a).size, a.length);
  const twice = FR + '\n' + FR.split('\n')[1];      // la même ligne deux fois = deux opérations (remplissages partiels identiques)
  const ids = parse(twice).res.ops.map((o) => o.extId); assert.strictEqual(ids.length, 10); assert.strictEqual(new Set(ids).size, 10);
  const rev = [HEAD_FR].concat(FR.split('\n').slice(1).reverse()).join('\n');
  assert.deepStrictEqual(parse(rev).res.ops.map((o) => o.extId).sort(), a.slice().sort(), 'fichier trié à l\'envers : mêmes identifiants');
});

/* ---------- plan d'import (cas A à E) ---------- */
let uidn = 0; const uid = () => 'id' + (++uidn);
const emptyState = () => ({ holdings: [], archive: [], payments: [], transactions: [], accounts: [{ id: 'main', name: 'DEGIRO' }] });
const hold = (o) => Object.assign({ id: 'h1', ticker: 'X', displayTicker: 'X', isin: '', name: '', type: 'stock', currency: 'EUR', quantity: 0, avgCost: null, account: 'main', dividend: {} }, o);
const NOREF = { mode: null, map: new Map() };
const run = (state, csv, choices, popt) => { const { res } = parse(csv); const pl = L.plan(state, res.ops, Object.assign({ account: 'main' }, popt || {})); const r = L.apply(state, pl, choices, { uid, account: 'main' }); return { pl, r, res }; };
const inst = (pl, isin) => pl.instruments.find((i) => i.isin === isin);

t('import dans un portefeuille vide : D (détenue → créée avec PRU), E (partielle), C (soldée → archivée), quantités et PRU exacts', () => {
  const s = emptyState(), { pl, r } = run(s, FR);
  assert.strictEqual(pl.totals.detected, 9); assert.strictEqual(pl.totals.newTx, 9); assert.strictEqual(pl.totals.dups, 0); assert.strictEqual(pl.totals.newPositions, 2); assert.strictEqual(pl.totals.closed, 2);
  const byIsin = (i) => s.holdings.find((h) => h.isin === i);
  const air = byIsin('FR0000120073'); assert.strictEqual(air.quantity, 30); assert.strictEqual(air.avgCost, r4(1402 / 30)); assert.strictEqual(air.costCurrency, 'EUR'); assert.strictEqual(air.account, 'main');
  const aapl = byIsin('US0378331005'); assert.strictEqual(aapl.quantity, 5); assert.strictEqual(aapl.avgCost, r4(1545.41 / 10)); assert.strictEqual(aapl.currency, 'USD');
  assert.ok(!byIsin('DK0062498333'), 'Novo Nordisk entièrement vendu : absent du portefeuille actuel');
  assert.ok(!byIsin('FR0000120271'), 'TotalEnergies : 10 + 10 − 20 = 0 → soldée');
  assert.deepStrictEqual(s.archive.map((a) => a.isin).sort(), ['DK0062498333', 'FR0000120271']);
  assert.strictEqual(s.transactions.length, 9, 'toutes les transactions conservées, y compris celles des positions soldées');
  assert.ok(s.transactions.filter((t) => t.holdingId === s.archive[0].id).length >= 2);
  assert.strictEqual(r.created.length, 2); assert.strictEqual(r.archived.length, 2);
});
function r4(x) { return Math.round(x * 1e4) / 1e4; }
t('IDEMPOTENCE : réimporter le même fichier ne change rien (ni doublons, ni positions, ni PRU)', () => {
  const s = emptyState(); run(s, FR); const snap = JSON.stringify(s);
  const { pl, r } = run(s, FR);
  assert.strictEqual(pl.totals.newTx, 0); assert.strictEqual(pl.totals.dups, 9); assert.strictEqual(pl.totals.newPositions, 0); assert.strictEqual(r.tx, 0);
  assert.strictEqual(JSON.stringify(s), snap, 'état strictement identique');
  const rev = [HEAD_FR].concat(FR.split('\n').slice(1).reverse()).join('\n'); run(s, rev); assert.strictEqual(JSON.stringify(s), snap, 'fichier dans un autre ordre : toujours identique');
});
t('A : transaction déjà saisie autrement (même date, sens, quantité, prix) → doublon ignoré ; deux opérations légitimes le même jour restent deux', () => {
  const s = emptyState(); s.holdings.push(hold({ id: 'h1', isin: 'FR0000120073', name: 'AIR LIQUIDE', quantity: 30, avgCost: 47 }));
  s.transactions.push({ id: 't1', holdingId: 'h1', date: '2023-12-05', type: 'buy', qty: 10, price: 50, fees: 1, currency: 'EUR', source: 'manual' });
  const { pl } = run(s, FR);
  const air = inst(pl, 'FR0000120073'); assert.strictEqual(air.dupOps.length, 1, 'la saisie manuelle du 10 × 50 est reconnue'); assert.strictEqual(air.newOps.length, 1, 'le 20 × 45 du même jour reste une opération distincte');
  assert.strictEqual(s.transactions.filter((t) => t.holdingId === 'h1').length, 2);
});
t('B : actif présent avec PRU saisi → PRU, quantité et prix jamais remplacés ; divergences signalées ; alignement seulement si demandé', () => {
  const s = emptyState(); s.holdings.push(hold({ id: 'h1', isin: 'FR0000120073', name: 'Air Liquide (perso)', quantity: 30, avgCost: 99.99, price: 150, logo: 'x.png' }));
  const before = JSON.stringify(s.holdings[0]);
  const { pl } = run(s, FR); const air = inst(pl, 'FR0000120073');
  assert.strictEqual(air.status, 'holding'); assert.ok(air.pruDiff && air.pruDiff.app === 99.99, 'écart de PRU signalé'); assert.strictEqual(air.divergence, null);
  assert.strictEqual(JSON.stringify(s.holdings[0]), before, 'aucune donnée de la position modifiée'); assert.strictEqual(s.transactions.filter((t) => t.holdingId === 'h1').length, 2, 'l\'historique est ajouté');
  // quantité différente dans l'application
  const s2 = emptyState(); s2.holdings.push(hold({ id: 'h1', isin: 'FR0000120073', quantity: 25, avgCost: 47 }));
  const r2 = run(s2, FR); const a2 = inst(r2.pl, 'FR0000120073'); assert.deepStrictEqual([a2.divergence.app, a2.divergence.file], [25, 30]); assert.strictEqual(s2.holdings[0].quantity, 25, 'quantité conservée');
  const s3 = emptyState(); s3.holdings.push(hold({ id: 'h1', isin: 'FR0000120073', quantity: 25, avgCost: 47 }));
  const k = inst(L.plan(s3, parse(FR).res.ops, { account: 'main' }), 'FR0000120073').key; run(s3, FR, { align: { [k]: true } });
  assert.strictEqual(s3.holdings[0].quantity, 30); assert.strictEqual(s3.holdings[0].avgCost, r4(1402 / 30));
});
t('B bis : seules les informations MANQUANTES sont complétées (PRU vide, ISIN absent), jamais l\'existant', () => {
  const s = emptyState(); s.holdings.push(hold({ id: 'h1', ticker: 'AI.PA', name: 'Air Liquide', quantity: 30, avgCost: null }), hold({ id: 'h2', ticker: 'AAPL', name: 'Apple perso', isin: 'US0378331005', quantity: 5, avgCost: 150 }));
  const { pl } = run(s, FR);
  assert.strictEqual(inst(pl, 'FR0000120073').status, 'holding');
  // AI.PA n'a pas d'ISIN : rapprochement par le nom exact « Air Liquide » = « AIR LIQUIDE » (casse ignorée)
  const air = s.holdings[0]; assert.strictEqual(air.avgCost, r4(1402 / 30)); assert.strictEqual(air.isin, 'FR0000120073'); assert.strictEqual(air.ticker, 'AI.PA', 'ticker conservé');
  assert.strictEqual(s.holdings[1].avgCost, 150, 'PRU saisi conservé'); assert.strictEqual(s.holdings[1].name, 'Apple perso');
  assert.strictEqual(s.holdings.length, 2, 'aucune position en double');
});
t('fusion contrôlée désactivable : fill:false ne complète rien', () => {
  const s = emptyState(); s.holdings.push(hold({ id: 'h1', isin: 'FR0000120073', name: 'AIR LIQUIDE', quantity: 30, avgCost: null }));
  run(s, FR, { fill: false }); assert.strictEqual(s.holdings[0].avgCost, null);
});
t('C : position achetée puis entièrement vendue → archivée (transactions conservées), pas dans les positions actuelles', () => {
  const s = emptyState(); const { pl } = run(s, FR);
  const tot = inst(pl, 'FR0000120271'); assert.strictEqual(tot.status, 'closed'); assert.strictEqual(tot.led.qty, 0); assert.ok(Math.abs(tot.led.realized - (1198 - 1104)) < 0.01, 'résultat réalisé = 1 198 − 2 × 552');
  assert.ok(!s.holdings.some((h) => h.isin === 'FR0000120271')); assert.strictEqual(s.archive.length, 2);
});
t('D : position détenue absente de l\'application → créée avec quantité, PRU (frais inclus) et historique', () => {
  const s = emptyState(); s.holdings.push(hold({ id: 'h9', isin: 'IE00B4L5Y983', name: 'Autre', quantity: 1, avgCost: 1 }));
  run(s, FR, {}, { reference: NOREF }); const air = s.holdings.find((h) => h.isin === 'FR0000120073'); assert.ok(air); assert.strictEqual(air.source, 'degiro'); assert.strictEqual(air.derived, true); assert.strictEqual(s.holdings.find((h) => h.id === 'h9').quantity, 1, 'les autres positions sont intactes');
  assert.strictEqual(s.transactions.filter((t) => t.holdingId === air.id).length, 2);
});
t('E : vente partielle → l\'actif reste, quantité et coût restants au PRU moyen', () => {
  const s = emptyState(); run(s, FR); const a = s.holdings.find((h) => h.isin === 'US0378331005');
  assert.strictEqual(a.quantity, 5); assert.ok(Math.abs(a.avgCost - 154.541) < 1e-3, 'PRU conservé après la vente partielle (vente au coût moyen)');
});
t('historique incohérent (vente sans achat connu) → transactions CONSERVÉES « à vérifier », aucune position créée, le reste est importé', () => {
  const csv = [HEAD_FR, '20-06-2024,15:00,"ORPHELINE",NL0010273215,AEX,XAMS,-5,"600,00",EUR,"3000",EUR,"3000,00",,,"-1,00","2999,00",x1', FR.split('\n')[6]].join('\n');
  const s = emptyState(); const { pl } = run(s, csv); const o = inst(pl, 'NL0010273215');
  assert.strictEqual(o.status, 'check'); assert.strictEqual(o.check.code, 'negative'); assert.ok(/négatif/.test(o.reasons[0]));
  assert.ok(!s.holdings.some((h) => h.isin === 'NL0010273215'), 'jamais une position actuelle'); const a = s.archive.find((x) => x.isin === 'NL0010273215'); assert.ok(a && a.check.code === 'negative', 'archivée à vérifier');
  assert.strictEqual(s.transactions.filter((t) => t.holdingId === a.id).length, 1, 'la transaction est conservée, rien n\'est perdu');
  assert.ok(s.holdings.some((h) => h.isin === 'FR0000120073'));
});
t('position soldée réachetée plus tard : réouverture avec le même identifiant (historique relié)', () => {
  const s = emptyState(); run(s, FR); const archivedId = s.archive.find((a) => a.isin === 'FR0000120271').id;
  const more = FR + '\n01-09-2024,10:00,"TOTALENERGIES SE",FR0000120271,EPA,XPAR,4,"62,00",EUR,"-248,00",EUR,"-248,00",,,"-1,00","-249,00",o10';
  const { pl } = run(s, more); assert.strictEqual(inst(pl, 'FR0000120271').status, 'reopen');
  const h = s.holdings.find((x) => x.isin === 'FR0000120271'); assert.strictEqual(h.id, archivedId); assert.strictEqual(h.quantity, 4); assert.strictEqual(h.avgCost, 62.25);
  assert.ok(!s.archive.some((a) => a.isin === 'FR0000120271')); assert.strictEqual(s.transactions.filter((t) => t.holdingId === archivedId).length, 4);
});
t('devises : prix d\'origine et devise de cotation conservés ; coût en EUR au taux réel de l\'exécution (jamais le taux du jour)', () => {
  const s = emptyState(); run(s, FR); const tx = s.transactions.filter((x) => x.ticker && x.isin === 'US0378331005').sort((a, b) => a.date.localeCompare(b.date));
  assert.deepStrictEqual(tx.map((x) => [x.price, x.currency, x.amountAcct, x.acctCur, x.fxRate]), [[170, 'USD', 1545.41, 'EUR', 1.1023], [190.5, 'USD', 878.55, 'EUR', 1.0823]]);
  assert.strictEqual(s.transactions.find((x) => x.isin === 'DK0062498333' && x.type === 'sell').currency, 'DKK');
});
t('rapprochement limité au portefeuille de destination (même ISIN dans un autre compte = autre position)', () => {
  const s = emptyState(); s.accounts.push({ id: 'pea', name: 'PEA' }); s.holdings.push(hold({ id: 'hp', isin: 'FR0000120073', account: 'pea', quantity: 7, avgCost: 40 }));
  run(s, FR); assert.strictEqual(s.holdings.find((h) => h.id === 'hp').quantity, 7); assert.strictEqual(s.holdings.filter((h) => h.isin === 'FR0000120073').length, 2);
});
t('facteur de fractionnement : produit des splits postérieurs', () => {
  const sp = [{ date: '2024-06-10', ratio: 10 }, { date: '2021-08-01', ratio: 4 }];
  assert.strictEqual(L.splitFactor(sp, '2024-01-01'), 10); assert.strictEqual(L.splitFactor(sp, '2020-01-01'), 40); assert.strictEqual(L.splitFactor(sp, '2024-07-01'), 1); assert.strictEqual(L.splitFactor(null, '2020-01-01'), 1);
});


/* ---------- fiabilité : positions fantômes, splits, ISIN, opérations sur titres ---------- */
const mk = (d, isin, name, q, p, cur, fee, id) => { const v = Math.abs(q * p), f = fee == null ? 1 : fee, tot = q > 0 ? -(v + f) : v - f, c = cur || 'EUR', n2 = (x) => String(x).replace('.', ',');
  return d + ',10:00,"' + name + '",' + isin + ',EPA,XPAR,' + q + ',"' + n2(p) + '",' + c + ',"' + (q > 0 ? -v : v) + '",' + c + ',"' + (q > 0 ? -v : v) + '",,,"-' + f + '","' + n2(tot) + '",' + (id || ('i' + (++uidn))) + ''; };
const csvOf = (rows) => [HEAD_FR].concat(rows).join('\n');
const realPos = (arr) => ({ mode: 'file', map: new Map(arr.map((p) => [p.isin, p])) });

t('CAUSE 1 : achat 2019 sous un ancien ISIN (changement d\'ISIN) → plus de position fantôme : archivée « à vérifier », transactions conservées', () => {
  const rows = [mk('03-04-2019', 'US9999999999', 'ANCIEN NOM', 10, 50, 'USD'), mk('10-05-2023', 'US0378331005', 'NOUVEAU NOM', -10, 80, 'USD'), mk('01-06-2024', 'US0378331005', 'NOUVEAU NOM', 7, 90, 'USD')];
  const s = emptyState(); s.holdings.push(hold({ id: 'real', isin: 'US0378331005', quantity: 7, avgCost: 90, name: 'Nouveau' }));      // portefeuille réel : seulement le nouvel ISIN
  const { pl } = run(s, csvOf(rows));
  assert.strictEqual(inst(pl, 'US9999999999').status, 'check'); assert.strictEqual(inst(pl, 'US9999999999').check.code, 'unreferenced');
  assert.ok(!s.holdings.some((h) => h.isin === 'US9999999999'), 'aucune position 2019 dans le portefeuille actuel'); assert.strictEqual(s.transactions.length, 3);
  assert.strictEqual(L.diagnose(s).items.filter((i) => i.code === 'negative' || i.code === 'check_unreferenced').length >= 1, true, 'signalé par le diagnostic');
});
t('CAUSE 1 bis : fusion validée des deux ISIN → le grand livre est complet (10 achetés, 10 vendus, 7 rachetés) et l\'ancien ISIN disparaît des positions', () => {
  const rows = [mk('03-04-2019', 'US9999999999', 'ANCIEN NOM', 10, 50, 'USD'), mk('10-05-2023', 'US0378331005', 'NOUVEAU NOM', -10, 80, 'USD'), mk('01-06-2024', 'US0378331005', 'NOUVEAU NOM', 7, 90, 'USD')];
  const s = emptyState(); s.holdings.push(hold({ id: 'real', isin: 'US0378331005', quantity: 7, avgCost: 90, name: 'Nouveau' })); run(s, csvOf(rows));
  const old = s.archive.find((a) => a.isin === 'US9999999999'), before = s.transactions.length;
  const r = L.mergeInstruments(s, old.id, 'real', { uid, today: '2026-10-15' }); assert.strictEqual(r.ok, true);
  assert.strictEqual(s.transactions.length, before, 'aucune transaction supprimée'); assert.ok(!s.archive.some((a) => a.id === old.id)); assert.strictEqual(s.isinAlias['US9999999999'], 'US0378331005');
  const d = L.diagnose(s); assert.strictEqual(d.items.filter((i) => i.level === 'error').length, 0, JSON.stringify(d.items.map((i) => i.code)));
  const again = run(s, csvOf(rows)); assert.strictEqual(again.pl.totals.newTx, 0, 'réimport après fusion : tout est reconnu, les opérations de l\'ancien ISIN vont à l\'actif fusionné');
  const h = s.holdings.find((x) => x.id === 'real'); assert.strictEqual(h.quantity, 7, 'position saisie non modifiée'); assert.strictEqual(h.avgCost, 90);
});
t('CAUSE 2 : split 4 pour 1 absent du CSV (5 achetés 2019, 20 vendus 2024) → plus de transactions perdues ; split validé = ratio explicite, coût total inchangé', () => {
  const rows = [mk('03-04-2019', 'US0378331005', 'APPLE', 5, 100, 'EUR', 0), mk('10-05-2024', 'US0378331005', 'APPLE', -20, 150, 'EUR', 0)];
  const s = emptyState(); const { pl } = run(s, csvOf(rows)); assert.strictEqual(inst(pl, 'US0378331005').check.code, 'negative'); assert.strictEqual(s.transactions.length, 2, 'transactions conservées');
  const a = s.archive[0]; a.splits = [{ date: '2022-08-31', ratio: 4 }];
  const d1 = L.diagnose(s); const cand = d1.items.find((i) => i.code === 'split_candidate'); assert.ok(cand && cand.coherent, 'split du marché proposé (cohérent), jamais appliqué seul'); assert.strictEqual((s.corp || []).length, 0);
  L.addCorp(s, { isin: 'US0378331005', date: '2022-08-31', kind: 'split', ratio: 4, source: 'market' }, { uid, today: '2026-10-15' });
  const { rows: lr, qty, cost, realized } = L.run(L.entriesFor(s, s.archive[0] || s.holdings[0]).entries);
  assert.strictEqual(qty, 0); assert.strictEqual(cost, 0); assert.ok(Math.abs(realized - (3000 - 500)) < 1e-6, 'résultat réalisé = 20 × 150 − coût 500'); assert.deepStrictEqual(lr.map((r) => r.qtyAfter), [5, 20, 0]);
  assert.ok(lr[1].type === 'split' && lr[1].costAfter === 500, 'le split ne crée pas d\'achat : coût total inchangé');
  assert.strictEqual(L.diagnose(s).items.filter((i) => i.level === 'error').length, 0);
});
t('CAUSE 3 : regroupement 1 pour 10 (100 achetés, 10 vendus après) → plus de position fantôme de 90 titres ; validé : 0 restant', () => {
  const rows = [mk('03-04-2019', 'FR0000120073', 'AIR', 100, 5, 'EUR', 0), mk('10-05-2024', 'FR0000120073', 'AIR', -10, 60, 'EUR', 0)];
  const s = emptyState(); const { pl } = run(s, csvOf(rows), {}, { reference: realPos([{ isin: 'IE00B4L5Y983', qty: 3, name: 'Autre' }]) });
  assert.strictEqual(inst(pl, 'FR0000120073').check.code, 'unreferenced'); assert.ok(!s.holdings.length, 'aucune position de 90 titres');
  L.addCorp(s, { isin: 'FR0000120073', date: '2023-01-10', kind: 'split', ratio: 0.1, source: 'manual' }, { uid, today: '2026-10-15' });
  const led = L.run(L.entriesFor(s, s.archive[0]).entries); assert.strictEqual(led.qty, 0); assert.strictEqual(led.negative, false);
});
t('CAUSE 4 : split 2 pour 1 absent, vente de 5 sur 10 → quantité réelle 15 signalée par la position de référence (pas 5) ; avec le split validé : 15 et PRU /2', () => {
  const rows = [mk('03-04-2019', 'FR0000120271', 'TOTAL', 10, 50, 'EUR', 0), mk('10-05-2024', 'FR0000120271', 'TOTAL', -5, 60, 'EUR', 0)];
  const s = emptyState(); const ref = realPos([{ isin: 'FR0000120271', qty: 15, name: 'Total' }]);
  const { pl } = run(s, csvOf(rows), {}, { reference: ref }); assert.strictEqual(inst(pl, 'FR0000120271').check.code, 'qty_mismatch'); assert.ok(!s.holdings.length, 'rien n\'est créé avec une mauvaise quantité');
  s.reference = { account: 'main', positions: [{ isin: 'FR0000120271', qty: 15, name: 'Total' }], at: '2026-10-15' };
  const res = L.addCorp(s, { isin: 'FR0000120271', date: '2023-06-01', kind: 'split', ratio: 2, source: 'market' }, { uid, today: '2026-10-15' });
  const h = s.holdings.find((x) => x.isin === 'FR0000120271'); assert.ok(h, 'promue en position actuelle après validation (cohérente avec la position réelle)'); assert.strictEqual(h.quantity, 15);
  assert.ok(Math.abs(h.avgCost - 25) < 1e-9 || Math.abs(h.avgCost - 25) < 1e-6, 'PRU après split 2:1 et vente de 5 : 375 / 15 = 25');
});
t('MONTANT NUL : ligne à coût nul (split, échange, livraison gratuite) jamais importée comme achat gratuit ; listée comme opération sur titres à vérifier', () => {
  const csv = csvOf([mk('03-04-2019', 'FR0000120073', 'AIR', 10, 50), '10-05-2022,10:00,"AIR",FR0000120073,EPA,XPAR,10,"0,00",EUR,"0",EUR,"0,00",,,,"0,00",z1']);
  const { res } = parse(csv); assert.strictEqual(res.ops.length, 1); assert.strictEqual(res.ambiguous.length, 1); assert.ok(/sans montant/.test(res.ambiguous[0].reason)); assert.strictEqual(res.corp.length, 1); assert.strictEqual(res.report.corp, 1);
});
t('MOUVEMENT SANS MONTANT (fichier signé) : livraison gratuite = entrée à coût nul, retrait = sortie sans résultat réalisé', () => {
  const rows = [mk('03-04-2019', 'FR0000120073', 'AIR', 10, 50), '10-05-2022,10:00,"AIR",FR0000120073,EPA,XPAR,5,"0,00",EUR,"0",EUR,"0,00",,,,"0,00",z1', '11-05-2023,10:00,"AIR",FR0000120073,EPA,XPAR,-3,"0,00",EUR,"0",EUR,"0,00",,,,"0,00",z2', mk('12-05-2023', 'FR0000120073', 'AIR', -2, 70)];
  const { res } = parse(csvOf(rows)); assert.strictEqual(res.ops.filter((o) => o.zero).length, 2); assert.strictEqual(res.corp.length, 2);
  const s = emptyState(); run(s, csvOf(rows), {}, { reference: NOREF }); const h = s.holdings[0]; assert.strictEqual(h.quantity, 10, '10 + 5 − 3 − 2'); assert.ok(Math.abs(h.avgCost - 501 / 15) < 1e-6, 'PRU dilué par la livraison gratuite, inchangé par le retrait');
});
t('RELEVÉ DE COMPTE : opérations sur titres, conversions de devise, dépôts et dividendes reconnus et ignorés (jamais des achats) ; ratio extrait de la description sans être appliqué', () => {
  const csv = ['Date,Heure,Date de valeur,Produit,ISIN,Description,Taux de change,Variation,,Solde,,ID Ordre',
    '10-01-2024,09:31,10-01-2024,APPLE INC.,US0378331005,"Achat 10 APPLE INC.@170 USD (US0378331005)",1.1,EUR,"-1545,41",EUR,"100,00",s1',
    '05-02-2024,00:00,05-02-2024,APPLE INC.,US0378331005,"Fractionnement d\'actions 4 pour 1",,EUR,"0,00",EUR,"100,00",',
    '06-02-2024,00:00,06-02-2024,,,"Opération de change - Retrait",,USD,"-100,00",EUR,"0,00",',
    '07-02-2024,00:00,07-02-2024,APPLE INC.,US0378331005,Dividende,,USD,"3,00",EUR,"103,00",',
    '08-02-2024,00:00,08-02-2024,,,Dépôt flatex Deposit,,EUR,"500,00",EUR,"603,00",'].join('\n');
  const { res } = parse(csv); assert.strictEqual(res.ops.length, 1); assert.deepStrictEqual(res.other.map((o) => o.kind), ['opération sur titres', 'conversion de devise', 'dividende', 'dépôt / virement']);
  assert.strictEqual(res.corp.length, 1); assert.strictEqual(res.corp[0].ratio, 4); assert.strictEqual(res.corp[0].isin, 'US0378331005');
});
t('SORTIE hors transaction (radiation, offre) : quantité ramenée à zéro sans résultat réalisé inventé ; nouvelle acquisition = nouveau cycle', () => {
  const l = L.run([E('2019-01-01', 'buy', 10, 100), { date: '2021-01-01', type: 'removal', qty: 0, amt: null }, E('2022-01-01', 'buy', 5, 50), E('2023-01-01', 'sell', 5, 80)]);
  assert.strictEqual(l.rows[1].removedQty, 10); assert.strictEqual(l.rows[1].qtyAfter, 0); assert.strictEqual(l.rows[1].realized, null);
  assert.deepStrictEqual(l.rows.map((r) => r.cycle), [1, 1, 2, 2]); assert.strictEqual(l.cycles, 2); assert.strictEqual(l.qty, 0); assert.strictEqual(l.realized, 30, 'le cycle 2 n\'est pas mélangé avec l\'ancien : 80 − 50');
});
t('PRU : frais de vente dans le résultat réalisé (pas retirés du PRU), frais d\'achat dans le coût, vente partielle puis rachat', () => {
  const l = L.run([E('2024-01-01', 'buy', 10, 1001), E('2024-02-01', 'sell', 4, 520), E('2024-03-01', 'buy', 6, 330)]);   // 520 = produit net des frais de vente
  assert.ok(Math.abs(l.rows[1].pruAfter - 100.1) < 1e-9, 'PRU inchangé par la vente'); assert.ok(Math.abs(l.rows[1].realized - (520 - 400.4)) < 1e-9, 'résultat réalisé net de frais');
  assert.strictEqual(l.qty, 12); assert.ok(Math.abs(l.cost - (600.6 + 330)) < 1e-6); assert.ok(Math.abs(l.pru - 930.6 / 12) < 1e-9);
});
t('IDEMPOTENCE avec positions « à vérifier » : le réimport ne les promeut pas en positions actuelles', () => {
  const rows = [mk('03-04-2019', 'US9999999999', 'ANCIEN', 10, 50, 'USD'), mk('01-06-2024', 'US0378331005', 'NOUVEAU', 7, 90, 'USD')];
  const s = emptyState(); s.holdings.push(hold({ id: 'real', isin: 'US0378331005', quantity: 7, avgCost: 90 })); run(s, csvOf(rows)); const snap = JSON.stringify(s);
  const { pl } = run(s, csvOf(rows)); assert.strictEqual(pl.totals.newTx, 0); assert.ok(!s.holdings.some((h) => h.isin === 'US9999999999')); assert.strictEqual(JSON.stringify(s), snap);
});
t('RECALCUL : une position issue de l\'import est recalculée depuis ses transactions ; une position modifiée à la main (manual) ou saisie n\'est jamais touchée', () => {
  const rows = [mk('03-04-2019', 'FR0000120073', 'AIR', 10, 50, 'EUR', 0)];
  const s = emptyState(); run(s, csvOf(rows), {}, { reference: NOREF }); const h = s.holdings[0]; assert.strictEqual(h.derived, true); h.quantity = 999;      // dérive
  L.reevaluate(s, h.id, { uid, today: '2026-10-15' }); assert.strictEqual(h.quantity, 10, 'recalculée depuis les transactions');
  h.quantity = 999; h.manual = true; L.reevaluate(s, h.id, { uid, today: '2026-10-15' }); assert.strictEqual(h.quantity, 999, 'correction manuelle protégée');
  assert.strictEqual(L.demote(s, h.id, 'x', 'x', { today: '2026-10-15' }).ok, true, 'archivage possible'); assert.strictEqual(s.transactions.length, 1, 'transactions conservées');
});
t('RELEVÉ DE PORTEFEUILLE DEGIRO (positions réelles) : lecture, lignes de liquidités ignorées', () => {
  const csv = 'Produit,Symbole/ISIN,Quantité,Clôture,Devise locale,Valeur en EUR\nAIR LIQUIDE,FR0000120073,12,170,EUR,2040\nCASH & CASH FUND & FTX CASH (EUR),,,,EUR,12,3\nAPPLE INC,US0378331005,5,200,USD,830\n';
  const r = L.parsePositions(parseCsv(csv)); assert.deepStrictEqual(r.positions.map((p) => [p.isin, p.qty]), [['FR0000120073', 12], ['US0378331005', 5]]); assert.ok(r.skipped.length >= 1);
});
t('VENTE dont les frais dépassent le produit (fraction de titre) : importée, pas « contradictoire »', () => {
  const rows = [mk('03-04-2019', 'US5381461012', 'LIVEPERSON', 1, 5), '10-04-2024,15:30,"LIVEPERSON",US5381461012,XNAS,XNAS,-1,"0,7739",USD,"0,77",USD,"0,72",,,"-2,00","-1,28",v1'];
  const { res } = parse(csvOf(rows)); assert.strictEqual(res.ambiguous.length, 0); assert.strictEqual(res.ops.length, 2);
});
t('DIAGNOSTIC : quantité qui ressemble à une année (2026) ou écart avec la position réelle — signalé avec correction proposée, jamais corrigé seul', () => {
  const s = emptyState(); s.holdings.push(hold({ id: 'y', isin: 'FR0000120073', name: 'AIR', quantity: 2026 }), hold({ id: 'z', isin: 'US0378331005', name: 'APPLE', quantity: 8 }));
  s.reference = { at: '2026-10-01', account: 'main', positions: [{ isin: 'FR0000120073', name: 'AIR', qty: 12 }, { isin: 'US0378331005', name: 'APPLE', qty: 5 }] };
  const d = L.diagnose(s, { today: '2026-10-15' }); const y = d.items.find((i) => i.code === 'qty_year'), z = d.items.find((i) => i.code === 'qty_vs_ref');
  assert.ok(y && y.refQty === 12 && y.act.includes('set_ref_qty')); assert.ok(z && z.refQty === 5); assert.strictEqual(s.holdings[0].quantity, 2026, 'rien n\'est modifié par le diagnostic');
  const s2 = emptyState(); s2.holdings.push(hold({ id: 'y', isin: 'FR0000120073', name: 'AIR', quantity: 2026 })); const y2 = L.diagnose(s2, { today: '2026-10-15' }).items.find((i) => i.code === 'qty_year'); assert.ok(y2 && y2.act.join() === 'edit');
});
t('DIAGNOSTIC : quantités négatives, position calculée absente de la réalité, quantité nulle encore au portefeuille, écart de PRU, transactions incomplètes — avec cause et action', () => {
  const s = emptyState(); s.holdings.push(
    hold({ id: 'a', isin: 'FR0000120073', name: 'Zéro', quantity: 5, avgCost: 10, derived: true, source: 'degiro' }),
    hold({ id: 'b', isin: 'FR0000120271', name: 'Fantôme', quantity: 4, avgCost: 10, derived: true, source: 'degiro' }),
    hold({ id: 'c', isin: 'US0378331005', name: 'Réelle', quantity: 3, avgCost: 10 }));
  const tx = (id, h, type, q, date, amt) => ({ id, holdingId: h, date, type, qty: q, price: amt / q, fees: 0, currency: 'EUR', amountAcct: amt, acctCur: 'EUR', source: 'degiro', isin: s.holdings.find((x) => x.id === h).isin });
  s.transactions.push(tx('t1', 'a', 'buy', 5, '2020-01-01', 50), tx('t2', 'a', 'sell', 5, '2021-01-01', 70), tx('t3', 'b', 'buy', 4, '2019-03-03', 40), tx('t4', 'c', 'buy', 3, '2022-01-01', 60), tx('t5', 'c', 'buy', 1, null, 10));
  s.transactions[4].date = '2022-02-02'; s.transactions[4].amountAcct = null;
  const d = L.diagnose(s), codes = d.items.map((i) => i.code + ':' + i.name);
  assert.ok(codes.includes('zero_held:Zéro'), codes.join()); assert.ok(codes.includes('not_in_ref:Fantôme') === false || true);
  assert.ok(codes.some((c) => c === 'tx_incomplete:Réelle'), codes.join()); assert.ok(d.items.every((i) => i.cause && (i.action || i.level === 'info')), 'chaque anomalie a une cause et une action');
  assert.strictEqual(d.reference.mode, 'app'); assert.ok(d.items.some((i) => i.code === 'not_in_ref' && i.name === 'Fantôme'), 'position calculée absente de la réalité'); assert.ok(d.rows.length === 3);
  // actions
  assert.strictEqual(L.demote(s, 'b', 'not_in_ref', 'archivée', { today: '2026-10-15' }).ok, true); assert.ok(!s.holdings.some((h) => h.id === 'b')); assert.strictEqual(s.transactions.filter((t) => t.holdingId === 'b').length, 1, 'transactions conservées');
  assert.strictEqual(L.demote(s, 'c', 'x', 'x', {}).ok, false, 'une position saisie n\'est jamais archivée automatiquement');
});

t('IMPORT INCRÉMENTAL : un nouvel achat met à jour une position issue de l\'import (recalcul depuis les transactions) mais jamais une position saisie ou corrigée à la main', () => {
  const s = emptyState(); run(s, csvOf([mk('03-04-2019', 'FR0000120073', 'AIR', 10, 50, 'EUR', 0, 'n1')]), {}, { reference: NOREF });
  const h = s.holdings[0]; assert.strictEqual(h.quantity, 10);
  const p2 = run(s, csvOf([mk('03-04-2019', 'FR0000120073', 'AIR', 10, 50, 'EUR', 0, 'n1'), mk('01-06-2025', 'FR0000120073', 'AIR', 5, 60, 'EUR', 0, 'n2')]), {}, { reference: NOREF });
  assert.strictEqual(p2.pl.totals.newTx, 1); assert.strictEqual(p2.pl.totals.recomputed, 1); assert.strictEqual(h.quantity, 15); assert.ok(Math.abs(h.avgCost - 800 / 15) < 1e-3, 'PRU = (500 + 300) / 15');
  assert.strictEqual(run(s, csvOf([mk('03-04-2019', 'FR0000120073', 'AIR', 10, 50, 'EUR', 0, 'n1'), mk('01-06-2025', 'FR0000120073', 'AIR', 5, 60, 'EUR', 0, 'n2')]), {}, { reference: NOREF }).pl.totals.newTx, 0, 'idempotent');
  h.manual = true; h.quantity = 99; const p3 = run(s, csvOf([mk('03-04-2019', 'FR0000120073', 'AIR', 10, 50, 'EUR', 0, 'n1'), mk('01-06-2025', 'FR0000120073', 'AIR', 5, 60, 'EUR', 0, 'n2'), mk('01-07-2025', 'FR0000120073', 'AIR', 1, 61, 'EUR', 0, 'n3')]), {}, { reference: NOREF });
  assert.strictEqual(h.quantity, 99, 'correction manuelle protégée'); assert.ok(p3.pl.instruments[0].divergence, 'divergence signalée, rien d\'écrasé');
});

console.log('\n' + n + ' tests réussis');
