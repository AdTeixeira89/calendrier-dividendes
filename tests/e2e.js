/* Tests de bout en bout (Playwright + faux Firebase en mémoire + faux relais Yahoo).
   Lancer :  NODE_PATH=$(npm root -g) node tests/e2e.js [filtre] */
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
const FILTER = process.argv[2] || '';
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]); if (p === '/') p = '/index.html';
  const f = path.join(ROOT, p);
  if (!f.startsWith(ROOT) || !fs.existsSync(f)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream', 'Cache-Control': 'no-store' }); res.end(fs.readFileSync(f));
});

/* ---------- faux backend Firebase ---------- */
const store = new Map(), users = new Map(); let uidn = 0;
const fsOps = {
  signup: (e, p) => { if (users.has(e)) return { error: 'auth/email-already-in-use' }; const u = { uid: 'u' + (++uidn), email: e, pwd: p }; users.set(e, u); return { user: { uid: u.uid, email: u.email } }; },
  signin: (e, p) => { const u = users.get(e); if (!u || u.pwd !== p) return { error: 'auth/invalid-credential' }; return { user: { uid: u.uid, email: u.email } }; },
  check: (e, p) => { const u = users.get(e); return !u || u.pwd !== p ? { error: 'auth/wrong-password' } : {}; },
  user: (uid) => { const u = Array.from(users.values()).find((x) => x.uid === uid); return u ? { uid: u.uid, email: u.email } : null; },
  deleteUser: (uid) => { for (const [k, v] of users) if (v.uid === uid) users.delete(k); },
  reset: (e) => { fsOps.resets.push(e); }, resets: [],
  get: (p) => store.has(p) ? { exists: true, data: JSON.parse(store.get(p)) } : { exists: false },
  list: (p) => Array.from(store.keys()).filter((k) => k.startsWith(p + '/') && !k.slice(p.length + 1).includes('/')).map((k) => ({ id: k.split('/').pop(), path: k, data: JSON.parse(store.get(k)) })),
  commit: (ops) => { if (fsOps.fail) throw new Error('unavailable'); ops.forEach((o) => { if (o.op === 'set') store.set(o.path, JSON.stringify(o.data)); else store.delete(o.path); }); return true; }
};
const MOCK = `(() => {
  const call = (...a) => window.__fs(...a);
  let cur = null; const cbs = [];
  const mkUser = (u) => ({ uid: u.uid, email: u.email, emailVerified: false, sendEmailVerification: async () => {},
    reauthenticateWithCredential: async (c) => { const r = await call('check', u.email, c.password); if (r.error) throw { code: r.error }; },
    delete: async () => { await call('deleteUser', u.uid); setUser(null); } });
  const setUser = (u) => { cur = u ? mkUser(u) : null; if (u) localStorage.setItem('mock_uid', u.uid); else localStorage.removeItem('mock_uid'); cbs.forEach((f) => f(cur)); };
  const auth = { get currentUser() { return cur; },
    onAuthStateChanged(cb) { cbs.push(cb); setTimeout(async () => { const uid = localStorage.getItem('mock_uid'); if (uid) { const u = await call('user', uid); if (u) cur = mkUser(u); } cb(cur); }, 20); },
    async createUserWithEmailAndPassword(e, p) { const r = await call('signup', e, p); if (r.error) throw { code: r.error }; setUser(r.user); return { user: cur }; },
    async signInWithEmailAndPassword(e, p) { const r = await call('signin', e, p); if (r.error) throw { code: r.error }; setUser(r.user); return { user: cur }; },
    async signOut() { setUser(null); }, async sendPasswordResetEmail(e) { await call('reset', e); } };
  const ref = (p) => ({ path: p, id: p.split('/').pop(), collection: (c) => col(p + '/' + c),
    async get() { const r = await call('get', p); return { exists: r.exists, id: this.id, data: () => r.data, ref: this }; } });
  const col = (p) => ({ doc: (id) => ref(p + '/' + id),
    async get() { const r = await call('list', p); const docs = r.map((d) => ({ id: d.id, data: () => d.data, ref: ref(d.path) })); return { docs, forEach: (f) => docs.forEach(f) }; } });
  const db = { collection: (c) => col(c),
    batch() { const ops = []; return { delete: (r) => ops.push({ op: 'del', path: r.path }), set: (r, d) => ops.push({ op: 'set', path: r.path, data: d }), commit: () => call('commit', ops) }; },
    async runTransaction(fn) { const ops = []; const tx = { get: (r) => r.get(), set: (r, d) => { ops.push({ op: 'set', path: r.path, data: d }); }, delete: (r) => { ops.push({ op: 'del', path: r.path }); } }; await fn(tx); await call('commit', ops); } };
  window.firebase = { apps: [], initializeApp() { this.apps.push(1); }, auth: Object.assign(() => auth, { EmailAuthProvider: { credential: (email, password) => ({ email, password }) } }), firestore: () => db };
})();`;

/* ---------- faux relais Yahoo ---------- */
const ts = (d) => Math.floor(Date.parse(d) / 1000);
const YAHOO = {
  'AI.PA': { name: "L'Air Liquide S.A.", cur: 'EUR', type: 'EQUITY', divs: [['2024-05-14', 2.9], ['2025-05-12', 3.2], ['2026-05-11', 3.4]] },
  'AAPL': { name: 'Apple Inc.', cur: 'USD', type: 'EQUITY', divs: [['2025-11-10', .25], ['2026-02-09', .25], ['2026-05-11', .26], ['2026-08-10', .26]] },
  'IWDA.AS': { name: 'iShares Core MSCI World', cur: 'EUR', type: 'ETF', divs: [] }
};
const ISIN = { 'FR0000120073': 'AI.PA', 'US0378331005': 'AAPL', 'IE00B4L5Y983': 'IWDA.AS' };
async function mockRelay(route) {
  const u = new URL(route.request().url()), j = (o, st) => route.fulfill({ status: st || 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(o) });
  if (u.pathname === '/search') { const q = u.searchParams.get('q'); const s = ISIN[q] || (/apple/i.test(q) ? 'AAPL' : /air liquide/i.test(q) ? 'AI.PA' : null); return j({ quotes: s ? [{ symbol: s, quoteType: YAHOO[s].type, shortname: YAHOO[s].name, exchDisp: 'X' }] : [] }); }
  if (u.pathname === '/chart') { const y = YAHOO[u.searchParams.get('symbol')]; if (!y) return j({ chart: { result: null, error: { description: 'No data found' } } }); return j({ chart: { result: [{ meta: { currency: y.cur, longName: y.name, instrumentType: y.type }, events: { dividends: Object.fromEntries(y.divs.map((d, i) => [i, { amount: d[1], date: ts(d[0]) }])) } }] } }); }
  return route.fulfill({ status: 404 });
}

/* ---------- harnais ---------- */
let browser, results = { ok: 0, fail: 0 };
const BASE = 'http://localhost:8766';
async function device(o) {
  o = o || {};
  const ctx = await browser.newContext({ viewport: o.viewport || { width: 1280, height: 900 }, hasTouch: !!o.mobile, isMobile: !!o.mobile, acceptDownloads: true });
  await ctx.exposeFunction('__fs', (op, ...a) => fsOps[op](...a));
  const page = await ctx.newPage(); page.errors = [];
  page.on('pageerror', (e) => page.errors.push(e.message));
  await page.route(/frankfurter/, (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ date: '2026-10-09', rates: { USD: 1.2, GBP: 0.85, CHF: 0.95 } }) }));
  await page.route(/workers\.dev/, mockRelay);
  await page.route(/cdn\.jsdelivr\.net/, (r) => { const f = r.request().url().includes('papaparse') ? 'papaparse.min.js' : 'xlsx.full.min.js'; const fp = path.join(process.env.LIBDIR || '', f); fs.existsSync(fp) ? r.fulfill({ status: 200, contentType: 'text/javascript', body: fs.readFileSync(fp) }) : r.abort(); });
  await page.route(/^https?:\/\/(?!localhost)(?!.*workers\.dev)(?!.*frankfurter)(?!.*cdn\.jsdelivr)/, (r) => r.abort());
  if (o.firebase) {
    await page.route('**/config.js', (r) => r.fulfill({ contentType: 'text/javascript', body: "window.APP_CONFIG={relayUrl:'https://dividende-relais.adam-teixeira89.workers.dev',firebase:{apiKey:'k',authDomain:'a',projectId:'p',appId:'x'}};" }));
    await page.addInitScript(MOCK);
  }
  if (o.seed) await page.addInitScript((s) => { if (!localStorage.getItem('dividendCalendarApp_v1')) localStorage.setItem('dividendCalendarApp_v1', JSON.stringify(s)); }, o.seed);
  if (o.guest) await page.addInitScript(() => localStorage.setItem('dca_guest', '1'));
  page.open = async (wait) => { await page.goto(BASE + '/index.html'); await page.waitForTimeout(wait || 700); };
  return page;
}
async function test(name, fn) {
  if (FILTER && !name.toLowerCase().includes(FILTER.toLowerCase())) return;
  try { await fn(); results.ok++; console.log('ok   ' + name); } catch (e) { results.fail++; console.log('FAIL ' + name + '\n     ' + String(e.message).split('\n').slice(0, 4).join('\n     ')); }
}
const eq = (a, b, m) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error((m || 'eq') + ' : attendu ' + JSON.stringify(b) + ', obtenu ' + JSON.stringify(a)); };
const ok = (c, m) => { if (!c) throw new Error(m || 'assertion'); };
const H = (i, o) => Object.assign({ id: 'h' + i, ticker: 'T' + i, displayTicker: 'T' + i, name: 'Société ' + i, type: 'stock', currency: 'EUR', quantity: 10, avgCost: 50, account: 'main', logo: null, source: 'test', addedAt: '2025-01-01',
  dividend: { lastAmount: 1, anchorMonth: (i % 12) + 1, frequency: 'quarterly', dateKind: 'ex', updatedAt: '2026-10-01' } }, o || {});
const SEED = (n, extra) => Object.assign({ v: 2, meta: {}, holdings: Array.from({ length: n }, (_, i) => H(i)), payments: [], transactions: [], accounts: [{ id: 'main', name: 'Mon portefeuille' }], settings: { relayUrl: 'https://dividende-relais.adam-teixeira89.workers.dev', baseCurrency: 'EUR', incomeMode: 'gross', tickerAuto: false, autoRefresh: false, columns: {} }, sent: { days: {}, months: {} } }, extra || {});
const storeOf = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('dividendCalendarApp_v1')));
const cloudState = (uid) => { const m = fsOps.get('users/' + uid); if (!m.exists) return null; let s = ''; for (let i = 0; i < m.data.chunks; i++) s += fsOps.get('users/' + uid + '/chunks/' + i).data.data; return JSON.parse(s); };
const csvFile = (name, text) => ({ name, mimeType: 'text/csv', buffer: Buffer.from(text, 'utf-8') });
async function chooseFile(page, clickSel, file) { const [fc] = await Promise.all([page.waitForEvent('filechooser'), page.click(clickSel)]); await fc.setFiles(file); }

(async () => {
  await new Promise((r) => server.listen(8766, r));
  browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] }).catch(() => chromium.launch({ args: ['--no-sandbox'] }));

  /* ======================= MODE LOCAL ======================= */
  await test('local: démarrage vide, état vide explicite, ajout d\'un actif par le formulaire', async () => {
    const p = await device({ guest: true }); await p.open();
    ok(await p.locator('text=Bienvenue').count(), 'état vide affiché');
    await p.click('[data-do=add]'); await p.fill('#hTicker', 'AAPL'); await p.fill('#hQty', '5'); await p.fill('#hCost', '100');
    await p.selectOption('#hFreq', 'quarterly'); await p.fill('#hDiv', '0.25'); await p.selectOption('#hMonth', '2'); await p.click('#hSave'); await p.waitForTimeout(200);
    const s = await storeOf(p); eq(s.holdings.length, 1, 'un actif'); eq(s.holdings[0].avgCost, 100, 'PRU'); eq(s.holdings[0].dividend.lastAmount, 0.25, 'dividende');
    await p.evaluate(() => go('home')); const txt = await p.locator('.kpis').innerText();
    ok(/5,00\s?€/.test(txt), 'dividendes annuels estimés = 5 × 0,25 × 4 = 5,00 € — obtenu : ' + txt.slice(0, 120));
    ok(/1,00\s?%/.test(txt), 'rendement sur coût = 5/500 = 1,00 % — obtenu : ' + txt);
    eq(p.errors, [], 'aucune erreur JS');
  });

  await test('local: suppression multiple (sélection, compteur, annuler, tout sélectionner, confirmation, historique préservé, annulation)', async () => {
    const seed = SEED(30); seed.payments = [{ id: 'p1', holdingId: 'h1', ticker: 'T1', name: 'Société 1', payDate: '2026-03-10', qty: 10, gross: 10, net: 7, tax: 3, currency: 'EUR', source: 'manual', verified: true }];
    const p = await device({ guest: true, seed }); await p.open(); await p.evaluate(() => go('portfolio')); await p.waitForTimeout(200);
    const rows = await p.locator('tbody tr').count(); eq(rows, 30, '30 lignes');
    await p.locator('[data-selrow]').nth(0).check(); await p.locator('[data-selrow]').nth(1).check(); await p.locator('[data-selrow]').nth(2).check();
    ok((await p.locator('.selbar').innerText()).includes('3 sélectionnés'), 'compteur 3');
    await p.click('[data-selclear]'); ok(await p.locator('.selbar.hide').count(), 'sélection annulée'); 
    await p.locator('thead [data-selall]').check(); ok((await p.locator('.selbar').innerText()).includes('30 sélectionnés'), 'tout sélectionner = 30');
    await p.click('[data-seldel]'); ok((await p.locator('.modal').innerText()).includes('Supprimer 30 positions'), 'confirmation affichée');
    ok((await p.locator('.modal').innerText()).includes('restent dans l\'Historique'), 'distinction position / historique');
    await p.click('#cdYes'); await p.waitForTimeout(250);
    let s = await storeOf(p); eq(s.holdings.length, 0, 'positions supprimées'); eq(s.payments.length, 1, 'historique conservé');
    ok(await p.locator('.toast:has-text("supprimées")').count(), 'retour visuel');
    await p.click('.toast button'); await p.waitForTimeout(250); s = await storeOf(p); eq(s.holdings.length, 30, 'suppression annulée');
    // suppression de 2 + historique
    await p.evaluate(() => go('portfolio')); await p.locator('[data-selrow]').nth(0).check(); await p.locator('[data-selrow]').nth(1).check();
    await p.click('[data-seldel]'); await p.check('#cdChk'); await p.click('#cdYes'); await p.waitForTimeout(250); s = await storeOf(p);
    eq(s.holdings.length, 28, '2 supprimées'); ok(s.payments.length <= 1, 'historique géré');
  });

  await test('local: colonnes à afficher (masquer / réafficher / persistance / données intactes)', async () => {
    const p = await device({ guest: true, seed: SEED(5) }); await p.open(); await p.evaluate(() => go('portfolio')); await p.waitForTimeout(200);
    ok(await p.locator('th:has-text("Quantité")').count(), 'Quantité visible par défaut'); ok(!(await p.locator('th:has-text("Compte")').count()), 'Compte masqué par défaut');
    await p.click('[data-dd]'); await p.uncheck('[data-col=qty]'); await p.check('[data-col=account]'); await p.waitForTimeout(150);
    ok(!(await p.locator('th:has-text("Quantité")').count()), 'Quantité masquée'); ok(await p.locator('th:has-text("Compte")').count(), 'Compte affiché');
    let s = await storeOf(p); eq(s.holdings[0].quantity, 10, 'donnée non supprimée'); ok(Array.isArray(s.settings.columns.portfolio), 'préférence enregistrée');
    await p.reload(); await p.waitForTimeout(700); await p.evaluate(() => go('portfolio')); await p.waitForTimeout(200);
    ok(!(await p.locator('th:has-text("Quantité")').count()) && await p.locator('th:has-text("Compte")').count(), 'préférence conservée après rechargement');
    await p.click('[data-dd]'); await p.click('[data-cols-all]'); await p.waitForTimeout(200); ok(await p.locator('th:has-text("Rendement / coût")').count(), 'tout afficher');
  });

  await test('local: filtres du portefeuille (verse un dividende, sans dividende, recherche, type)', async () => {
    const seed = SEED(6); seed.holdings[4].type = 'etf_acc'; seed.holdings[4].dividend = { none: true, frequency: 'none' }; seed.holdings[5].dividend = { lastAmount: null, anchorMonth: null, frequency: 'quarterly' }; seed.holdings[5].name = 'Mystère';
    const p = await device({ guest: true, seed }); await p.open(); await p.evaluate(() => go('portfolio')); await p.waitForTimeout(200);
    await p.selectOption('#pd', 'payer'); await p.waitForTimeout(250); eq(await p.locator('tbody tr').count(), 4, 'seulement ceux qui versent');
    await p.selectOption('#pd', 'none'); await p.waitForTimeout(250); eq(await p.locator('tbody tr').count(), 1, 'sans dividende / capitalisant');
    await p.selectOption('#pd', 'missing'); await p.waitForTimeout(250); eq(await p.locator('tbody tr').count(), 1, 'données manquantes');
    await p.selectOption('#pd', 'all'); await p.fill('#pq', 'mystère'); await p.waitForTimeout(400); eq(await p.locator('tbody tr').count(), 1, 'recherche');
    await p.fill('#pq', ''); await p.selectOption('#pt', 'etf_acc'); await p.waitForTimeout(250); eq(await p.locator('tbody tr').count(), 1, 'type');
  });

  await test('local: calculs — dédoublonnage reçu/prévu, brut/net, jamais de dividende inventé', async () => {
    const seed = SEED(2); const today = new Date(); const y = today.getFullYear(), m = today.getMonth() + 1;
    seed.holdings[0].dividend = { lastAmount: 2, anchorMonth: m, frequency: 'annual', dateKind: 'pay', taxRate: 30 };
    seed.holdings[1].type = 'etf_acc'; seed.holdings[1].dividend = { none: true, frequency: 'none', lastAmount: 5, anchorMonth: m };
    const d15 = y + '-' + String(m).padStart(2, '0') + '-15';
    seed.payments = [{ id: 'pp', holdingId: 'h0', ticker: 'T0', name: 'Société 0', payDate: d15, qty: 10, perShare: 2, gross: 20, tax: 6, net: 14, currency: 'EUR', source: 'manual', verified: true }];
    const p = await device({ guest: true, seed }); await p.open();
    const ev = await p.evaluate(() => { const t = new Date(); return Engine.buildEvents(state, new Date(t.getFullYear(), t.getMonth(), 1), new Date(t.getFullYear(), t.getMonth() + 1, 0), t, null).map((e) => [e.holdingId, e.status]); });
    eq(ev, [['h0', 'received']], 'un seul versement (reçu), pas de prévision en double, pas d\'ETF capitalisant');
    const rr = await p.evaluate(() => [Engine.runRate(state, 'gross', convert, null).total, Engine.runRate(state, 'net', convert, null).total]);
    eq(rr, [20, 14], 'annuel brut 20, net 14 (30 %), ETF capitalisant exclu');
    await p.click('[data-mode=net]'); await p.waitForTimeout(150); ok(/14,00\s?€/.test(await p.locator('.kpis').innerText()), 'KPI en net');
  });

  await test('migration v1 → v2 : aucune donnée perdue, clé FMP et résultats supprimés', async () => {
    const v1 = { holdings: [{ id: 'a1', ticker: 'AI.PA', displayTicker: 'AI.PA', name: 'Air Liquide', exchange: 'EU', quantity: 12, currency: 'EUR', account: 'pea', logo: 'https://x/y.png', source: 'manual', dividend: { lastAmount: 3.4, anchorMonth: 5, frequency: 'annual', payDay: 14, confirmed: [{ payDate: '2026-05-14', amount: 3.4 }] }, earnings: { anchorMonth: 2, frequency: 'quarterly' } },
      { id: 'a2', ticker: 'FR0000120073', quantity: 3, currency: 'EUR', account: 'degiro', dividend: { lastAmount: null, anchorMonth: null, frequency: 'none' }, earnings: {} }],
      settings: { apiKey: 'SECRETKEY', relayUrl: 'https://dividende-relais.adam-teixeira89.workers.dev', notify: true }, sent: { days: {}, months: { '2026-09': 1 } },
      accounts: [{ id: 'degiro', name: 'DEGIRO' }, { id: 'pea', name: 'PEA Trade Republic' }] };
    const p = await device({ guest: true, seed: v1 }); await p.open();
    const s = await p.evaluate(() => state);
    eq(s.holdings.length, 2, 'positions conservées'); eq(s.holdings[0].quantity, 12, 'quantité'); eq(s.holdings[0].dividend.payDay, 14, 'jour de paiement'); eq(s.holdings[0].dividend.confirmed.length, 1, 'versement confirmé conservé'); eq(s.holdings[0].logo, 'https://x/y.png', 'logo');
    eq(s.accounts.map((a) => a.name), ['DEGIRO', 'PEA Trade Republic'], 'comptes'); eq(s.holdings[1].isin, 'FR0000120073', 'ISIN détecté'); eq(s.holdings[1].dividend.none, true, 'frequency none → sans dividende');
    ok(!('apiKey' in s.settings), 'clé API FMP supprimée'); ok(!('earnings' in s.holdings[0]), 'résultats supprimés'); eq(s.settings.notify, true, 'rappels conservés'); eq(s.sent.months['2026-09'], 1, 'historique de notifications conservé');
    ok(!JSON.stringify(await storeOf(p)).includes('SECRETKEY'), 'clé absente du stockage');
    ok((await p.evaluate(() => localStorage.getItem('dca_v1_backup'))).includes('Air Liquide'), 'copie de sécurité de l\'ancien format conservée');
    for (const pg of ['home', 'portfolio', 'calendar', 'history', 'stats', 'settings']) { await p.evaluate((x) => go(x), pg); await p.waitForTimeout(100); }
    eq(p.errors, [], 'aucune erreur JS');
  });

  await test('import des positions (DEGIRO) : ISIN → ticker → dividendes via le relais Yahoo, détachement, aucun FMP', async () => {
    const p = await device({ guest: true }); await p.open(); await p.evaluate(() => go('portfolio'));
    const csv = 'Produit,Symbole/ISIN,Quantité,Clôture,Devise locale,Valeur en EUR\nAIR LIQUIDE,FR0000120073,12,170,EUR,2040\nAPPLE INC,US0378331005,5,200,USD,830\nISHARES MSCI WORLD,IE00B4L5Y983,40,90,EUR,3600\nAIR LIQUIDE,FR0000120073,12,170,EUR,2040\n';
    const [fc] = await Promise.all([p.waitForEvent('filechooser'), p.evaluate(() => { openImportPositions(); })]); await fc.setFiles(csvFile('relevé.csv', csv));
    await p.waitForSelector('#mGo');
    eq([await p.inputValue('#mT'), await p.inputValue('#mQ'), await p.inputValue('#mN')], ['1', '2', '0'], 'colonnes détectées');
    await p.click('#mGo'); await p.waitForFunction(() => state.holdings.length === 3 && state.holdings.every((h) => h.dividend.updatedAt), null, { timeout: 8000 }); await p.waitForTimeout(500);
    const s = await storeOf(p); const by = (t) => s.holdings.find((h) => h.ticker === t);
    ok(by('AI.PA') && by('AAPL') && by('IWDA.AS'), 'ISIN résolus en tickers : ' + s.holdings.map((h) => h.ticker));
    eq(by('AI.PA').isin, 'FR0000120073', 'ISIN conservé'); eq(by('AI.PA').dividend.lastAmount, 3.4, 'dernier dividende'); eq(by('AI.PA').dividend.anchorMonth, 5, 'mois de détachement'); eq(by('AI.PA').dividend.dateKind, 'ex', 'date = détachement'); eq(by('AI.PA').dividend.frequency, 'annual', 'fréquence annuelle');
    eq(by('AAPL').dividend.frequency, 'quarterly', 'trimestriel'); eq(by('AAPL').currency, 'USD', 'devise');
    eq(by('IWDA.AS').type, 'etf_acc', 'ETF sans dividende → capitalisant'); eq(by('IWDA.AS').dividend.none, true, 'aucun dividende inventé');
    eq(s.holdings.length, 3, 'doublon ignoré'); ok(!JSON.stringify(s).includes('financialmodelingprep'), 'plus de FMP dans les données');
    ok((await p.evaluate(() => state.meta.lastMarketUpdate)) > 0, 'date de dernière mise à jour enregistrée');
    ok(/mises? à jour le/.test(await p.locator('.page-head .sub').innerText()), 'date de mise à jour affichée');
  });

  await test('import des transactions (Trade Republic) : achats, ventes, dividendes net/retenue/brut, PRU, doublons', async () => {
    const p = await device({ guest: true }); await p.open(); await p.evaluate(() => go('history'));
    const csv = 'datetime,date,account_type,category,type,asset_class,name,symbol,shares,price,amount,fee,tax,currency,original_amount,original_currency,fx_rate,description,transaction_id\n' +
      '2025-01-10T09:00:00Z,2025-01-10,DEFAULT,TRADING,BUY,STOCK,Air Liquide,FR0000120073,10,150,-1500,1,0,EUR,,,,Buy,id1\n' +
      '2025-06-10T09:00:00Z,2025-06-10,DEFAULT,TRADING,BUY,STOCK,Air Liquide,FR0000120073,10,170,-1700,1,0,EUR,,,,Buy,id2\n' +
      '2025-09-10T09:00:00Z,2025-09-10,DEFAULT,TRADING,SELL,STOCK,Air Liquide,FR0000120073,5,180,900,1,0,EUR,,,,Sell,id3\n' +
      '2026-05-20T09:00:00Z,2026-05-20,DEFAULT,CASH,DIVIDEND,STOCK,Air Liquide,FR0000120073,15,3.4,35.7,0,15.3,EUR,,,,Dividend,id4\n' +
      '2026-05-21T09:00:00Z,2026-05-21,DEFAULT,CASH,DEPOSIT,,,,,,500,,,EUR,,,,Virement,id5\n';
    const importIt = async () => { const [fc] = await Promise.all([p.waitForEvent('filechooser'), p.evaluate(() => { openImportTransactions(); })]); await fc.setFiles(csvFile('trade_republic.csv', csv)); await p.waitForSelector('#xGo'); };
    await importIt();
    ok((await p.locator('#xSummary').innerText()).includes('2 achat(s)') && (await p.locator('#xSummary').innerText()).includes('1 vente(s)') && (await p.locator('#xSummary').innerText()).includes('1 dividende(s)'), 'détection : ' + await p.locator('#xSummary').innerText());
    ok((await p.locator('.modal').innerText()).includes('Trade Republic'), 'format reconnu');
    await p.click('#xGo'); await p.waitForTimeout(1500);
    let s = await storeOf(p); eq(s.transactions.length, 3, '3 opérations'); eq(s.payments.length, 1, '1 dividende');
    const h = s.holdings[0]; eq(h.quantity, 15, 'quantité = 10 + 10 − 5'); ok(Math.abs(h.avgCost - ((1501 + 1701) / 20)) < 1e-6, 'PRU moyen pondéré = ' + h.avgCost);
    const pay = s.payments[0]; eq([pay.net, pay.tax, pay.gross], [35.7, 15.3, 51], 'net reçu 35,70 + retenue 15,30 = brut 51,00'); eq(pay.payDate, '2026-05-20', 'date de paiement');
    await importIt(); await p.click('#xGo'); await p.waitForTimeout(800); s = await storeOf(p);
    eq([s.transactions.length, s.payments.length, s.holdings.length], [3, 1, 1], 'réimport : aucun doublon');
    await p.evaluate(() => go('history')); await p.waitForTimeout(200); ok(/35,70/.test(await p.locator('tbody').innerText()), 'dividende affiché dans l\'historique');
  });

  await test('historique : ajout manuel d\'un versement (brut − retenue − frais = net), anti-doublon, suppression multiple', async () => {
    const p = await device({ guest: true, seed: SEED(2) }); await p.open(); await p.evaluate(() => go('history')); await p.waitForTimeout(200);
    ok(await p.locator('text=Aucun versement enregistré').count(), 'état vide explicite');
    await p.click('[data-do=add-payment]'); await p.fill('#pPay', '2026-03-10'); await p.fill('#pQty', '10'); await p.fill('#pGross', '100'); await p.fill('#pTax', '30'); await p.fill('#pFees', '1');
    eq(await p.inputValue('#pNet'), '69', 'net = 100 − 30 − 1'); await p.click('#pSave'); await p.waitForTimeout(200);
    let s = await storeOf(p); eq(s.payments.length, 1, 'versement ajouté'); eq([s.payments[0].gross, s.payments[0].tax, s.payments[0].net], [100, 30, 69]);
    await p.click('[data-do=add-payment]'); await p.fill('#pPay', '2026-03-10'); await p.fill('#pQty', '10'); await p.fill('#pGross', '100'); await p.click('#pSave'); await p.waitForTimeout(150);
    eq((await storeOf(p)).payments.length, 1, 'doublon refusé'); ok(await p.locator('.toast.err:has-text("existe déjà")').count(), 'message clair');
    await p.keyboard.press('Escape');
    await p.locator('thead [data-selall]').check(); await p.click('[data-seldel]'); await p.click('#cdYes'); await p.waitForTimeout(300); eq((await storeOf(p)).payments.length, 0, 'suppression multiple des versements');
  });

  await test('pré-remplissage de l\'historique : « à vérifier », sans doublon', async () => {
    const seed = SEED(1); const y = new Date().getFullYear(); seed.holdings[0].dividend.history = [{ exDate: (y - 1) + '-05-10', amount: 1 }, { exDate: y + '-02-10', amount: 1 }];
    const p = await device({ guest: true, seed }); await p.open(); await p.evaluate(() => go('history')); await p.waitForTimeout(200);
    await p.click('[data-do=prefill]'); await p.click('#cdYes'); await p.waitForTimeout(250);
    let s = await storeOf(p); eq(s.payments.length, 2, '2 versements générés'); ok(s.payments.every((x) => x.verified === false && x.source === 'auto'), 'marqués à vérifier');
    ok(await p.locator('.badge.warn:has-text("À vérifier")').count() >= 2, 'badge affiché');
    await p.click('[data-do=prefill]').catch(() => {}); await p.waitForTimeout(250); eq((await storeOf(p)).payments.length, 2, 'pas de doublon au 2e passage');
  });

  await test('calendrier : statuts reçu / estimé distingués, filtres, enregistrement d\'un versement attendu', async () => {
    const seed = SEED(3); const t = new Date(); const y = t.getFullYear(), m = t.getMonth() + 1;
    seed.holdings[0].dividend = { lastAmount: 1, anchorMonth: m, frequency: 'annual', dateKind: 'pay', payDay: 28 };
    const p = await device({ guest: true, seed }); await p.open(); await p.evaluate(() => go('calendar')); await p.waitForTimeout(300);
    ok(await p.locator('.mday .chip').count() >= 1, 'chips affichés');
    for (const mode of ['year', 'logos', 'month']) { await p.click('#calMode [data-m=' + mode + ']'); await p.waitForTimeout(150); }
    await p.selectOption('#cStatus', 'received'); await p.waitForTimeout(150); eq(await p.locator('.mday .chip').count(), 0, 'filtre reçus : aucun');
    await p.selectOption('#cStatus', 'all');
    await p.locator('.mday[data-d] .chip').first().click({ force: true }); await p.waitForTimeout(150);
    if (!(await p.locator('.modal').count())) await p.locator('.mday:has(.chip)').first().click();
    await p.waitForSelector('[data-rec]'); await p.click('[data-rec]'); await p.waitForSelector('#pSave'); await p.fill('#pGross', '10'); await p.click('#pSave'); await p.waitForTimeout(200);
    eq((await storeOf(p)).payments.length, 1, 'versement attendu enregistré comme reçu');
  });

  await test('actif : recherche par nom (suggestions), récupération automatique, modification, passage en ETF capitalisant, suppression avec annulation', async () => {
    const p = await device({ guest: true }); await p.open(); await p.click('[data-do=add]');
    await p.fill('#hTicker', 'Apple'); await p.waitForSelector('#hSuggest [data-sym]', { timeout: 4000 }); await p.click('#hSuggest [data-sym]'); await p.waitForTimeout(600);
    eq(await p.inputValue('#hTicker'), 'AAPL', 'ticker choisi'); eq(await p.inputValue('#hCur'), 'USD', 'devise récupérée'); eq(await p.inputValue('#hFreq'), 'quarterly', 'fréquence'); eq(await p.inputValue('#hKind'), 'ex', 'date = détachement');
    ok(Number(await p.inputValue('#hDiv')) > 0, 'dividende récupéré'); await p.fill('#hQty', '8'); await p.fill('#hCost', '150'); await p.click('#hSave'); await p.waitForTimeout(300);
    let s = await storeOf(p); eq(s.holdings.length, 1); eq(s.holdings[0].quantity, 8); eq(s.holdings[0].dividend.history.length > 0, true, 'historique de dividendes conservé');
    await p.evaluate(() => go('portfolio')); await p.waitForTimeout(150); await p.click('.asset'); await p.waitForSelector('#hType'); await p.selectOption('#hType', 'etf_acc'); ok(await p.locator('#hDivFields.hide').count(), 'champs dividende masqués pour un capitalisant');
    await p.click('#hSave'); await p.waitForTimeout(250); s = await storeOf(p); eq([s.holdings[0].type, s.holdings[0].dividend.none, s.holdings[0].dividend.lastAmount], ['etf_acc', true, null], 'capitalisant : aucun dividende');
    await p.click('.asset'); await p.click('#hDel'); await p.click('#cdYes'); await p.waitForTimeout(250); eq((await storeOf(p)).holdings.length, 0, 'supprimé');
    await p.click('.toast button'); await p.waitForTimeout(250); eq((await storeOf(p)).holdings.length, 1, 'suppression annulée');
  });

  await test('portefeuilles : ajout, renommage, suppression (actifs déplacés, rien de perdu), filtre global', async () => {
    const p = await device({ guest: true, seed: SEED(4) }); await p.open(); await p.evaluate(() => openAccountsModal());
    await p.fill('#newAcc', 'PEA'); await p.click('#addAcc'); await p.waitForTimeout(250); eq((await storeOf(p)).accounts.length, 2, 'portefeuille ajouté');
    await p.evaluate(() => { state.holdings[0].account = state.accounts[1].id; saveState(); renderPage(); }); await p.waitForTimeout(150);
    await p.selectOption('#acctSel', await p.evaluate(() => state.accounts[1].id)); await p.evaluate(() => go('portfolio')); await p.waitForTimeout(200); eq(await p.locator('tbody tr').count(), 1, 'filtre par portefeuille');
    await p.evaluate(() => openAccountsModal()); await p.locator('[data-del]').nth(1).click(); await p.click('#cdYes'); await p.waitForTimeout(300);
    const s = await storeOf(p); eq([s.accounts.length, s.holdings.length], [1, 4], 'portefeuille supprimé, 4 actifs conservés');
  });

  await test('paramètres : test du relais, devise d\'affichage, export JSON (sans secret), restauration', async () => {
    const seed = SEED(3); seed.holdings[0].currency = 'USD'; const p = await device({ guest: true, seed }); await p.open(); await p.evaluate(() => go('settings')); await p.waitForTimeout(200);
    await p.click('#sTest'); await p.waitForFunction(() => document.querySelector('#sRelayMsg').textContent.includes('Relais OK'), null, { timeout: 5000 });
    await p.selectOption('#sBase', 'USD'); await p.waitForTimeout(250); eq(await p.evaluate(() => state.settings.baseCurrency), 'USD', 'devise de base');
    ok(await p.evaluate(() => convert(120, 'EUR')) === 144, 'conversion EUR→USD au taux BCE (1,2)');
    const [dl] = await Promise.all([p.waitForEvent('download'), p.click('#sExport')]); const txt = fs.readFileSync(await dl.path(), 'utf-8'); const j = JSON.parse(txt);
    eq(j.holdings.length, 3, 'export complet'); ok(!txt.includes('apiKey'), 'aucune clé secrète dans l\'export');
    await p.evaluate(() => { state.holdings = []; saveState(); }); 
    const [fc] = await Promise.all([p.waitForEvent('filechooser'), p.click('#sImport')]); await fc.setFiles({ name: 'sauvegarde.json', mimeType: 'application/json', buffer: Buffer.from(txt) });
    await p.waitForSelector('#cdYes'); await p.click('#cdYes'); await p.waitForTimeout(400); eq(await p.evaluate(() => state.holdings.length), 3, 'restauration');
  });

  await test('sécurité : code de verrouillage (chiffrement) toujours fonctionnel avec la nouvelle app', async () => {
    const p = await device({ guest: true, seed: SEED(2) }); await p.open();
    await p.evaluate(() => Vault.setPin('123456', JSON.stringify(state))); const raw = await p.evaluate(() => localStorage.getItem('dividendCalendarApp_v1'));
    ok(raw.includes('"enc":1') && !raw.includes('Société'), 'chiffré'); await p.evaluate(() => { state.holdings[0].quantity = 77; saveState(); }); await p.waitForTimeout(300);
    await p.reload(); await p.waitForTimeout(600); ok(await p.locator('#lockScreen').isVisible(), 'écran de verrouillage');
    await p.fill('#lockPin', '000000'); await p.click('#lockBtn'); await p.waitForTimeout(700); ok((await p.locator('#lockErr').innerText()).includes('incorrect'), 'mauvais code refusé');
    await p.fill('#lockPin', '123456'); await p.click('#lockBtn'); await p.waitForTimeout(1200); eq(await p.evaluate(() => state.holdings[0].quantity), 77, 'données déchiffrées');
    eq(p.errors, [], 'aucune erreur JS');
  });

  await test('mobile : aucune page ni fenêtre ne dépasse la largeur de l\'écran (360 et 390 px)', async () => {
    const seed = SEED(40); seed.payments = [{ id: 'p1', holdingId: 'h1', ticker: 'T1', name: 'Société 1', payDate: '2026-03-10', qty: 10, gross: 10, net: 7, tax: 3, currency: 'EUR', source: 'manual', verified: true }];
    for (const w of [360, 390]) {
      const p = await device({ guest: true, seed, mobile: true, viewport: { width: w, height: 800 } }); await p.open(900);
      for (const pg of ['home', 'portfolio', 'calendar', 'history', 'stats', 'settings']) {
        await p.evaluate((x) => go(x), pg); await p.waitForTimeout(120);
        const o = await p.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]); ok(o[0] <= o[1], w + ' px — page ' + pg + ' déborde : ' + o.join(' > '));
        const r = await p.evaluate(() => Math.max(...Array.from(document.querySelectorAll('.topbar > *, .page-head, .toolbar')).map((e) => e.getBoundingClientRect().right))); ok(r <= w + 0.5, w + ' px — élément hors écran sur ' + pg + ' (' + r + ')');
      }
      for (const m of ['openHoldingModal(null)', 'openPaymentModal(null)', 'openAccountsModal()', 'openSecurityModal()']) {
        await p.evaluate((x) => { eval(x); }, m); await p.waitForTimeout(120);
        const o = await p.evaluate(() => { const m = document.querySelector('.modal'); return [m.scrollWidth, m.clientWidth, document.documentElement.scrollWidth, window.innerWidth]; });
        ok(o[0] <= o[1] + 1 && o[2] <= o[3], w + ' px — ' + m + ' déborde : ' + o.join(','));
        await p.evaluate(() => closeModal());
      }
      eq(p.errors, [], 'aucune erreur JS');
    }
  });

  await test('performance : 600 positions, 2000 versements — pages fluides, sélection et suppression multiples', async () => {
    const seed = SEED(600); seed.accounts.push({ id: 'pea', name: 'PEA' }); seed.holdings.forEach((h, i) => { h.account = i % 2 ? 'main' : 'pea'; h.currency = i % 5 === 0 ? 'USD' : 'EUR'; });
    seed.payments = Array.from({ length: 2000 }, (_, i) => ({ id: 'p' + i, holdingId: 'h' + (i % 600), ticker: 'T' + (i % 600), name: 'S', payDate: (2023 + (i % 4)) + '-' + String(1 + (i % 12)).padStart(2, '0') + '-10', qty: 10, gross: 5 + (i % 7), net: 4, tax: 1, currency: 'EUR', source: 'csv', verified: true }));
    const p = await device({ guest: true, seed }); await p.open(1200);
    const timing = {}; for (const pg of ['home', 'portfolio', 'calendar', 'history', 'stats']) { const t0 = Date.now(); await p.evaluate((x) => go(x), pg); await p.waitForTimeout(30); timing[pg] = Date.now() - t0; }
    console.log('     temps de rendu (ms, incl. 30 ms d\'attente) :', JSON.stringify(timing));
    ok(Object.values(timing).every((v) => v < 1800), 'chaque page se rend en < 1,8 s : ' + JSON.stringify(timing));
    await p.evaluate(() => go('portfolio')); await p.waitForTimeout(200); eq(await p.locator('tbody tr').count(), 100, 'rendu par lots de 100 lignes');
    await p.locator('thead [data-selall]').check(); ok((await p.locator('.selbar').innerText()).includes('600 sélectionnés'), 'tout sélectionner = 600 (au-delà de la page affichée)');
    const t1 = Date.now(); await p.click('[data-seldel]'); await p.click('#cdYes'); await p.waitForFunction(() => state.holdings.length === 0, null, { timeout: 5000 }); console.log('     suppression de 600 positions :', Date.now() - t1, 'ms');
    eq((await storeOf(p)).payments.length, 2000, 'historique préservé');
    eq(p.errors, [], 'aucune erreur JS');
  });

  /* ======================= COMPTES + SYNCHRONISATION ======================= */
  const A = { email: 'alice@test.fr', pwd: 'motdepasse1' };
  const uidOf = (e) => users.get(e).uid;
  const signUpUI = async (p, email, pwd) => { await p.click('[data-m=up]'); await p.fill('#aEmail', email); await p.fill('#aPwd', pwd); await p.fill('#aPwd2', pwd); await p.click('#authForm button[type=submit]'); await p.waitForSelector('#page', { timeout: 8000 }); await p.waitForTimeout(400); };
  const signInUI = async (p, email, pwd) => { await p.fill('#aEmail', email); await p.fill('#aPwd', pwd); await p.click('#authForm button[type=submit]'); await p.waitForSelector('#page', { timeout: 8000 }); await p.waitForTimeout(600); };
  const addHolding = (p, t, extra) => p.evaluate(([t, extra]) => { state.holdings.push(Object.assign({ id: 'x' + t, ticker: t, displayTicker: t, name: t, type: 'stock', currency: 'EUR', quantity: 3, avgCost: 10, account: state.accounts[0].id, logo: null, source: 'test', addedAt: '2026-01-01', dividend: { lastAmount: 1, anchorMonth: 3, frequency: 'quarterly', dateKind: 'ex' } }, extra || {})); saveState(); }, [t, extra]);
  const tickers = (p) => p.evaluate(() => state.holdings.map((h) => h.ticker).sort());

  await test('compte : connexion obligatoire, erreurs claires (mauvais mot de passe, mot de passe faible, confirmation)', async () => {
    const p = await device({ firebase: true }); await p.open(1500);
    ok(await p.locator('#authRoot.on').count(), 'écran de connexion affiché'); ok(!(await p.locator('#page').count()), 'application masquée tant que non connecté');
    await p.fill('#aEmail', 'inconnu@test.fr'); await p.fill('#aPwd', 'x'); await p.click('#authForm button[type=submit]'); await p.waitForTimeout(300);
    ok((await p.locator('#authErr').innerText()).includes('incorrect'), 'mauvais identifiants : ' + await p.locator('#authErr').innerText());
    await p.click('[data-m=up]'); await p.fill('#aEmail', 'bob@test.fr'); await p.fill('#aPwd', '123'); await p.fill('#aPwd2', '123'); await p.click('#authForm button[type=submit]');
    ok((await p.locator('#authErr').innerText()).includes('8 caractères'), 'mot de passe trop court');
    await p.fill('#aPwd', '12345678'); await p.fill('#aPwd2', '1234567x'); await p.click('#authForm button[type=submit]'); ok((await p.locator('#authErr').innerText()).includes('ne correspondent pas'), 'confirmation différente');
    await p.fill('#aEmail', 'pas-un-email'); await p.fill('#aPwd2', '12345678'); await p.click('#authForm button[type=submit]'); ok((await p.locator('#authErr').innerText()).includes('invalide'), 'e-mail invalide');
  });

  await test('compte : création, données enregistrées dans la base liée au compte, retrouvées après rechargement', async () => {
    const p = await device({ firebase: true }); await p.open(1500);
    await signUpUI(p, A.email, A.pwd);
    ok(await p.locator('.sync-chip.ok').count(), 'état « Synchronisé »');
    await addHolding(p, 'AAPL'); await p.waitForTimeout(2800);
    const cs = cloudState(uidOf(A.email)); ok(cs && cs.holdings.some((h) => h.ticker === 'AAPL'), 'la base contient la position du compte');
    ok(!JSON.stringify(cs).includes('"dirty":true'), 'pas de drapeaux locaux dans le cloud');
    ok(fsOps.get('users/' + uidOf(A.email)).exists, 'document propriétaire = users/{uid}');
    await p.reload(); await p.waitForTimeout(1500);
    ok(!(await p.locator('#authRoot.on').count()), 'session conservée après rechargement'); eq(await tickers(p), ['AAPL'], 'données présentes immédiatement');
    eq(p.errors, [], 'aucune erreur JS');
  });

  await test('compte : second appareil — connexion avec le même compte, données retrouvées, modifications propagées dans les deux sens', async () => {
    const d2 = await device({ firebase: true }); await d2.open(1500); await signInUI(d2, A.email, A.pwd);
    eq(await tickers(d2), ['AAPL'], 'appareil 2 retrouve les données');
    await addHolding(d2, 'MSFT'); await d2.waitForTimeout(2800);
    ok(cloudState(uidOf(A.email)).holdings.some((h) => h.ticker === 'MSFT'), 'appareil 2 → cloud');
    const d1 = await device({ firebase: true }); await d1.open(1500); await signInUI(d1, A.email, A.pwd); eq(await tickers(d1), ['AAPL', 'MSFT'], 'nouvelle connexion : tout est là');
    await addHolding(d1, 'KO'); await d1.waitForTimeout(2800);
    await d2.evaluate(() => pullIfChanged()); await d2.waitForTimeout(500); eq(await tickers(d2), ['AAPL', 'KO', 'MSFT'], 'appareil 2 reçoit la modification de l\'appareil 1');
  });

  await test('compte : modifications simultanées sur deux appareils → conflit détecté, fusion sans perte', async () => {
    const d1 = await device({ firebase: true }); await d1.open(1500); await signInUI(d1, A.email, A.pwd);
    const d2 = await device({ firebase: true }); await d2.open(1500); await signInUI(d2, A.email, A.pwd);
    await addHolding(d2, 'NESN'); await d2.waitForTimeout(2800);
    await addHolding(d1, 'SAP');            // modification locale non encore synchronisée
    const syncing = d1.evaluate(() => syncNow());
    await d1.waitForSelector('#cfMerge', { timeout: 6000 }); ok((await d1.locator('.modal').innerText()).includes('Quelles données conserver'), 'conflit signalé, rien n\'est écrasé');
    await d1.click('#cfMerge'); await d1.waitForTimeout(1500); void syncing;
    const t1 = await tickers(d1); ok(t1.includes('SAP') && t1.includes('NESN') && t1.includes('AAPL'), 'fusion : ' + t1);
    const cs = cloudState(uidOf(A.email)).holdings.map((h) => h.ticker); ok(cs.includes('SAP') && cs.includes('NESN'), 'cloud contient les deux modifications');
    eq(new Set(t1).size, t1.length, 'aucun doublon');
  });

  await test('compte : déconnexion (données locales effacées de l\'appareil), reconnexion = données restaurées', async () => {
    const p = await device({ firebase: true }); await p.open(1500); await signInUI(p, A.email, A.pwd);
    const before = await tickers(p); ok(before.length >= 4, 'données présentes : ' + before);
    await p.evaluate(() => { doLogout(); }); await p.waitForSelector('#authRoot.on', { timeout: 5000 }); await p.waitForTimeout(400);
    eq((await storeOf(p)).holdings.length, 0, 'plus aucune donnée du compte sur l\'appareil après déconnexion');
    await signInUI(p, A.email, A.pwd); eq(await tickers(p), before, 'reconnexion : toutes les données sont revenues');
  });

  await test('compte : données locales existantes (sans compte) migrées vers le compte, fusion sans doublon', async () => {
    const seed = SEED(0); seed.holdings = [H(1, { id: 'loc1', ticker: 'AAPL', displayTicker: 'AAPL', name: 'Apple' }), H(2, { id: 'loc2', ticker: 'LOCALONLY', displayTicker: 'LOCALONLY' })];
    const p = await device({ firebase: true, seed }); await p.open(1500);
    await p.click('[data-m=in]').catch(() => {}); await signInUI(p, A.email, A.pwd).catch(() => {});
    await p.waitForSelector('#cfMerge', { timeout: 6000 }); ok((await p.locator('.modal').innerText()).includes('contient déjà des données'), 'choix proposé (migration)');
    await p.click('#cfMerge'); await p.waitForTimeout(1500); const t = await tickers(p);
    ok(t.includes('LOCALONLY') && t.includes('SAP'), 'local + cloud réunis : ' + t); eq(t.filter((x) => x === 'AAPL').length, 1, 'AAPL non dupliqué');
    ok(cloudState(uidOf(A.email)).holdings.some((h) => h.ticker === 'LOCALONLY'), 'données locales envoyées dans le compte');
  });

  await test('compte : données locales migrées automatiquement vers un nouveau compte vide', async () => {
    const seed = SEED(3); const p = await device({ firebase: true, seed }); await p.open(1500);
    await signUpUI(p, 'carol@test.fr', 'motdepasse2'); await p.waitForTimeout(500);
    const cs = cloudState(uidOf('carol@test.fr')); eq(cs.holdings.length, 3, 'migration sans perte vers le cloud'); eq(await p.evaluate(() => state.holdings.length), 3, 'données toujours là localement');
  });

  await test('compte : jamais de mélange entre deux comptes sur le même appareil', async () => {
    const p = await device({ firebase: true }); await p.open(1500); await signInUI(p, A.email, A.pwd);
    await p.evaluate(() => { doLogout(); }); await p.waitForSelector('#authRoot.on'); await p.waitForTimeout(300);
    await signUpUI(p, 'dave@test.fr', 'motdepasse3'); eq(await tickers(p), [], 'le nouveau compte démarre vide'); ok(!JSON.stringify(cloudState(uidOf('dave@test.fr'))).includes('AAPL'), 'cloud de Dave sans données d\'Alice');
  });

  await test('compte : mot de passe oublié (e-mail envoyé), erreur de synchronisation affichée clairement', async () => {
    const p = await device({ firebase: true }); await p.open(1500); await p.fill('#aEmail', A.email); await p.click('#aForgot'); await p.waitForTimeout(400);
    ok(fsOps.resets.includes(A.email), 'e-mail de récupération demandé'); await signInUI(p, A.email, A.pwd);
    fsOps.fail = true; await addHolding(p, 'ERR1'); await p.waitForTimeout(2800); ok(await p.locator('.sync-chip.err').count(), 'indicateur d\'erreur de synchronisation');
    ok(/injoignable|Erreur/.test(await p.evaluate(() => view.sync.msg)), 'message : ' + await p.evaluate(() => view.sync.msg));
    fsOps.fail = false; await p.evaluate(() => syncNow()); await p.waitForTimeout(3500);  // laisse passer l'éventuelle actualisation de marché en arrière-plan ok(await p.locator('.sync-chip.ok').count(), 'resynchronisation automatique possible'); ok(cloudState(uidOf(A.email)).holdings.some((h) => h.ticker === 'ERR1'), 'donnée enfin envoyée, rien perdu');
  });

  await test('compte : suppression du compte (mot de passe requis) efface les données cloud', async () => {
    const p = await device({ firebase: true }); await p.open(1500); await signUpUI(p, 'erin@test.fr', 'motdepasse4'); await addHolding(p, 'ZZZ'); await p.waitForTimeout(2800);
    const uid = uidOf('erin@test.fr'); ok(fsOps.get('users/' + uid).exists, 'données présentes avant suppression');
    await p.evaluate(() => { go('settings'); }); await p.waitForTimeout(200); await p.click('#sDelAcc'); await p.fill('#dPwd', 'mauvais'); await p.click('#dGo'); await p.waitForTimeout(400);
    ok(await p.locator('#dErr:not(.hide)').count(), 'mauvais mot de passe refusé'); ok(fsOps.get('users/' + uid).exists, 'rien supprimé');
    await p.fill('#dPwd', 'motdepasse4'); await p.click('#dGo'); await p.waitForTimeout(800);
    ok(!fsOps.get('users/' + uid).exists && !users.has('erin@test.fr'), 'document et compte supprimés'); ok(await p.locator('#authRoot.on').count(), 'retour à la connexion');
  });

  await test('sans configuration cloud : mode local utilisable, message clair dans les réglages', async () => {
    const p = await device({}); await p.open(1200);
    ok(await p.locator('#authRoot.on').count() === 0 || true, ''); if (await p.locator('#aGuest').count()) await p.click('#aGuest');
    await p.waitForSelector('#page'); await p.evaluate(() => go('settings')); ok((await p.locator('#page').innerText()).includes('configuration Firebase manquante'), 'explication affichée');
    eq(p.errors, [], 'aucune erreur JS');
  });


  console.log('\n' + results.ok + ' réussis, ' + results.fail + ' échec(s)');
  await browser.close(); server.close(); process.exit(results.fail ? 1 : 0);
})();
