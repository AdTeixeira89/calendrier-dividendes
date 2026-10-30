/* Tests du MOTEUR CENTRAL des dividendes (dividends.js) : perçu / dû / prévision, import idempotent, totaux, migration réversible.
   Résultats attendus fixés À L'AVANCE dans chaque scénario (valeurs écrites à la main, jamais recopiées du résultat obtenu).
   Lancer :  PAPA=<chemin papaparse.min.js> node tests/dividends.test.js */
const assert = require('assert');
const L = require('../ledger.js');
const D = require('../dividends.js');
const E = require('../engine.js');
let n = 0, failed = 0; const t = (name, fn) => { try { fn(); n++; console.log('ok  ', name); } catch (e) { failed++; console.log('FAIL', name, '\n   ', e.message); process.exitCode = 1; } };

let parseCsv;
try { const Papa = require(process.env.PAPA || 'papaparse'); parseCsv = (txt) => Papa.parse(txt, { skipEmptyLines: true }).data; }
catch (e) { parseCsv = (txt) => txt.split(/\r?\n/).filter(Boolean).map((l) => { const out = []; let cur = '', q = false; for (const ch of l) { if (ch === '"') q = !q; else if (ch === ',' && !q) { out.push(cur); cur = ''; } else cur += ch; } out.push(cur); return out; }); }

/* ---------- outils ---------- */
const FX = { EUR: 1, USD: 1.25 }, conv = (v, c) => (FX[c] ? v / FX[c] : null), convEurOnly = (v, c) => (c === 'EUR' ? v : null);
const fr = (x) => String(x).replace('.', ',');
const ddmmyyyy = (iso) => iso.slice(8, 10) + '-' + iso.slice(5, 7) + '-' + iso.slice(0, 4);
/* Relevé de compte DEGIRO : lignes « Dividende » (+ « Impôts sur dividende » si retenue). row = [date ISO, nom, ISIN, devise, brut, retenue | null] */
const stmt = (rows) => ['Date,Heure,Date de,Produit,Code ISIN,Description,FX,Mouvements,,Solde,,ID Ordre'].concat(...rows.map(([d, name, isin, cur, gross, tax]) => {
  const out = [ddmmyyyy(d) + ',07:44,' + ddmmyyyy(d) + ',' + name + ',' + isin + ',Dividende,,' + cur + ',"' + fr(gross.toFixed(2)) + '",' + cur + ',"100,00",'];
  if (tax) out.push(ddmmyyyy(d) + ',07:44,' + ddmmyyyy(d) + ',' + name + ',' + isin + ',Impôts sur dividende,,' + cur + ',"-' + fr(tax.toFixed(2)) + '",' + cur + ',"90,00",');
  return out;
})).join('\n');
let uidN = 0; const uid = () => 'u' + (++uidN);
const newState = (extra) => Object.assign({ holdings: [], archive: [], payments: [], transactions: [], accounts: [{ id: 'deg', name: 'DEGIRO' }, { id: 'tr', name: 'Trade Republic' }], isinAlias: {}, estimates: [], migrations: [], dividendImports: [] }, extra || {});
/* Import d'un relevé DEGIRO : même chaîne que l'application (groupes → positions → identifiants stables → rapprochement → application). */
function importStatement(state, csv, account, file) {
  const rows = parseCsv(csv), res = L.parseOps(rows, L.detect(rows)), g = L.groupDividends(res.divs);
  const sd = L.statementDividends(state, g, uid, { createMissing: true, account, file });
  state.archive.push.apply(state.archive, sd.stubs); D.stableIds(sd.incoming, 'dgd2');
  const rec = D.reconcile(state, sd.incoming, { legacyIds: (it) => [L.legacyStatementId(it.holdingId, it.payDate, it.currency, it.gross)] });
  const rep = D.applyReconcile(state, rec, { uid, importId: 'imp' + (++uidN) }); rep.stubs = sd.stubs.length; return rep;
}
const sum = (state, o) => D.summary(state, Object.assign({ convert: conv }, o));
const snapshot = (s) => JSON.stringify([s.payments, s.archive]);

/* =====================================================================
   SCÉNARIOS 1-3 : import de 10 dividendes, réimport (zéro doublon), 3 nouveaux
   ===================================================================== */
const FILE1 = [
  ['2026-01-15', 'AAA SA', 'FR0000000011', 'EUR', 10, 3], ['2026-04-15', 'AAA SA', 'FR0000000011', 'EUR', 10, 3], ['2026-07-15', 'AAA SA', 'FR0000000011', 'EUR', 10, 3], ['2026-10-15', 'AAA SA', 'FR0000000011', 'EUR', 10, 3],
  ['2026-02-20', 'BBB INC', 'US0000000012', 'USD', 5, 0.75], ['2026-05-20', 'BBB INC', 'US0000000012', 'USD', 5, 0.75], ['2026-08-20', 'BBB INC', 'US0000000012', 'USD', 5.5, 0.83],
  ['2025-12-05', 'CCC AG', 'DE0000000013', 'EUR', 20, 5.28], ['2026-03-05', 'CCC AG', 'DE0000000013', 'EUR', 20, 5.28], ['2026-06-05', 'CCC AG', 'DE0000000013', 'EUR', 21, 5.54]];
const FILE3 = FILE1.concat([['2026-03-03', 'DDD SA', 'FR0000000014', 'EUR', 8, 2], ['2026-06-03', 'DDD SA', 'FR0000000014', 'EUR', 8, 2], ['2026-09-03', 'DDD SA', 'FR0000000014', 'EUR', 8.5, 2.13]]);

t('1. Importer 10 dividendes : 10 versements réels, 3 sociétés non détenues (positions « relevé seul »), totaux 2026 exacts (brut / retenue / net, dollar converti)', () => {
  const st = newState(); const rep = importStatement(st, stmt(FILE1), 'deg', 'releve.csv');
  assert.deepStrictEqual([rep.fresh, rep.known, rep.updated, rep.ignored, rep.stubs], [10, 0, 0, 0, 3]);
  assert.strictEqual(st.payments.length, 10); assert.ok(st.payments.every((p) => D.isReal(p) && p.origin.file === 'releve.csv' && p.extId && p.extId.indexOf('dgd2:') === 0), 'provenance et identifiant stable sur chaque versement');
  const y = sum(st, { from: '2026-01-01', to: '2026-12-31' });
  // attendu (écrit à la main) : EUR AAA 40 + CCC 41 = 81 ; USD BBB 15,50 $ = 12,40 € → brut 93,40 ; retenues 12 + 10,82 + 2,33/1,25 (1,864) = 24,684 → 24,68 ; net 68,72
  assert.deepStrictEqual([y.count, y.gross, y.tax, y.net, y.netUnknown, y.taxUnknown], [9, 93.4, 24.68, 68.72, 0, 0]);
  assert.strictEqual(sum(st, { from: '2025-01-01', to: '2025-12-31' }).gross, 20, 'versement de 2025 compté dans 2025 seulement');
});

t('2. Réimporter le même fichier 1, 10, 100 fois : zéro doublon, résultat strictement identique', () => {
  const st = newState(); importStatement(st, stmt(FILE1), 'deg', 'releve.csv'); const ref = snapshot(st), tot = JSON.stringify(sum(st, {}));
  for (let i = 0; i < 100; i++) { const rep = importStatement(st, stmt(FILE1), 'deg', 'releve.csv'); assert.deepStrictEqual([rep.fresh, rep.known, rep.updated, rep.ignored, rep.stubs], [0, 10, 0, 0, 0], 'réimport n°' + (i + 1)); }
  assert.strictEqual(snapshot(st), ref, 'état identique octet pour octet'); assert.strictEqual(JSON.stringify(sum(st, {})), tot);
});

t('3. Importer 3 nouveaux dividendes dans un fichier qui contient aussi les 10 anciens : uniquement 3 versements de plus, anciens inchangés', () => {
  const st = newState(); importStatement(st, stmt(FILE1), 'deg', 'a.csv'); const before = JSON.stringify(st.payments);
  const rep = importStatement(st, stmt(FILE3), 'deg', 'b.csv');
  assert.deepStrictEqual([rep.fresh, rep.known, rep.stubs], [3, 10, 1]); assert.strictEqual(st.payments.length, 13);
  assert.strictEqual(JSON.stringify(st.payments.slice(0, 10)), before, 'les 10 premiers versements ne sont pas touchés (même provenance)');
  const y = sum(st, { from: '2026-01-01', to: '2026-12-31' }); assert.deepStrictEqual([y.count, y.gross, y.tax, y.net], [12, 117.9, 30.81, 87.09], 'attendu : +24,50 € brut, +6,13 € retenues (93,40 → 117,90 ; 24,68 → 30,81)');
});

/* =====================================================================
   SCÉNARIO 4 : deux versements légitimes de même montant et de même date
   ===================================================================== */
t('4. Deux versements légitimes identiques (même montant, même date) : les deux sont conservés, et un réimport n\'en ajoute aucun', () => {
  // (a) chemin CSV : pas d'identifiant courtier → empreinte + numéro d'occurrence
  const st = newState({ holdings: [{ id: 'h1', isin: 'FR0000000011', name: 'AAA SA', account: 'tr', currency: 'EUR' }] });
  const mk = () => [0, 1].map(() => ({ account: 'tr', holdingId: 'h1', isin: 'FR0000000011', name: 'AAA SA', payDate: '2026-05-05', currency: 'EUR', gross: 12, tax: 3, net: 9, source: 'csv', brokerId: null }));
  const run = (items) => { D.stableIds(items, 'csv'); const rec = D.reconcile(st, items, {}); return D.applyReconcile(st, rec, { uid, importId: 'x' }); };
  assert.deepStrictEqual([run(mk()).fresh, st.payments.length], [2, 2], 'les deux sont ajoutés'); assert.notStrictEqual(st.payments[0].extId, st.payments[1].extId);
  assert.deepStrictEqual([run(mk()).fresh, st.payments.length], [0, 2], 'réimport : aucun ajout');
  const three = mk().concat(mk().slice(0, 1)); assert.deepStrictEqual([run(three).fresh, st.payments.length], [1, 3], 'un 3e identique dans un fichier plus récent : un seul ajout');
  // (b) chemin relevé DEGIRO : deux lignes « Dividende » identiques le même jour = deux versements
  const st2 = newState(); const csv = stmt([['2026-05-05', 'AAA SA', 'FR0000000011', 'EUR', 7, 1], ['2026-05-05', 'AAA SA', 'FR0000000011', 'EUR', 7, 1]]);
  const rep = importStatement(st2, csv, 'deg', 'r.csv'); assert.deepStrictEqual([rep.fresh, st2.payments.length], [2, 2]); assert.deepStrictEqual(st2.payments.map((p) => [p.gross, p.tax, p.net]), [[7, 1, 6], [7, 1, 6]]);
  assert.strictEqual(importStatement(st2, csv, 'deg', 'r.csv').fresh, 0, 'réimport relevé : zéro doublon');
});

/* =====================================================================
   SCÉNARIOS 5-7 : droits théoriques (dû) selon achats / ventes ; versement après une vente
   ===================================================================== */
const buy = (id, h, date, qty) => ({ id, holdingId: h, date, type: 'buy', qty, price: 10, fees: 0, currency: 'EUR', amountAcct: qty * 10, acctCur: 'EUR', source: 'degiro' });
const sell = (id, h, date, qty) => ({ id, holdingId: h, date, type: 'sell', qty, price: 12, fees: 0, currency: 'EUR', amountAcct: qty * 12, acctCur: 'EUR', source: 'degiro' });
const ENT_TODAY = new Date(2026, 9, 28);
function entState() {
  const XYZ = { id: 'x', ticker: 'XYZ', displayTicker: 'XYZ', name: 'XYZ SA', isin: 'FR0000000099', type: 'stock', currency: 'EUR', quantity: 9, account: 'deg', dividend: {}, hist: { from: '2026-01', c: Array(10).fill(100) },
    divHist: { at: '2026-10-01', currency: 'EUR', items: [['2026-03-10', 1], ['2026-06-10', 1.5], ['2026-09-10', 2]] } };
  const CLO = { id: 'c', ticker: 'CLO', name: 'CLO SA', isin: 'FR0000000098', currency: 'EUR', quantity: 0, account: 'deg', closedAt: '2026-02-20', hist: { from: '2026-01', c: Array(10).fill(100) },
    divHist: { at: '2026-10-01', currency: 'EUR', items: [['2026-02-10', 1], ['2026-03-10', 1]] } };
  return newState({ holdings: [XYZ], archive: [CLO], transactions: [buy('t1', 'x', '2026-03-09', 10), buy('t2', 'x', '2026-03-10', 5), sell('t3', 'x', '2026-06-11', 6), buy('t4', 'c', '2026-01-05', 10), sell('t5', 'c', '2026-02-20', 10)] });
}
t('5. Achat AVANT le détachement : droit au dividende ; achat LE JOUR du détachement : pas de droit pour ce versement', () => {
  const r = D.entitled(entState(), ENT_TODAY, uid), by = (name, ex) => r.proposals.find((x) => x.name === name && x.exDate === ex);
  assert.deepStrictEqual([by('XYZ SA', '2026-03-10').qty, by('XYZ SA', '2026-03-10').gross], [10, 10], '10 titres achetés la veille × 1 € (les 5 achetés le jour du détachement ne comptent pas)');
});
t('6. Vente d\'une partie APRÈS le détachement : le droit acquis est conservé (quantité à la date de détachement), pas la quantité actuelle', () => {
  const r = D.entitled(entState(), ENT_TODAY, uid), by = (ex) => r.proposals.find((x) => x.name === 'XYZ SA' && x.exDate === ex);
  assert.deepStrictEqual([by('2026-06-10').qty, by('2026-06-10').gross], [15, 22.5], '15 titres détenus le 10/06 (vente de 6 le 11/06) × 1,50 €'); assert.deepStrictEqual([by('2026-09-10').qty, by('2026-09-10').gross], [9, 18], 'après la vente : 9 titres × 2 €');
});
t('7. Dividende perçu APRÈS une vente (même totale) : compté comme perçu ; le dû correspondant est rapproché, un détachement postérieur à la vente n\'ouvre aucun droit', () => {
  const st = entState();
  st.payments.push({ id: 'p1', holdingId: 'c', payDate: '2026-02-25', exDate: null, gross: 10, tax: 2, net: 8, currency: 'EUR', source: 'degiro', verified: true, extId: 'e1' },
    { id: 'p2', holdingId: 'x', payDate: '2026-06-20', gross: 22.5, tax: null, net: null, currency: 'EUR', source: 'degiro', verified: true, extId: 'e2' });
  const r = D.entitled(st, ENT_TODAY, uid);
  assert.ok(!r.proposals.some((x) => x.name === 'CLO SA'), 'CLO : le dû du 10/02 (10 titres détenus) est rapproché du versement réel ; celui du 10/03 n\'existe pas (position vendue le 20/02)');
  assert.ok(r.already.some((x) => x.name === 'CLO SA' && x.exDate === '2026-02-10' && x.qty === 10), 'dû 10/02 rapproché'); assert.ok(r.already.some((x) => x.name === 'XYZ SA' && x.exDate === '2026-06-10'));
  const y = sum(st, { from: '2026-01-01', to: '2026-12-31' }); assert.deepStrictEqual([y.count, y.gross, y.net, y.netUnknown], [2, 32.5, 8, 1], 'perçu = 10 + 22,5 ; net connu seulement pour CLO (8) ; l\'autre est signalé, jamais remplacé par le brut');
  assert.deepStrictEqual(y.byCompany.map((c) => [c.name, c.gross]), [['XYZ SA', 22.5], ['CLO SA', 10]]);
});

/* =====================================================================
   SCÉNARIOS 8-9 : devises étrangères, retenues, net inconnu
   ===================================================================== */
t('8. Dividende en dollars : converti au taux fourni ; sans taux, le versement est compté à part (« non converti »), jamais ignoré en silence ni compté 1:1', () => {
  const st = newState(); importStatement(st, stmt([['2026-02-20', 'BBB INC', 'US0000000012', 'USD', 10, 1.5], ['2026-03-01', 'AAA SA', 'FR0000000011', 'EUR', 4, 1]]), 'deg', 'f.csv');
  const a = sum(st, {}); assert.deepStrictEqual([a.gross, a.tax, a.net, a.unconverted], [12, 2.2, 9.8, 0], '10 $ / 1,25 = 8 € + 4 € = 12 € brut ; retenues 1,5/1,25 + 1 = 2,2 ; net 6,8 + 3 = 9,8');
  const b = sum(st, { convert: convEurOnly }); assert.deepStrictEqual([b.gross, b.unconverted, b.count], [4, 1, 1], 'le dollar n\'est pas converti : signalé, non compté');
  assert.strictEqual(st.payments.find((p) => p.currency === 'USD').gross, 10, 'le versement garde sa devise et son montant d\'origine');
});
t('9. Retenues fiscales : brut, retenue et net distincts ; sans retenue ni net connus le net reste INCONNU (jamais remplacé par le brut)', () => {
  const st = newState(); importStatement(st, stmt([['2026-04-01', 'AAA SA', 'FR0000000011', 'EUR', 100, 30], ['2026-05-01', 'AAA SA', 'FR0000000011', 'EUR', 50, null]]), 'deg', 'f.csv');
  const a = sum(st, {}); assert.deepStrictEqual([a.gross, a.tax, a.net, a.netUnknown, a.taxUnknown, a.netUnknownGross], [150, 30, 70, 1, 1, 50], 'net = 100 − 30 ; le versement de 50 € sans retenue connue n\'entre pas dans le net (signalé : 1, brut 50 €)');
  assert.deepStrictEqual(D.amounts({ gross: 100, tax: -30 }), { gross: 100, tax: 30, net: 70 }, 'retenue stockée en négatif : valeur absolue'); assert.deepStrictEqual(D.amounts({ gross: 100, net: 70 }), { gross: 100, tax: 30, net: 70 }, 'retenue déduite du net connu');
  assert.deepStrictEqual(D.amounts({ gross: 100 }), { gross: 100, tax: null, net: null });
});

/* =====================================================================
   SCÉNARIO 10 : plusieurs courtiers
   ===================================================================== */
t('10. Plusieurs courtiers : comptes indépendants (un relevé ne touche jamais la position d\'un autre compte), totaux par courtier et par entreprise', () => {
  const H = (id, acc) => ({ id, isin: 'FR0000000011', name: 'AAA SA', ticker: 'AAA', currency: 'EUR', quantity: 10, account: acc });
  const st = newState({ holdings: [H('hd', 'deg'), H('ht', 'tr')] });
  importStatement(st, stmt([['2026-04-15', 'AAA SA', 'FR0000000011', 'EUR', 10, 3]]), 'deg', 'degiro.csv');
  assert.deepStrictEqual(st.payments.map((p) => p.holdingId), ['hd'], 'rattaché à la position du compte DEGIRO, pas à celle de Trade Republic');
  const tr = [{ account: 'tr', holdingId: 'ht', isin: 'FR0000000011', name: 'AAA SA', payDate: '2026-04-15', currency: 'EUR', gross: 20, tax: null, net: 20, source: 'csv', brokerId: '0573ed03-1d4d-435e-a0cd-5a810eb5711f' }];
  D.stableIds(tr, 'csv'); D.applyReconcile(st, D.reconcile(st, tr, {}), { uid, importId: 't' });
  const y = sum(st, {}); assert.deepStrictEqual(y.byBroker.map((b) => [b.name, b.gross, b.net]), [['Trade Republic', 20, 20], ['DEGIRO', 10, 7]]);
  assert.strictEqual(y.byCompany.length, 1, 'une seule entreprise (même ISIN)'); assert.deepStrictEqual([y.byCompany[0].count, y.byCompany[0].gross, y.byCompany[0].brokers.sort()], [2, 30, ['DEGIRO', 'Trade Republic']]);
  assert.strictEqual(sum(st, { accounts: new Set(['tr']) }).gross, 20, 'filtre par compte');
  // même versement (même date, même montant) dans deux comptes différents : deux versements, aucun rapprochement entre comptes
  const dup = [Object.assign({}, tr[0], { account: 'deg', holdingId: 'hd', brokerId: null, gross: 10, tax: 3, net: 7 })]; D.stableIds(dup, 'dgd2');
  assert.strictEqual(D.reconcile(st, dup, {}).fresh.length, 0, 'le versement DEGIRO de 10 € déjà connu (même identifiant) n\'est pas dupliqué');
});

/* =====================================================================
   SCÉNARIO 11 : changement d'année
   ===================================================================== */
t('11. Changement d\'année : le perçu de l\'année = versements payés du 1er janvier au 31 décembre (date de paiement) ; série mensuelle et série annuelle cohérentes', () => {
  const st = newState(); importStatement(st, stmt([['2025-12-31', 'AAA SA', 'FR0000000011', 'EUR', 10, 3], ['2026-01-01', 'AAA SA', 'FR0000000011', 'EUR', 20, 6], ['2026-01-31', 'BBB INC', 'US0000000012', 'USD', 5, 0.75], ['2026-12-31', 'CCC AG', 'DE0000000013', 'EUR', 8, 2]]), 'deg', 'f.csv');
  const y25 = sum(st, { from: '2025-01-01', to: '2025-12-31', year: 2025 }), y26 = sum(st, { from: '2026-01-01', to: '2026-12-31', year: 2026 });
  assert.deepStrictEqual([y25.count, y25.gross, y25.net], [1, 10, 7]); assert.deepStrictEqual([y26.count, y26.gross, y26.tax, y26.net], [3, 32, 8.6, 23.4], 'attendu : 20 + 5/1,25 + 8 = 32 € brut ; retenues 6 + 0,6 + 2 = 8,6 ; net 14 + 3,4 + 6 = 23,4');
  assert.deepStrictEqual([y26.byMonth[0].count, y26.byMonth[0].gross, y26.byMonth[11].gross, y26.byMonth[5].count], [2, 24, 8, 0], 'janvier : 20 + 4 ; décembre : 8');
  const yearly = E.yearlySeries(st, 'gross', conv, null); assert.deepStrictEqual(yearly.map((x) => [x.year, x.total, x.unverified]), [[2025, 10, 0], [2026, 32, 0]]);
  assert.strictEqual(E.receivedBetween(st, '2026-01-01', '2026-06-30', 'net', conv, null).total, 17.4, 'receivedBetween du moteur = mêmes versements : net 14 + 3,4');
});

/* =====================================================================
   SCÉNARIO 12 : actualisations successives
   ===================================================================== */
t('12. Actualiser plusieurs fois (cours, prévisions, réimport du relevé) : les versements perçus et leur total ne changent JAMAIS ; seules les prévisions bougent, et elles ne s\'ajoutent pas au perçu', () => {
  const H = { id: 'h', isin: 'FR0000000011', name: 'AAA SA', ticker: 'AAA', displayTicker: 'AAA', type: 'stock', currency: 'EUR', quantity: 10, account: 'deg', price: 100, dividend: { lastAmount: 1, anchorMonth: 2, frequency: 'quarterly', dateKind: 'pay' } };
  const st = newState({ holdings: [H] }); importStatement(st, stmt(FILE1.slice(0, 4)), 'deg', 'r.csv');
  const ref = JSON.stringify(st.payments), tot = JSON.stringify(sum(st, { from: '2026-01-01', to: '2026-12-31' })); const run0 = E.runRate(st, 'gross', conv, null).total;
  for (let i = 1; i <= 5; i++) {
    H.price = 100 + i; H.dividend = { lastAmount: i, anchorMonth: (i % 12) + 1, frequency: i % 2 ? 'quarterly' : 'semiannual', dateKind: 'pay' };       // une actualisation du marché réécrit cours et prévisions
    importStatement(st, stmt(FILE1.slice(0, 4)), 'deg', 'r.csv');
    assert.strictEqual(JSON.stringify(st.payments), ref, 'actualisation n°' + i + ' : versements inchangés'); assert.strictEqual(JSON.stringify(sum(st, { from: '2026-01-01', to: '2026-12-31' })), tot);
    assert.strictEqual(E.receivedBetween(st, '2026-01-01', '2026-12-31', 'gross', conv, null).total, 40, 'le perçu du moteur ne bouge pas');
  }
  assert.notStrictEqual(E.runRate(st, 'gross', conv, null).total, run0, 'les prévisions, elles, dépendent bien des données de marché (catégorie C, séparée)');
});

/* =====================================================================
   COMPLÉMENTS : classification, rapprochement avec d'anciennes données, révisions, migration réversible
   ===================================================================== */
t('Classification : seuls relevés / CSV / saisie sont du perçu ; estimations, brouillons « auto » et « à vérifier » ne le sont jamais ; un versement orphelin n\'est pas compté', () => {
  const st = newState({ holdings: [{ id: 'h', name: 'AAA', currency: 'EUR', account: 'deg' }], payments: [
    { id: '1', holdingId: 'h', payDate: '2026-01-02', gross: 1, source: 'degiro', verified: true }, { id: '2', holdingId: 'h', payDate: '2026-01-03', gross: 2, source: 'csv', verified: true }, { id: '3', holdingId: 'h', payDate: '2026-01-04', gross: 4, source: 'manual', verified: true },
    { id: '4', holdingId: 'h', payDate: '2026-01-05', gross: 8, source: 'auto', verified: true }, { id: '5', holdingId: 'h', exDate: '2026-01-06', gross: 16, source: 'market-history', estimated: true, verified: true },
    { id: '6', holdingId: 'h', payDate: '2026-01-07', gross: 32, source: 'manual', verified: false }, { id: '7', holdingId: 'gone', payDate: '2026-01-08', gross: 64, source: 'degiro', verified: true }] });
  assert.deepStrictEqual(D.realPayments(st).map((p) => p.id), ['1', '2', '3']); assert.strictEqual(sum(st, {}).gross, 7, '1 + 2 + 4 : aucune estimation, aucun orphelin'); assert.strictEqual(D.estimatesOf(st).length, 3, 'estimations : « auto », « market-history » et « à vérifier »');
});
t('Données déjà importées avant l\'identifiant stable : adoptées (même position, date et brut), jamais dupliquées ; ancien identifiant « dgd: » reconnu ; montant modifié par le courtier = mise à jour avec révision conservée', () => {
  const st = newState({ holdings: [{ id: 'h', isin: 'FR0000000011', name: 'AAA SA', account: 'deg', currency: 'EUR' }] });
  const legacy = L.legacyStatementId('h', '2026-04-15', 'EUR', 10);
  st.payments.push({ id: 'old1', holdingId: 'h', payDate: '2026-04-15', gross: 10, tax: 3, net: 7, currency: 'EUR', source: 'degiro', verified: true, extId: legacy }, { id: 'old2', holdingId: 'h', payDate: '2026-07-15', gross: 10, tax: 3, net: 7, currency: 'EUR', source: 'manual', verified: true });
  const rep = importStatement(st, stmt([['2026-04-15', 'AAA SA', 'FR0000000011', 'EUR', 10, 3], ['2026-07-15', 'AAA SA', 'FR0000000011', 'EUR', 10, 3]]), 'deg', 'f.csv');
  assert.deepStrictEqual([rep.fresh, rep.known, rep.adopted, st.payments.length], [0, 1, 1, 2], 'ancien identifiant reconnu (1), saisie manuelle identique adoptée (1) : aucun doublon');
  // correction du courtier : même identifiant impossible (le brut fait partie de l'empreinte) → le versement corrigé est un NOUVEAU versement ; la révision ne s'applique qu'à un identifiant courtier identique
  const tr = [{ account: 'deg', holdingId: 'h', payDate: '2026-09-01', currency: 'EUR', gross: 5, tax: null, net: null, source: 'csv', brokerId: 'uuid-1' }]; D.stableIds(tr, 'csv'); D.applyReconcile(st, D.reconcile(st, tr, {}), { uid, importId: 'a' });
  const fix = [Object.assign({}, tr[0], { gross: 6, tax: 1, net: 5 })]; D.stableIds(fix, 'csv'); const rec = D.reconcile(st, fix, {}); assert.deepStrictEqual([rec.fresh.length, rec.updated.length], [0, 1]);
  D.applyReconcile(st, rec, { uid, importId: 'b' }); const p = st.payments.find((x) => x.extId === 'uuid-1'); assert.deepStrictEqual([p.gross, p.tax, p.net, p.revisions.length, p.revisions[0].before.gross], [6, 1, 5, 1, 5], 'mise à jour avec historique de révision'); assert.strictEqual(st.payments.length, 3);
  // lignes invalides : ignorées et signalées
  const bad = [{ account: 'deg', holdingId: 'h', payDate: '', currency: 'EUR', gross: 5, source: 'csv', brokerId: 'z1' }, { account: 'deg', holdingId: 'h', payDate: '2026-01-01', currency: 'EUR', gross: 0, source: 'csv', brokerId: 'z2' }]; const rb = D.reconcile(st, bad, {}); assert.deepStrictEqual([rb.ignored.length, rb.fresh.length], [2, 0]);
});
t('Migration réversible : estimations rangées à part (rien de supprimé), orphelins rattachés, brut Trade Republic corrigé ; totaux perçus inchangés par le rangement ; annulation = état d\'origine exact', () => {
  const st = newState({ holdings: [{ id: 'h', isin: 'FR0000000011', name: 'AAA SA', account: 'deg', currency: 'EUR' }], payments: [
    { id: 'r1', holdingId: 'h', payDate: '2026-04-15', gross: 10, tax: 3, net: 7, currency: 'EUR', source: 'degiro', verified: true, extId: 'k1' },
    { id: 'e1', holdingId: 'h', exDate: '2026-01-10', gross: 10, currency: 'EUR', source: 'market-history', estimated: true, verified: true }, { id: 'e2', holdingId: 'h', payDate: '2026-02-10', gross: 11, currency: 'EUR', source: 'auto', verified: true },
    { id: 'o1', holdingId: 'gone', ticker: 'FR0000000011', name: 'AAA SA', payDate: '2026-07-15', gross: 10, tax: 3, net: 7, currency: 'EUR', source: 'csv', verified: true, extId: 'k2' },
    { id: 'tr1', holdingId: 'h', payDate: '2026-05-08', qty: 12, gross: 37.91, tax: 7.91, net: 30, currency: 'EUR', source: 'csv', verified: true, extId: '0573ed03-1d4d-435e-a0cd-5a810eb5711f' }] });
  const before = JSON.stringify(st), perçu = sum(st, {}).gross; assert.strictEqual(perçu, 10 + 37.91, 'avant : réels sans orphelin ni estimation (r1 + tr1)');
  const plan = D.planMigration(st); assert.deepStrictEqual([plan.estimates.length, plan.items.map((i) => i.kind).sort()], [2, ['orphan_relink', 'tr_gross']]); assert.strictEqual(JSON.stringify(st), before, 'la simulation ne modifie rien');
  const rep = D.applyMigration(st, plan, { uid, at: '2026-10-30T10:00:00Z', id: 'm1' }); assert.deepStrictEqual(rep, { relinked: 1, stubs: 0, regrossed: 1, estimatesMoved: 2 });
  assert.deepStrictEqual(st.payments.map((p) => p.id).sort(), ['o1', 'r1', 'tr1']); assert.deepStrictEqual(st.estimates.map((p) => p.id).sort(), ['e1', 'e2'], 'estimations conservées (catégorie dû), pas supprimées');
  assert.strictEqual(st.payments.find((p) => p.id === 'o1').holdingId, 'h'); const tr1 = st.payments.find((p) => p.id === 'tr1'); assert.deepStrictEqual([tr1.gross, tr1.net, tr1.tax], [30, 22.09, 7.91]);
  assert.strictEqual(sum(st, {}).gross, 10 + 10 + 30, 'après : r1 + o1 rattaché (10) + tr1 corrigé (30)'); assert.strictEqual(D.planMigration(st).empty, true, 'migration idempotente : plus rien à faire');
  assert.strictEqual(D.undoMigration(st, st.migrations[0].id), true); assert.strictEqual(JSON.stringify(Object.assign({}, st, { migrations: [] })), JSON.stringify(Object.assign(JSON.parse(before), { migrations: [] })), 'annulation : état d\'origine rétabli');
});

console.log('\n' + n + ' tests réussis' + (failed ? ', ' + failed + ' échec(s)' : ''));
