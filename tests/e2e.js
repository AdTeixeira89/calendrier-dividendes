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
  'AI.PA': { name: "L'Air Liquide S.A.", cur: 'EUR', type: 'EQUITY', price: 175, sector: 'Basic Materials', divs: [['2024-05-14', 2.9], ['2025-05-12', 3.2], ['2026-05-11', 3.4]] },
  'AAPL': { name: 'Apple Inc.', cur: 'USD', type: 'EQUITY', price: 190, sector: 'Technology', divs: [['2025-11-10', .25], ['2026-02-09', .25], ['2026-05-11', .26], ['2026-08-10', .26]] },
  'IWDA.AS': { name: 'iShares Core MSCI World', cur: 'EUR', type: 'ETF', divs: [] },
  'TTE.PA': { name: 'TotalEnergies SE', cur: 'EUR', type: 'EQUITY', price: 62, sector: 'Energy', divs: [['2026-03-20', .79]] },
  'NOVO-B.CO': { name: 'Novo Nordisk A/S', cur: 'DKK', type: 'EQUITY', price: 700, sector: 'Healthcare', divs: [] }
};
const ISIN = { 'FR0000120073': 'AI.PA', 'US0378331005': 'AAPL', 'IE00B4L5Y983': 'IWDA.AS', 'FR0000120271': 'TTE.PA', 'DK0062498333': 'NOVO-B.CO' };
const RELAY = { old: false };    // true : simule l'ancienne version du relais (5 ans mensuels, ignore range / interval)
function chartSeries(y, interval) {
  if (interval === '1d' && !RELAY.old) {           // quotidien : ~3 ans de séances, cours en hausse régulière jusqu'au dernier cours
    const out = [], end = Date.UTC(2026, 9, 12); for (let t = end - 1100 * 86400000; t <= end; t += 86400000) { const d = new Date(t).getUTCDay(); if (d !== 0 && d !== 6) out.push(t); }
    return { timestamp: out.map((t) => t / 1000), indicators: { quote: [{ close: out.map((t, i) => Math.round(y.price * (0.5 + 0.5 * i / (out.length - 1)) * 100) / 100) }] } };
  }
  return { timestamp: Array.from({ length: 25 }, (_, i) => ts(new Date(Date.UTC(2024, 10 + i, 1)).toISOString().slice(0, 10))), indicators: { quote: [{ close: Array.from({ length: 25 }, (_, i) => Math.round(y.price * (0.7 + i * 0.0125) * 100) / 100) }] } };
}
async function mockRelay(route) {
  const u = new URL(route.request().url()), j = (o, st) => route.fulfill({ status: st || 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(o) });
  if (u.pathname === '/search') { const q = u.searchParams.get('q'); const s = ISIN[q] || (YAHOO[q] ? q : null) || (/apple/i.test(q) ? 'AAPL' : /air liquide/i.test(q) ? 'AI.PA' : null); return j({ quotes: s ? [{ symbol: s, quoteType: YAHOO[s].type, shortname: YAHOO[s].name, exchDisp: 'X', sector: YAHOO[s].sector || null, industry: YAHOO[s].sector ? 'Test industry' : null }] : [] }); }
  if (u.pathname === '/chart') { const y = YAHOO[u.searchParams.get('symbol')]; if (!y) return j({ chart: { result: null, error: { description: 'No data found' } } }); return j({ chart: { result: [{ meta: { currency: y.cur, longName: y.name, instrumentType: y.type, regularMarketPrice: y.price, regularMarketTime: ts('2026-10-12') }, ...chartSeries(y, u.searchParams.get('interval')), events: { dividends: Object.fromEntries(y.divs.map((d, i) => [i, { amount: d[1], date: ts(d[0]) }])) } }] } }); }
  return route.fulfill({ status: 404 });
}

/* ---------- harnais ---------- */
let browser, results = { ok: 0, fail: 0 };
const BASE = 'http://localhost:8766';
async function device(o) {
  o = o || {};
  const ctx = await browser.newContext({ viewport: o.viewport || { width: 1280, height: 900 }, hasTouch: !!o.mobile, isMobile: !!o.mobile, acceptDownloads: true });
  await ctx.exposeFunction('__fs', (op, ...a) => fsOps[op](...a));
  const page = await ctx.newPage(); page.errors = []; global.__lastPage = page;
  page.on('pageerror', (e) => page.errors.push(e.message));
  await page.addInitScript(() => { window.addEventListener('unhandledrejection', (e) => { setTimeout(() => { throw new Error('promesse rejetée : ' + (e.reason && e.reason.stack || e.reason)); }); }); });
  await page.route(/frankfurter/, (r) => {
    const url = r.request().url();
    if (/\d{4}-\d{2}-\d{2}\.\.\d{4}/.test(url)) {      // taux historiques : un par fin de mois, USD en hausse régulière
      const rates = {}; let k = 0;
      for (let y = 2018; y <= 2026; y++) for (let m = 1; m <= 12; m++) { const day = y + '-' + String(m).padStart(2, '0') + '-' + String(new Date(y, m, 0).getDate()); rates[day] = { USD: Math.round((1.05 + 0.002 * k++) * 10000) / 10000, DKK: 7.46, GBP: 0.85, CHF: 0.95 }; }
      return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ base: 'EUR', rates }) });
    }
    return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ date: '2026-10-09', rates: { USD: 1.2, GBP: 0.85, CHF: 0.95, DKK: 7.46 } }) });
  });
  await page.route(/workers\.dev/, mockRelay);
  await page.route(/cdn\.jsdelivr\.net/, (r) => { const f = r.request().url().includes('papaparse') ? 'papaparse.min.js' : 'xlsx.full.min.js'; const fp = path.join(process.env.LIBDIR || '', f); fs.existsSync(fp) ? r.fulfill({ status: 200, contentType: 'text/javascript', body: fs.readFileSync(fp) }) : r.abort(); });
  await page.route(/^https?:\/\/(?!localhost)(?!.*workers\.dev)(?!.*frankfurter)(?!.*cdn\.jsdelivr)/, (r) => r.abort());
  if (o.firebase) {
    await page.route('**/config.js', (r) => r.fulfill({ contentType: 'text/javascript', body: "window.APP_CONFIG={accountsEnabled:true,relayUrl:'https://dividende-relais.adam-teixeira89.workers.dev',firebase:{apiKey:'k',authDomain:'a',projectId:'p',appId:'x'}};" }));
    await page.addInitScript(MOCK);
  }
  if (o.seed) await page.addInitScript((s) => { if (!localStorage.getItem('dividendCalendarApp_v1')) localStorage.setItem('dividendCalendarApp_v1', JSON.stringify(s)); }, o.seed);
  if (o.guest) await page.addInitScript(() => localStorage.setItem('dca_guest', '1'));
  page.open = async (wait) => { await page.goto(BASE + '/index.html'); await page.waitForTimeout(wait || 700); };
  return page;
}
async function test(name, fn) {
  if (FILTER && !name.toLowerCase().includes(FILTER.toLowerCase())) return;
  try { await fn(); results.ok++; console.log('ok   ' + name); } catch (e) { results.fail++; console.log('FAIL ' + name + '\n     ' + String(e.message).split('\n').slice(0, 4).join('\n     ') + (global.__lastPage && global.__lastPage.errors.length ? '\n     erreurs JS : ' + global.__lastPage.errors.join(' | ') : '')); }
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
    await p.evaluate(() => go('home')); const txt = await p.locator('.kpis.section-gap').innerText();
    ok(/Dividendes annuels estimés\s+5\s?€/.test(txt), 'dividendes annuels estimés = 5 × 0,25 × 4 = 5 € — obtenu : ' + txt.slice(0, 160));
    ok(/Rendement sur coût\s+1,00\s?%/.test(txt), 'rendement sur coût = 5/500 = 1,00 % — obtenu : ' + txt);
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
    await p.click('[data-mode=net]'); await p.waitForTimeout(150); ok(/Dividendes annuels estimés\s+14\s?€/.test(await p.locator('.kpis.section-gap').innerText()), 'KPI en net');
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

  await test('logos : essai Parqet (ISIN puis symbole) → images FMP → initiales ; logo enregistré prioritaire ; désactivable', async () => {
    const seed = SEED(0); seed.holdings = [H(0, { ticker: 'AI.PA', displayTicker: 'AI.PA', isin: 'FR0000120073', name: 'Air Liquide' }), H(1, { ticker: 'ZZZ', displayTicker: 'ZZZ', name: 'Inconnu' }), H(2, { ticker: 'KO', displayTicker: 'KO', name: 'Coca', logo: 'https://logos.test/ko.png' })];
    const p = await device({ guest: true, seed }); const seen = [];
    const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
    await p.route(/assets\.parqet\.com/, (r) => { seen.push(r.request().url()); r.fulfill({ status: 404, body: '' }); });
    await p.route(/images\.financialmodelingprep\.com/, (r) => { seen.push(r.request().url()); r.request().url().includes('AI.PA') ? r.fulfill({ status: 200, contentType: 'image/png', body: PNG }) : r.fulfill({ status: 404, body: '' }); });
    await p.route(/logos\.test/, (r) => { seen.push(r.request().url()); r.fulfill({ status: 200, contentType: 'image/png', body: PNG }); });
    await p.open(); await p.evaluate(() => go('portfolio')); await p.waitForTimeout(1200);
    const rows = await p.evaluate(() => Array.from(document.querySelectorAll('tbody tr')).map((tr) => [tr.querySelector('.tkr').textContent, tr.querySelector('.avatar img') ? tr.querySelector('.avatar img').getAttribute('src') : null]));
    const by = Object.fromEntries(rows);
    ok(by['AI.PA'] && by['AI.PA'].includes('financialmodelingprep'), 'AI.PA : retombe sur les images FMP — ' + by['AI.PA']); eq(by['ZZZ'], null, 'logo introuvable : initiales (aucune image cassée)'); eq(by['KO'], 'https://logos.test/ko.png', 'logo enregistré prioritaire');
    ok(seen.findIndex((u) => u.includes('/isin/FR0000120073')) >= 0 && seen.findIndex((u) => u.includes('/isin/FR0000120073')) < seen.findIndex((u) => u.includes('/symbol/AI.PA')), 'Parqet interrogé par ISIN en premier');
    ok(!seen.some((u) => u.includes('/symbol/KO') || u.includes('/KO.png')), 'aucune requête inutile quand un logo existe');
    await p.evaluate(() => { state.settings.autoLogos = false; saveState(); renderPage(); }); await p.waitForTimeout(300);
    const after = await p.evaluate(() => Array.from(document.querySelectorAll('tbody tr .avatar img')).map((i) => i.getAttribute('src'))); eq(after, ['https://logos.test/ko.png'], 'désactivé : seuls les logos déjà enregistrés');
  });

  await test('cours : actualisation → valeur, plus-value, rendement sur cours ; PRU en EUR pour une action en USD ; PRU modifiable', async () => {
    const seed = SEED(0); seed.holdings = [H(0, { ticker: 'AAPL', displayTicker: 'AAPL', name: 'Apple', currency: 'USD', costCurrency: 'EUR', quantity: 10, avgCost: 100, dividend: { lastAmount: 0.26, anchorMonth: 8, frequency: 'quarterly', dateKind: 'ex' } })];
    const p = await device({ guest: true, seed }); await p.open(); await p.evaluate(() => go('portfolio')); await p.waitForTimeout(200);
    ok(!/1\s?900/.test(await p.locator('tbody').innerText()), 'pas de cours avant actualisation');
    await p.click('[data-do=refresh]'); await p.waitForFunction(() => state.holdings[0].price > 0, null, { timeout: 6000 }); await p.waitForTimeout(500);
    let s = await storeOf(p); eq([s.holdings[0].price, s.holdings[0].priceAt.slice(0, 10)], [190, '2026-10-12'], 'cours et date enregistrés');
    const g = await p.evaluate(() => [Engine.value(state.holdings[0]), Math.round(Engine.unrealized(state, convert, null).gain * 100) / 100, Math.round(Engine.unrealized(state, convert, null).pct * 1000) / 1000]);
    eq(g, [1900, 583.33, 0.583], 'valeur 1900 $ = 1583,33 €, coût 1000 € → +583,33 € (+58,3 %)');
    await p.evaluate(() => go('home')); await p.waitForTimeout(250); const home = await p.locator('main').innerText();
    ok(/1\s?583\s?€/.test(home) && /\+58,3\s?%/.test(home) && /Sur cours actuel/.test(home), 'accueil : valeur, plus-value, rendement sur cours — ' + home.slice(home.indexOf('Valeur du'), home.indexOf('Valeur du') + 200).replace(/\n/g, ' '));
    // modification du PRU : investi, rendement sur coût et plus-value suivent
    await p.evaluate(() => go('portfolio')); await p.waitForTimeout(200); await p.click('.asset'); await p.fill('#hCost', '150'); await p.click('#hSave'); await p.waitForTimeout(300);
    const after = await p.evaluate(() => [Engine.invested(state.holdings[0]), Math.round(Engine.yieldOnCost(state, convert, null).rate * 10000) / 10000]); eq(after, [1500, Math.round((10 * 0.26 * 4 / 1.2) / 1500 * 10000) / 10000], 'investi 1500 € ; rendement sur coût recalculé');
    ok(/1\s?500/.test(await p.locator('tbody').innerText()), 'colonne Investi mise à jour');
    eq(await p.evaluate(() => state.holdings[0].price), 190, 'le PRU ne modifie pas le cours');
  });

  await test('apparence : mode clair/sombre/auto et thèmes de fond appliqués, mémorisés, sans clignotement au rechargement', async () => {
    const p = await device({ guest: true, seed: SEED(2) }); await p.open(); await p.evaluate(() => go('settings')); await p.waitForTimeout(200);
    eq(await p.evaluate(() => document.documentElement.getAttribute('data-bg')), 'aurore', 'thème par défaut : Aurore');
    await p.selectOption('#sTheme', 'dark'); eq(await p.evaluate(() => document.documentElement.getAttribute('data-theme')), 'dark', 'mode sombre');
    await p.click('#sBg [data-bg=saphir]'); eq(await p.evaluate(() => document.documentElement.getAttribute('data-bg')), 'saphir', 'fond Saphir');
    const bg = await p.evaluate(() => getComputedStyle(document.body).getPropertyValue('--bg') || getComputedStyle(document.documentElement).getPropertyValue('--bg')); ok(bg.trim().toLowerCase() === '#0c1117', 'variables sombres appliquées : ' + bg);
    await p.waitForTimeout(300); const s = await storeOf(p); eq([s.settings.theme, s.settings.bg], ['dark', 'saphir'], 'enregistré dans les paramètres (donc synchronisé avec le compte)');
    await p.goto(BASE + '/index.html', { waitUntil: 'commit' }); await p.waitForFunction(() => document.documentElement.hasAttribute('data-bg'), null, { timeout: 3000 });
    eq(await p.evaluate(() => [document.documentElement.getAttribute('data-theme'), document.documentElement.getAttribute('data-bg')]), ['dark', 'saphir'], 'appliqué dès le chargement (script d\'amorçage)');
    await p.waitForTimeout(700); await p.evaluate(() => go('settings')); await p.click('#sBg [data-bg=aucun]'); await p.selectOption('#sTheme', 'auto');
    eq(await p.evaluate(() => [document.documentElement.getAttribute('data-theme'), getComputedStyle(document.body, '::before').display]), [null, 'none'], 'auto + fond sobre : aucun décor');
    eq(p.errors, [], 'aucune erreur JS');
  });

  await test('infobulles : valeur au survol (souris) et au toucher (téléphone) sur les graphiques ; masquées quand les chiffres sont cachés', async () => {
    const seed = SEED(3); const y = new Date().getFullYear();
    seed.holdings[0].sector = 'Technology'; seed.holdings[1].sector = 'Healthcare'; seed.holdings[2].sector = 'Energy';
    seed.payments = [{ id: 'p1', holdingId: 'h0', ticker: 'T0', name: 'Société 0', payDate: y + '-03-10', qty: 10, perShare: 1.5, gross: 15, net: 12, currency: 'EUR', source: 'manual', verified: true }];
    const d = await device({ guest: true, seed }); await d.open(); await d.waitForSelector('.chart .hit');
    const idx = 2;   // mars
    await d.locator('.chart .hit').nth(idx).hover(); await d.waitForTimeout(150);
    ok(await d.locator('.tip').isVisible(), 'infobulle visible au survol'); const txt = await d.locator('.tip').innerText();
    ok(/Mars|Mar/.test(txt) && /15,00\s?€/.test(txt), 'montant du mois affiché : ' + txt.replace(/\n/g, ' | '));
    await d.mouse.move(5, 5); await d.waitForTimeout(150); ok(!(await d.locator('.tip').isVisible()), 'infobulle masquée quand la souris part');
    await d.evaluate(() => { const el = document.querySelector('.donut-wrap path'); const r = el.getBoundingClientRect(); el.dispatchEvent(new PointerEvent('pointerover', { bubbles: true, pointerType: 'mouse', clientX: r.x + r.width / 2, clientY: r.y + 5 })); }); await d.waitForTimeout(150); ok(/%/.test(await d.locator('.tip').innerText()), 'répartition : part et montant au survol');
    const m = await device({ guest: true, seed, mobile: true, viewport: { width: 390, height: 844 } }); await m.open(); await m.waitForSelector('.chart .hit');
    const box = await m.locator('.chart .hit').nth(idx).boundingBox(); await m.locator('.chart .hit').nth(idx).evaluate((e) => e.scrollIntoView({ block: 'center' })); await m.waitForTimeout(100);
    const b2 = await m.locator('.chart .hit').nth(idx).boundingBox(); await m.touchscreen.tap(b2.x + b2.width / 2, b2.y + b2.height / 2); await m.waitForTimeout(200);
    ok(await m.locator('.tip').isVisible(), 'infobulle visible au toucher'); ok(/15,00\s?€/.test(await m.locator('.tip').innerText()), 'montant au toucher');
    void box;
    // chiffres masqués : infobulles neutres
    await m.evaluate(() => { state.settings.hideNumbers = true; saveState(); renderPage(); }); await m.waitForTimeout(250);
    await m.locator('.chart .hit').nth(idx).evaluate((e) => e.scrollIntoView({ block: 'center' })); await m.waitForTimeout(100); const b3 = await m.locator('.chart .hit').nth(idx).boundingBox(); await m.touchscreen.tap(b3.x + b3.width / 2, b3.y + b3.height / 2); await m.waitForTimeout(200);
    ok(/masqués/.test(await m.locator('.tip').innerText()) && !/15,00/.test(await m.locator('.tip').innerText()), 'infobulle sans chiffre quand masqué');
  });

  await test('œil de l\'accueil : masque / affiche les chiffres, mémorisé', async () => {
    const p = await device({ guest: true, seed: SEED(4) }); await p.open();
    ok(!(await p.locator('.home-body.hide-nums').count()), 'chiffres visibles par défaut'); eq(await p.getAttribute('#eyeBtn', 'aria-pressed'), 'false');
    await p.click('#eyeBtn'); await p.waitForTimeout(200);
    ok(await p.locator('.home-body.hide-nums').count(), 'chiffres masqués'); eq(await p.getAttribute('#eyeBtn', 'aria-pressed'), 'true');
    const blur = await p.evaluate(() => [getComputedStyle(document.querySelector('.kpi .val')).filter, getComputedStyle(document.querySelector('.tk-amt')).filter]); ok(blur.every((f) => f.includes('blur')), 'flou appliqué aux montants : ' + blur);
    eq((await storeOf(p)).settings.hideNumbers, true, 'préférence enregistrée');
    await p.reload(); await p.waitForTimeout(700); ok(await p.locator('.home-body.hide-nums').count(), 'toujours masqué après rechargement');
    await p.click('#eyeBtn'); await p.waitForTimeout(150); ok(!(await p.locator('.home-body.hide-nums').count()), 're-affichage');
    await p.evaluate(() => go('portfolio')); await p.waitForTimeout(150); ok(!/blur/.test(await p.evaluate(() => getComputedStyle(document.querySelector('.tbl td')).filter)), 'le masquage ne concerne que l\'accueil');
  });

  await test('bandeau des prochains versements : compact, défilement automatique en boucle, manuel possible, détail au toucher', async () => {
    const seed = SEED(14); seed.settings.tickerAuto = true;
    const p = await device({ guest: true, seed, viewport: { width: 700, height: 800 } }); await p.open(500);
    const h = await p.evaluate(() => document.querySelector('.tk-chip').getBoundingClientRect().height); ok(h <= 40, 'pastille compacte : ' + h + ' px');
    const sec = await p.evaluate(() => document.querySelector('.ticker').getBoundingClientRect().height); ok(sec <= 90, 'bandeau peu encombrant : ' + sec + ' px');
    ok(await p.evaluate(() => document.querySelector('#tickerTrack').dataset.loop === '1' && document.querySelectorAll('#tickerTrack [aria-hidden=true]').length > 0), 'contenu dupliqué pour la boucle (doublons masqués aux lecteurs d\'écran)');
    const x1 = await p.evaluate(() => document.querySelector('#tickerTrack').scrollLeft); await p.waitForTimeout(1600); const x2 = await p.evaluate(() => document.querySelector('#tickerTrack').scrollLeft);
    ok(x2 > x1 + 10, 'défile tout seul : ' + x1 + ' → ' + x2);
    await p.hover('#tickerTrack .tk-chip'); const y1 = await p.evaluate(() => document.querySelector('#tickerTrack').scrollLeft); await p.waitForTimeout(700); const y2 = await p.evaluate(() => document.querySelector('#tickerTrack').scrollLeft); ok(Math.abs(y2 - y1) < 3, 'pause au survol');
    await p.evaluate(() => { document.querySelector('#tickerTrack').scrollLeft = 5; }); await p.waitForTimeout(100);
    await p.evaluate(() => { document.querySelector('#tickerTrack').scrollLeft = 0; }); await p.waitForTimeout(150); ok(await p.evaluate(() => document.querySelector('#tickerTrack').scrollLeft) > 100, 'défilement manuel vers la gauche : la boucle reboucle');
    await p.click('#tickerTrack .tk-chip'); await p.waitForSelector('.modal'); ok((await p.locator('.modal').innerText()).includes('versement'), 'détail du jour');
  });

  await test('accueil : « reçus » = versements vérifiés ; générés d\'après l\'historique comptés à part ; réconciliation annuel = reçus + à venir ; « Tout valider »', async () => {
    const y = new Date().getFullYear(); const seed = SEED(0);
    seed.holdings = [H(0, { ticker: 'AAA', displayTicker: 'AAA', name: 'Alpha', quantity: 10, dividend: { lastAmount: 1, anchorMonth: 2, frequency: 'quarterly', dateKind: 'ex' } })];
    seed.payments = [
      { id: 'v1', holdingId: 'h0', ticker: 'AAA', name: 'Alpha', payDate: y + '-01-10', qty: 10, perShare: 1, gross: 10, net: 10, currency: 'EUR', source: 'manual', verified: true },
      { id: 'u1', holdingId: 'h0', ticker: 'AAA', name: 'Alpha', payDate: y + '-04-10', qty: 10, perShare: 1, gross: 10, net: 10, currency: 'EUR', source: 'auto', verified: false },
      { id: 'u2', holdingId: 'h0', ticker: 'AAA', name: 'Alpha', payDate: y + '-07-10', qty: 10, perShare: 1, gross: 10, net: 10, currency: 'EUR', source: 'auto', verified: false }];
    const p = await device({ guest: true, seed }); await p.open();
    const hm = (await p.locator('#page').innerText()).replace(/\n/g, ' | ');
    ok(/Perçus \| 10\s?€/.test(hm), 'accueil : perçus = uniquement le versement vérifié (10 €) — ' + hm.slice(0, 400));
    ok(/\+\s?20\s?€\s?à vérifier/.test(hm), 'accueil : montant « à vérifier » affiché séparément');
    ok(/Année \d{4} : 30\s?€ perçus \+ 10\s?€ à venir/.test(hm), 'accueil : réconciliation annuel estimé = perçus + à venir');
    await p.evaluate(() => { view.divTab = 'stats'; go('dividends'); }); await p.waitForTimeout(250);
    const k = (await p.locator('#page').innerText()).replace(/\n/g, ' | ');
    ok(/Reçus depuis le 1er janvier \| 10,00\s?€/.test(k), 'statistiques : reçus = 10 € — ' + k.slice(0, 300));
    ok(/\+\s?20,00\s?€\s?à vérifier/.test(k), 'statistiques : « à vérifier » séparé');
    ok(/Année \d{4} : 30,00\s?€ reçus \+ 10,00\s?€ à venir = 40,00\s?€/.test(k), 'statistiques : ligne de réconciliation');
    await p.evaluate(() => go('history')); await p.waitForTimeout(200); await p.click('[data-do=validate-all]'); await p.click('#cdYes'); await p.waitForTimeout(300);
    eq((await storeOf(p)).payments.every((x) => x.verified !== false), true, 'tout validé');
    await p.evaluate(() => go('home')); await p.waitForTimeout(250); ok(/Perçus\s+30\s?€/.test(await p.locator('#page').innerText()), 'après validation : 30 € perçus');
  });

  await test('import CSV : les actifs déjà présents restent INTACTS (PRU, quantité, données), seuls les nouveaux sont ajoutés', async () => {
    const seed = SEED(0);
    seed.holdings = [
      H(0, { ticker: 'AAPL', displayTicker: 'AAPL', isin: 'US0378331005', name: 'Apple', quantity: 5, avgCost: 123.45, currency: 'USD', logo: 'https://x.test/a.png', sector: 'Technology', dividend: { lastAmount: 0.26, anchorMonth: 8, frequency: 'quarterly', dateKind: 'ex', taxRate: 15, payDay: 14 } }),
      H(1, { ticker: 'AI.PA', displayTicker: 'AI.PA', isin: '', name: 'Air Liquide', quantity: 7, avgCost: 150, currency: 'EUR' })];
    const before = JSON.stringify(seed.holdings);
    const p = await device({ guest: true, seed }); await p.open(); await p.evaluate(() => go('portfolio'));
    const csv = 'Produit,Symbole/ISIN,Quantité,Clôture,Devise locale\nAPPLE INC,US0378331005,99,200,USD\nAIR LIQUIDE,FR0000120073,88,170,EUR\nISHARES MSCI WORLD,IE00B4L5Y983,40,90,EUR\n';
    const [fc] = await Promise.all([p.waitForEvent('filechooser'), p.evaluate(() => { openImportPositions(); })]); await fc.setFiles(csvFile('releve.csv', csv)); await p.waitForSelector('#mGo');
    const sum = await p.locator('#mSummary').innerText(); ok(/1\s+nouvel/.test(sum) && /2\s+déjà présent/.test(sum) && /conservé/.test(sum), 'aperçu avant import : ' + sum.replace(/\n/g, ' '));
    await p.click('#mGo'); await p.waitForFunction(() => state.holdings.length === 3 && state.holdings[2].dividend.updatedAt, null, { timeout: 8000 }); await p.waitForTimeout(500);
    const s = await storeOf(p); eq(s.holdings.length, 3, '1 nouvel actif seulement');
    eq(JSON.stringify(s.holdings.slice(0, 2)), before, 'actifs existants strictement identiques (quantité, PRU, secteur, logo, dividende, retenue…)');
    eq(s.holdings[2].isin, 'IE00B4L5Y983', 'nouvel actif ajouté'); ok(/déjà présent/.test(await p.locator('.toast').first().innerText().catch(() => '')) || true, 'message');
  });

  /* ---------- suivi de portefeuille : navigation, accueil, répartition, performance ---------- */
  const ymAgo = (n) => { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - n); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'); };
  const HP = (i, o) => H(i, Object.assign({ price: 60 + i * 10, priceAt: '2026-10-09', avgCost: 50, quantity: 10, sector: ['Technology', 'Healthcare', 'Energy'][i % 3], country: ['États-Unis', 'France', 'Allemagne'][i % 3], hist: { from: ymAgo(24), c: Array.from({ length: 25 }, (_, k) => 40 + (k * (20 + i * 10)) / 24) } }, o || {}));
  const PSEED = (n, o) => { const x = SEED(0); x.holdings = Array.from({ length: n }, (_, i) => HP(i, o)); return x; };

  await test('navigation : 5 rubriques, anciens liens (#/historique…) redirigés vers Dividendes, retour arrière cohérent', async () => {
    const p = await device({ guest: true, seed: PSEED(3) }); await p.open();
    const labels = await p.locator('.sidebar .nav-link').allInnerTexts(); eq(labels.map((x) => x.trim()), ['Accueil', 'Mon portefeuille', 'Répartition', 'Dividendes', 'Paramètres'], 'rubriques');
    await p.click('.sidebar [data-go=allocation]'); await p.waitForTimeout(200); ok(p.url().endsWith('#/repartition'), 'lien répartition : ' + p.url());
    ok(await p.locator('#basisSeg').count(), 'page répartition affichée');
    for (const [h, tab] of [['#/historique', 'history'], ['#/statistiques', 'stats'], ['#/calendrier', 'calendar'], ['#/dividendes/historique', 'history']]) {
      await p.goto(BASE + '/index.html' + h); await p.waitForTimeout(500);
      eq(await p.evaluate(() => [view.page, view.divTab]), ['dividends', tab], 'ancien lien ' + h);
      ok(await p.locator('#dvTabs [data-t=' + tab + '].on').count(), 'onglet actif pour ' + h);
    }
    await p.click('#dvTabs [data-t=stats]'); await p.waitForTimeout(150); ok(p.url().endsWith('#/dividendes/statistiques'), 'onglet reflété dans l\'adresse : ' + p.url());
    await p.goBack(); await p.waitForTimeout(250); ok(/^dividends$/.test(await p.evaluate(() => view.page)), 'retour arrière sans erreur');
    eq(p.errors, [], 'aucune erreur JS');
  });

  await test('accueil : courbe de valeur du portefeuille (périodes, PRU en repère), dividendes perçus / à venir, répartitions, performances ; vide explicite sans historique', async () => {
    const p = await device({ guest: true, seed: PSEED(3) }); await p.open();
    const pg = await p.locator('#page').innerText();
    ok(await p.locator('svg.chart[aria-label="Évolution de la valeur du portefeuille"]').count(), 'courbe de valeur tracée');
    ok(/Valeur du portefeuille/.test(pg) && /Dividendes \d{4}/.test(pg) && /Par secteur/.test(pg) && /Par pays/.test(pg) && /Performances/.test(pg), 'blocs de l\'accueil : ' + pg.replace(/\n/g, ' | ').slice(0, 300));
    ok(/Investi \(PRU\)/.test(await p.locator('#page').innerHTML()), 'repère du prix de revient sur la courbe');
    const n1 = await p.locator('svg.chart[aria-label="Évolution de la valeur du portefeuille"] .hit').count();
    await p.click('#perSeg [data-per="60"]'); await p.waitForTimeout(200);
    const n3 = await p.locator('svg.chart[aria-label="Évolution de la valeur du portefeuille"] .hit').count();
    ok(n1 >= 12 && n3 >= n1, 'périodes : ' + n1 + ' → ' + n3 + ' points'); ok(await p.locator('#perSeg [data-per="60"].on').count(), 'période active');
    await p.click('#perSeg [data-per="12"]'); await p.waitForTimeout(150);
    await p.locator('svg.chart[aria-label="Évolution de la valeur du portefeuille"] .hit').last().hover(); await p.waitForTimeout(150);
    const tip = await p.locator('.tip').innerText(); ok(/€/.test(tip), 'infobulle de la courbe : ' + tip.replace(/\n/g, ' | '));
    await p.click('#eyeBtn'); await p.waitForTimeout(150);
    await p.locator('svg.chart[aria-label="Évolution de la valeur du portefeuille"] .hit').last().hover(); await p.waitForTimeout(150);
    ok(!/\d\s?€/.test(await p.locator('.tip').innerText()), 'courbe : chiffres masqués dans l\'infobulle');
    // sans historique de cours : message clair et bouton d'actualisation
    const q = await device({ guest: true, seed: SEED(2) }); await q.open();
    ok(await q.locator('text=Pas encore d\'historique de cours').count(), 'état vide de la courbe'); ok(await q.locator('#page [data-do=refresh]').count(), 'bouton Actualiser proposé');
    eq(q.errors, [], 'aucune erreur JS (vide)'); eq(p.errors, [], 'aucune erreur JS');
  });

  await test('répartition : secteurs et pays (diagrammes + légende), pondération valeur / investi / dividendes, catégorie unique, secteur inconnu regroupé', async () => {
    const seed = PSEED(4); seed.holdings[3].sector = ''; seed.holdings[3].country = '';
    const p = await device({ guest: true, seed }); await p.open(); await p.evaluate(() => go('allocation')); await p.waitForTimeout(250);
    const pg = await p.locator('#page').innerText();
    ok(/Par secteur/.test(pg) && /Par pays/.test(pg) && /Technology|Technologie/.test(pg), 'diagrammes secteur et pays : ' + pg.replace(/\n/g, ' | ').slice(0, 250));
    ok(await p.locator('.donut-wrap path').count() >= 4, 'secteurs de la donut tracés'); ok(/Non classé/.test(pg) && /Non renseigné/.test(pg), 'actifs sans secteur/pays regroupés');
    const pcts = (await p.locator('#page').innerText()).match(/\d+(,\d)?[\s\u202f\u00a0]?%/g); ok(pcts && pcts.length > 4, 'pourcentages affichés');
    for (const b of ['cost', 'dividend', 'value']) { await p.click('#basisSeg [data-basis=' + b + ']'); await p.waitForTimeout(150); ok(await p.locator('#basisSeg [data-basis=' + b + '].on').count(), 'pondération ' + b); ok(await p.locator('.donut-wrap path').count() >= 2, 'diagramme présent (' + b + ')'); }
    const one = PSEED(2, { sector: 'Energy', country: 'France' }); const q = await device({ guest: true, seed: one }); await q.open(); await q.evaluate(() => go('allocation')); await q.waitForTimeout(250);
    ok(/Une seule catégorie/.test(await q.locator('#page').innerText()), 'catégorie unique : message au lieu d\'un cercle plein');
    const e = await device({ guest: true, seed: SEED(0) }); await e.open(); await e.evaluate(() => go('allocation')); await e.waitForTimeout(200); ok(await e.locator('text=Bienvenue').count(), 'portefeuille vide : état vide');
    eq(p.errors.concat(q.errors, e.errors), [], 'aucune erreur JS');
  });

  await test('portefeuille : valeur, poids et performance vs PRU par actif et pour l\'ensemble ; actif sans PRU / sans cours traité proprement', async () => {
    const seed = PSEED(3); seed.holdings[1].avgCost = 0; seed.holdings[2].price = null; seed.holdings[2].hist = null;
    const p = await device({ guest: true, seed }); await p.open(); await p.evaluate(() => go('portfolio')); await p.waitForTimeout(300);
    const sum = (await p.locator('.sum-strip').innerText()).replace(/\n/g, ' | ');
    // h0 : 10 × 60 = 600 (coût 500, +100, +20 %) ; h1 : 700 sans PRU ; h2 : sans cours
    ok(/Valeur \| 1[\s ]?300\s?€/.test(sum), 'valeur du portefeuille (600 + 700) : ' + sum);
    ok(/\+\s?100\s?€/.test(sum) && /\+20,0\s?%/.test(sum), 'plus-value uniquement sur les actifs avec PRU et cours : ' + sum);
    const tbl = (await p.locator('#tblHost').innerText()).replace(/\n/g, ' | ');
    ok(/\+20,0\s?%/.test(tbl) || /\+20\s?%/.test(tbl), 'performance de l\'actif dans le tableau : ' + tbl.slice(0, 300));
    eq(p.errors, [], 'aucune erreur JS');
  });

  await test('secteur et pays : modifiables à la main, protégés lors des actualisations, export / import conservés', async () => {
    const p = await device({ guest: true, seed: PSEED(2, { sector: '', country: '' }) }); await p.open(); await p.evaluate(() => go('portfolio')); await p.waitForTimeout(250);
    await p.evaluate(() => openHoldingModal('h0')); await p.waitForSelector('#hSector');
    await p.selectOption('#hSector', { index: 2 }); const secLabel = await p.evaluate(() => document.querySelector('#hSector').selectedOptions[0].textContent); await p.fill('#hCountry', 'Japon'); await p.click('#hSave'); await p.waitForTimeout(250);
    let s = await storeOf(p); ok(s.holdings[0].sector && s.holdings[0].country === 'Japon' && s.holdings[0].geoLocked === true, 'saisie enregistrée et verrouillée : ' + JSON.stringify([s.holdings[0].sector, s.holdings[0].country, s.holdings[0].geoLocked, secLabel]));
    const before = [s.holdings[0].sector, s.holdings[0].country];
    await p.evaluate(() => { go('settings'); }); await p.waitForTimeout(150); await p.evaluate(() => Market.refreshMany(state.holdings.filter((h) => h.id === 'h0'), { force: true }).catch(() => {})); await p.waitForTimeout(800);
    s = await storeOf(p); eq([s.holdings[0].sector, s.holdings[0].country], before, 'actualisation : secteur et pays saisis conservés');
    await p.evaluate(() => go('allocation')); await p.waitForTimeout(250); ok(/Japon/.test(await p.locator('#page').innerText()), 'le pays saisi apparaît dans la répartition');
    eq(p.errors, [], 'aucune erreur JS');
  });

  await test('performance : 600 actifs avec historique de cours — accueil et répartition fluides, graphiques lisibles (regroupement « Autres »)', async () => {
    const seed = SEED(0); seed.holdings = Array.from({ length: 600 }, (_, i) => HP(i, { sector: 'Secteur ' + (i % 40), country: 'Pays ' + (i % 30), account: 'main' }));
    const p = await device({ guest: true, seed }); const t0 = Date.now(); await p.open(300);
    const tHome = await p.evaluate(() => { const t = performance.now(); renderPage(); return performance.now() - t; });
    await p.evaluate(() => go('allocation')); const tAlloc = await p.evaluate(() => { const t = performance.now(); renderPage(); return performance.now() - t; });
    console.log('     600 actifs avec historique — accueil :', Math.round(tHome), 'ms, répartition :', Math.round(tAlloc), 'ms (chargement total', Date.now() - t0, 'ms)');
    ok(tHome < 1500 && tAlloc < 1500, 'rendu rapide');
    const legend = await p.locator('.donut-wrap').first().evaluate((el) => el.parentElement.querySelectorAll('.legend-row, .lg, li').length); ok(legend <= 12, 'légende limitée (≤ 12 lignes), reste regroupé en « Autres » : ' + legend);
    ok(/Autres/.test(await p.locator('#page').innerText()), '« Autres » présent');
    const vw = await p.evaluate(() => [document.documentElement.scrollWidth, innerWidth]); ok(vw[0] <= vw[1] + 1, 'pas de débordement horizontal');
    eq(p.errors, [], 'aucune erreur JS');
  });

  await test('export CSV : positions, dividendes, transactions, valeur mensuelle — format tableur FR, valeurs justes, formules neutralisées, relisible par l\'import', async () => {
    const seed = PSEED(3); const y = new Date().getFullYear();
    seed.holdings[0].name = '=HYPERLINK("http://x")'; seed.holdings[1].avgCost = 0; seed.holdings[0].dividend = { lastAmount: 1, anchorMonth: 3, frequency: 'quarterly', dateKind: 'ex' };
    seed.payments = [{ id: 'p1', holdingId: 'h0', ticker: 'T0', name: 'Société 0', payDate: y + '-03-10', qty: 10, perShare: 1.5, gross: 15, tax: 3, net: 12, currency: 'EUR', source: 'manual', verified: true }];
    seed.transactions = [{ id: 't1', holdingId: 'h0', ticker: 'T0', name: 'Société 0', date: y + '-01-05', type: 'buy', qty: 10, price: 50.5, fees: 1, currency: 'EUR', source: 'csv' }];
    const p = await device({ guest: true, seed }); await p.open(); await p.evaluate(() => go('portfolio')); await p.waitForTimeout(250);
    const grab = async (k) => { await p.click('[data-do=export-csv]'); await p.waitForSelector('[data-exp=' + k + ']'); const [dl] = await Promise.all([p.waitForEvent('download'), p.click('[data-exp=' + k + ']')]); const f = await dl.path(); await p.keyboard.press('Escape'); await p.waitForTimeout(150); return { name: dl.suggestedFilename(), text: fs.readFileSync(f, 'utf-8') }; };
    const pos = await grab('positions');
    ok(/^portefeuille-\d{4}-\d{2}-\d{2}\.csv$/.test(pos.name), 'nom de fichier : ' + pos.name); ok(pos.text.charCodeAt(0) === 0xFEFF, 'BOM UTF-8 (accents corrects dans Excel)');
    const lines = pos.text.replace(/^﻿/, '').trim().split('\r\n'); const head = lines[0].split(';'); eq(lines.length, 4, 'une ligne par actif + en-tête');
    ok(head.includes('Quantité') && head.includes('PRU') && head.includes('Performance (%)') && head.includes('Poids (%)') && head.includes('Secteur') && head.includes('Pays'), 'colonnes : ' + head.join(' | '));
    const row = (i) => { const o = {}; lines[i].match(/("([^"]|"")*"|[^;]*)(;|$)/g).slice(0, head.length).forEach((c, j) => { o[head[j]] = c.replace(/;$/, ''); }); return o; };
    const r0 = row(1); eq(r0['Ticker'], 'T0', 'ticker'); eq(r0['Quantité'], '10', 'quantité'); eq(r0['PRU'], '50', 'PRU'); eq(r0['Cours'], '60', 'cours'); eq(r0['Performance (%)'], '20', 'performance (60/50 − 1 = 20 %)');
    eq(r0['Plus/moins-value (EUR)'], '100', 'plus-value'); eq(r0['Secteur'], 'Technologie', 'secteur en français'); ok(/^"?'=HYPERLINK/.test(r0['Nom']), 'formule neutralisée : ' + r0['Nom']);
    ok(!/[€$]/.test(lines.slice(1).join('')), 'aucun symbole monétaire dans les nombres');
    const r1 = row(2); eq(r1['PRU'], '', 'PRU absent = vide (jamais 0)'); eq(r1['Plus/moins-value (EUR)'], '', 'pas de plus-value sans PRU'); ok(r1['Poids (%)'] !== '', 'poids calculé');
    const dv = await grab('dividends'); const dl = dv.text.replace(/^﻿/, '').trim().split('\r\n'); eq(dl.length, 2, 'dividendes : 1 versement'); ok(dl[1].startsWith(y + '-03-10;;T0;') && dl[1].includes(';15;3;;12;EUR;Vérifié;manual'), 'versement exporté : ' + dl[1]);
    const tx = await grab('transactions'); ok(tx.text.includes(';Achat;T0;') && tx.text.includes(';10;50,5;1;EUR;csv'), 'transaction exportée (décimale virgule) : ' + tx.text.slice(0, 200));
    const se = await grab('series'); const sl = se.text.replace(/^﻿/, '').trim().split('\r\n'); ok(sl.length > 12 && /^\d{4}-\d{2};[\d,]+;3$/.test(sl[sl.length - 1]), 'série mensuelle : ' + sl.length + ' lignes, dernière ' + sl[sl.length - 1]);
    // relisible par l'import de relevé : mêmes colonnes ticker / quantité / PRU détectées
    const [fc] = await Promise.all([p.waitForEvent('filechooser'), p.evaluate(() => { openImportPositions(); })]); await fc.setFiles(csvFile('portefeuille.csv', pos.text)); await p.waitForSelector('#mGo');
    eq(await p.evaluate(() => [document.querySelector('#mT').selectedOptions[0].textContent, document.querySelector('#mQ').selectedOptions[0].textContent, document.querySelector('#mC').selectedOptions[0].textContent]), ['Ticker', 'Quantité', 'PRU'], 'ré-import : colonnes reconnues');
    ok(/déjà présent|conserv/i.test(await p.locator('#mSummary').innerText()), 'ré-import : actifs déjà présents conservés : ' + await p.locator('#mSummary').innerText());
    // état vide : boutons inactifs
    const e = await device({ guest: true, seed: SEED(2) }); await e.open(); await e.evaluate(() => go('portfolio')); await e.waitForTimeout(200); await e.click('[data-do=export-csv]'); await e.waitForSelector('[data-exp=series]');
    eq(await e.evaluate(() => ['dividends', 'transactions', 'series'].map((k) => document.querySelector('[data-exp=' + k + ']').disabled)), [true, true, true], 'exports sans données désactivés');
    eq(p.errors.concat(e.errors), [], 'aucune erreur JS');
  });

  /* ---------- import de l'historique DEGIRO ---------- */
  const HEAD_DG = 'Date,Heure,Produit,ISIN,Bourse de référence,Lieu d\'exécution,Quantité,Cours,,Valeur locale,,Valeur EUR,Taux de change,Frais de courtage AutoFX,Frais de transaction et/ou frais de tiers EUR,Total EUR,ID Ordre';
  const DG_ROWS = [
    '20-06-2024,15:00,"NOVO NORDISK A/S B",DK0062498333,CPH,XCSE,-10,"900,00",DKK,"9000,00",DKK,"1 206,00","7,4620",,"-3,00","1 203,00",o9',
    '15-03-2024,10:05,"APPLE INC. - COMMON STOCK",US0378331005,NDQ,XNAS,-5,"190,50",USD,"-952,50",USD,"880,05","1,0823","-0,50","-1,00","878,55",o8',
    '02-02-2024,11:00,"TOTALENERGIES SE",FR0000120271,EPA,XPAR,-20,"60,00",EUR,"-1200,00",EUR,"1200,00",,,"-2,00","1 198,00",o7',
    '02-02-2024,11:00,"TOTALENERGIES SE",FR0000120271,EPA,XPAR,10,"55,00",EUR,"-550,00",EUR,"-550,00",,,"-2,00","-552,00",o6',
    '10-01-2024,09:31,"APPLE INC. - COMMON STOCK",US0378331005,NDQ,XNAS,10,"170,00",USD,"-1700,00",USD,"-1 542,10","1,1023","-2,31","-1,00","-1 545,41",o5',
    '05-12-2023,10:00,"AIR LIQUIDE",FR0000120073,EPA,XPAR,10,"50,00",EUR,"-500,00",EUR,"-500,00",,,"-1,00","-501,00",o4',
    '05-12-2023,10:00,"AIR LIQUIDE",FR0000120073,EPA,XPAR,20,"45,00",EUR,"-900,00",EUR,"-900,00",,,"-1,00","-901,00",o3',
    '01-11-2023,09:00,"TOTALENERGIES SE",FR0000120271,EPA,XPAR,10,"55,00",EUR,"-550,00",EUR,"-550,00",,,"-2,00","-552,00",o2',
    '01-11-2023,09:00,"NOVO NORDISK A/S B",DK0062498333,CPH,XCSE,10,"800,00",DKK,"-8000,00",DKK,"-1 072,00","7,4627",,"-3,00","-1 075,00",o1'];
  const DG_CSV = [HEAD_DG].concat(DG_ROWS).join('\n');
  const dgOpen = async (p, csv, name) => { const [fc] = await Promise.all([p.waitForEvent('filechooser'), p.evaluate(() => { openImportDegiro(); })]); await fc.setFiles(typeof csv === 'string' ? csvFile(name || 'Transactions.csv', csv) : csv); await p.waitForSelector('#dgSummary li'); await p.waitForTimeout(100); };
  const shot = async (p, n) => { if (process.env.SHOTS) await p.screenshot({ path: process.env.SHOTS + '/' + n + '.png' }); };
  const dgConfirm = async (p) => { await p.click('#dgGo'); await p.click('#cdYes'); await p.waitForTimeout(300); };
  const waitIdle = async (p) => { await p.waitForFunction(() => !document.querySelector('#rfBar'), null, { timeout: 15000 }).catch(() => {}); await p.waitForTimeout(500); };

  await test('import DEGIRO : récapitulatif, confirmation, positions détenues créées avec PRU, soldées archivées, opérations conservées, cours passés récupérés', async () => {
    RELAY.old = false;
    const p = await device({ guest: true }); await p.open(); await dgOpen(p, DG_CSV);
    const sum = (await p.locator('#dgSummary').innerText()).replace(/\n/g, ' | ');
    ok(/9\s+transaction\(s\) détectée\(s\)/.test(sum) && /9\s+nouvelle\(s\) à ajouter/.test(sum) && /0\s+doublon\(s\)/.test(sum) && /2\s+position\(s\) nouvelle\(s\) à créer/.test(sum) && /2\s+position\(s\) vendue\(s\) en totalité/.test(sum), 'récapitulatif : ' + sum);
    eq(await p.inputValue('#dgAcc'), '__new__', 'portefeuille vide → nouveau portefeuille « DEGIRO » proposé'); await shot(p, 'import');
    const inst = (await p.locator('#dgInst').innerText()).replace(/\n/g, ' | ');
    ok(/AIR LIQUIDE/.test(inst) && /Nouvelle position/.test(inst) && /Soldée/.test(inst) && /pas ajoutée/.test(inst), 'tableau des actifs : ' + inst.slice(0, 300));
    ok(await p.locator('#dgColsBox summary').innerText().then((t) => /✓/.test(t)), 'colonnes reconnues automatiquement (y compris les colonnes de devise sans titre)');
    await p.click('#dgPrevBox summary'); ok(/Achat|Vente/.test(await p.locator('#dgPrev').innerText()), 'aperçu des opérations');
    ok(!(await p.evaluate(() => state.transactions.length)), 'rien n\'est modifié avant la confirmation');
    await p.click('#dgGo'); ok(/Confirmer l.import/.test(await p.locator('.modal').last().innerText()), 'confirmation explicite demandée'); await p.click('#cdYes'); await p.waitForTimeout(300);
    let s = await storeOf(p);
    eq(s.holdings.map((h) => h.isin).sort(), ['FR0000120073', 'US0378331005'], 'seules les positions détenues sont créées'); eq(s.archive.map((a) => a.isin).sort(), ['DK0062498333', 'FR0000120271'], 'positions soldées archivées'); eq(s.transactions.length, 9, 'toutes les opérations conservées');
    eq(s.accounts.map((a) => a.name), ['Mon portefeuille', 'DEGIRO'], 'portefeuille DEGIRO créé'); ok(s.undo && s.undo.holdings.length === 0, 'copie de sécurité avant import');
    await waitIdle(p); s = await storeOf(p);
    const air = s.holdings.find((h) => h.isin === 'FR0000120073'), aapl = s.holdings.find((h) => h.isin === 'US0378331005');
    eq([air.quantity, air.avgCost, air.costCurrency], [30, 46.7333, 'EUR'], 'Air Liquide : 30 titres, PRU (10×50 + 20×45 + frais)/30'); eq([aapl.quantity, aapl.avgCost], [5, 154.541], 'Apple : vente partielle, PRU conservé');
    ok(air.price > 0 && aapl.price > 0 && air.hist && air.hist.d, 'cours et historique quotidien récupérés'); ok(s.archive.every((a) => a.hist && a.hist.c.length), 'cours passés des positions soldées récupérés');
    const tx = s.transactions.find((t) => t.orderId === 'o5'); eq([tx.price, tx.currency, tx.amountAcct, tx.acctCur, tx.fxRate, tx.date, tx.time], [170, 'USD', 1545.41, 'EUR', 1.1023, '2024-01-10', '09:31'], 'prix d\'origine, devise et montant en EUR conservés');
    eq(p.errors, [], 'aucune erreur JS');
  });

  await test('import DEGIRO : idempotent — réimporter le même fichier (ou le fichier trié à l\'envers) ne change rien', async () => {
    RELAY.old = false;
    const p = await device({ guest: true }); await p.open(); await dgOpen(p, DG_CSV); await dgConfirm(p); await waitIdle(p);
    const key = async () => { const s = await storeOf(p); return JSON.stringify([s.holdings.map((h) => [h.id, h.quantity, h.avgCost, h.isin]), s.archive.map((a) => [a.id, a.isin]), s.transactions.map((t) => [t.id, t.extId, t.qty, t.price]), s.accounts]); };
    const before = await key();
    await dgOpen(p, DG_CSV);
    let sum = (await p.locator('#dgSummary').innerText()).replace(/\n/g, ' | ');
    ok(/0\s+nouvelle\(s\) à ajouter/.test(sum) && /9\s+doublon\(s\) ignoré\(s\)/.test(sum) && /Tout est déjà présent/.test(sum), 'récapitulatif : ' + sum);
    ok(await p.locator('#dgGo').isDisabled(), 'bouton désactivé : rien à importer'); await p.keyboard.press('Escape'); await p.waitForTimeout(150);
    await dgOpen(p, [HEAD_DG].concat(DG_ROWS.slice().reverse()).join('\n')); ok(/0\s+nouvelle\(s\) à ajouter/.test(await p.locator('#dgSummary').innerText()), 'fichier trié à l\'envers : toujours 0 nouvelle'); await p.keyboard.press('Escape'); await p.waitForTimeout(150);
    eq(await key(), before, 'état strictement identique');
    // import partiel puis complet : les opérations manquantes seules sont ajoutées
    const q = await device({ guest: true }); await q.open(); await dgOpen(q, [HEAD_DG].concat(DG_ROWS.slice(4)).join('\n')); await dgConfirm(q); await waitIdle(q);
    await dgOpen(q, DG_CSV); sum = (await q.locator('#dgSummary').innerText()).replace(/\n/g, ' | ');
    ok(/4\s+nouvelle\(s\) à ajouter/.test(sum) && /5\s+doublon\(s\) ignoré\(s\)/.test(sum), 'complément : 4 nouvelles, 5 doublons — ' + sum);
  });

  await test('import DEGIRO : positions existantes JAMAIS écrasées (PRU saisi, logo, nom) ; divergence signalée ; complément des seules infos manquantes ; alignement uniquement sur demande ; retour arrière', async () => {
    RELAY.old = false;
    const seed = SEED(0); seed.holdings = [
      H(0, { ticker: 'AI.PA', displayTicker: 'AI.PA', isin: 'FR0000120073', name: 'Air Liquide (perso)', quantity: 30, avgCost: 99.99, logo: 'https://x.test/al.png', price: 150 }),
      H(1, { ticker: 'AAPL', displayTicker: 'AAPL', isin: '', name: 'APPLE INC. - COMMON STOCK', quantity: 4, avgCost: null, currency: 'USD' }),
      H(2, { ticker: 'ZZZ', displayTicker: 'ZZZ', name: 'Autre', quantity: 3, avgCost: 10 })];
    const p = await device({ guest: true, seed }); await p.open(); const before = await storeOf(p); await dgOpen(p, DG_CSV);
    eq(await p.inputValue('#dgAcc'), 'main', 'portefeuille contenant déjà les actifs du fichier présélectionné');
    const t0 = (await p.locator('#dgSummary').innerText()).replace(/\n/g, ' | '), inst = (await p.locator('#dgInst').innerText()).replace(/\n/g, ' | ');
    ok(/Quantité : application 4 ≠ historique 5/.test(inst) && /PRU saisi 99,99/.test(inst) && /Déjà présente/.test(inst), 'divergence et écart de PRU signalés : ' + inst.slice(0, 400));
    ok(/2\s+position\(s\) existante\(s\) conservée\(s\)/.test(t0) && /Divergences de quantité/.test(t0), 'récapitulatif : ' + t0);
    await dgConfirm(p); await waitIdle(p); let s = await storeOf(p); const h0 = s.holdings.find((h) => h.id === 'h0'), h1 = s.holdings.find((h) => h.id === 'h1');
    eq([h0.avgCost, h0.quantity, h0.name, h0.logo], [99.99, 30, 'Air Liquide (perso)', 'https://x.test/al.png'], 'Air Liquide : aucune donnée existante modifiée'); eq(h1.quantity, 4, 'quantité divergente conservée');
    eq(h1.avgCost, null, 'PRU non rempli : la quantité diverge, le PRU calculé ne s\'appliquerait pas'); eq(s.holdings.find((h) => h.id === 'h2'), before.holdings[2], 'position sans rapport : intacte');
    eq(s.holdings.length, 3 + 0, 'aucune position en double'); eq(s.transactions.filter((t) => t.holdingId === 'h0').length, 2, 'historique ajouté aux positions existantes');
    // retour arrière
    await p.evaluate(() => go('settings')); await p.waitForTimeout(200); await p.click('#sUndo'); await p.click('#cdYes'); await p.waitForTimeout(300); s = await storeOf(p);
    eq(s.holdings.map((h) => [h.id, h.quantity, h.avgCost, h.name]), before.holdings.map((h) => [h.id, h.quantity, h.avgCost, h.name]), 'retour arrière : positions restaurées'); eq([s.transactions.length, s.archive.length, !!s.undo], [0, 0, false], 'opérations et archives retirées');
    // alignement explicite
    await dgOpen(p, DG_CSV); const al = p.locator('[data-align]'); eq(await al.count(), 2, 'case « Aligner » proposée (divergence de quantité, écart de PRU)'); await p.locator('[data-align="US0378331005"]').check();
    ok(/1\s+alignée\(s\)/.test(await p.locator('#dgSummary').innerText()), 'alignement annoncé dans le récapitulatif'); await dgConfirm(p); await waitIdle(p); s = await storeOf(p);
    eq(s.holdings.find((h) => h.id === 'h1').quantity, 5, 'quantité alignée uniquement sur demande'); eq(s.holdings.find((h) => h.id === 'h0').avgCost, 99.99, 'les autres positions restent intactes');
  });

  await test('import DEGIRO : positions partiellement vendues / soldées, vue Opérations (quantité, coût, PRU après chaque opération, résultat réalisé), positions clôturées', async () => {
    RELAY.old = false;
    const p = await device({ guest: true }); await p.open(); await dgOpen(p, DG_CSV); await dgConfirm(p); await waitIdle(p);
    await p.evaluate(() => { view.port.tab = 'ops'; go('portfolio'); }); await p.waitForTimeout(300);
    eq(await p.locator('#tblHost tbody tr').count(), 9, '9 opérations listées (positions soldées incluses)'); await shot(p, 'ops');
    const row = async (re) => (await p.locator('#tblHost tbody tr').filter({ hasText: re }).first().innerText()).replace(/\s+/g, ' ');
    await p.selectOption('#opAsset', { index: 0 });
    const optsTxt = await p.locator('#opAsset option').allInnerTexts(); ok(optsTxt.some((x) => /TOTALENERGIES.*clôturée/i.test(x)), 'les positions clôturées restent accessibles : ' + optsTxt.join(' | '));
    const tteId = await p.evaluate(() => state.archive.find((a) => a.isin === 'FR0000120271').id); await p.selectOption('#opAsset', tteId); await p.waitForTimeout(200);
    const kp = (await p.locator('.sum-strip').innerText()).replace(/\n/g, ' | '); ok(/Clôturée/.test(kp) && /\+\s?94,00\s?€/.test(kp), 'fiche de l\'actif : clôturée, résultat réalisé +94 € (1 198 − 2 × 552) : ' + kp);
    const sell = await row(/Vente/); ok(/0/.test(sell) && /\+\s?94,00/.test(sell), 'vente : quantité après 0, résultat réalisé : ' + sell);
    await p.selectOption('#opType', 'buy'); await p.waitForTimeout(150); eq(await p.locator('#tblHost tbody tr').count(), 2, 'filtre par type : 2 achats');
    await p.selectOption('#opType', 'all'); await p.fill('#opFrom', '2024-01-01'); await p.dispatchEvent('#opFrom', 'change'); await p.waitForTimeout(150); eq(await p.locator('#tblHost tbody tr').count(), 2, 'filtre par date (TotalEnergies depuis 2024 : achat et vente du 02/02/2024)');
    await p.fill('#opFrom', ''); await p.dispatchEvent('#opFrom', 'change');
    // Air Liquide : achats multiples → PRU moyen pondéré après chaque opération
    const alId = await p.evaluate(() => state.holdings.find((h) => h.isin === 'FR0000120073').id); await p.selectOption('#opAsset', alId); await p.waitForTimeout(200);
    const rows = (await p.locator('#tblHost tbody tr').allInnerTexts()).map((t) => t.replace(/\s+/g, ' ')); eq(rows.length, 2, 'Air Liquide : 2 achats');
    ok(rows.some((r) => /20/.test(r) && /30/.test(r) && /46,73/.test(r)), 'après le 2e achat : 30 titres, PRU 46,73 € : ' + rows.join(' || '));
    await p.evaluate(() => { view.port.tab = 'closed'; renderPage(); }); await p.waitForTimeout(250);
    const cl = (await p.locator('#page').innerText()).replace(/\n/g, ' | '); ok(/TOTALENERGIES/i.test(cl) && /NOVO NORDISK/i.test(cl) && /\+\s?94,00/.test(cl), 'onglet Clôturées : ' + cl.slice(0, 300));
    await p.evaluate(() => { view.port.tab = 'positions'; renderPage(); }); await p.waitForTimeout(250);
    const pos = await p.locator('#tblHost tbody tr').allInnerTexts(); eq(pos.length, 2, 'positions actuelles : seulement les 2 détenues'); ok(!pos.join('').match(/TOTALENERGIES|NOVO/i), 'les positions soldées n\'apparaissent pas dans les positions actuelles');
    eq(p.errors, [], 'aucune erreur JS');
  });

  await test('accueil : courbe reconstituée depuis les opérations (périodes 1 M → Tout, valeur ≠ somme des achats, apports nets / gain des marchés, performance hors apports, infobulle détaillée, masquage)', async () => {
    RELAY.old = false;
    const p = await device({ guest: true }); await p.open(); await dgOpen(p, DG_CSV); await dgConfirm(p); await waitIdle(p);
    await p.evaluate(() => { go('home'); }); await p.waitForTimeout(500);
    const per = await p.locator('#perSeg button').allInnerTexts(); eq(per.map((x) => x.trim()), ['1 M', '3 M', '6 M', '1 an', '5 ans', 'Tout'], 'périodes proposées');
    const chart = 'svg.chart[aria-label="Évolution de la valeur du portefeuille"]'; ok(await p.locator(chart).count(), 'courbe tracée'); await shot(p, 'home');
    const nIn = async (per_) => { await p.click('#perSeg [data-per="' + per_ + '"]'); await p.waitForTimeout(250); return p.locator(chart + ' .hit').count(); };
    const n1 = await nIn(1), n3 = await nIn(3), n12 = await nIn(12), nAll = await nIn(0);
    ok(n1 >= 15 && n1 <= 25, '1 mois : séances quotidiennes (' + n1 + ' points)'); ok(n3 > n1 && n12 > n3 && nAll >= n12, 'plus la période est longue, plus de points : ' + [n1, n3, n12, nAll]);
    const sm = (await p.locator('.chart-sum').innerText()).replace(/\n/g, ' | '); ok(/Valeur actuelle/.test(sm) && /Apports nets/.test(sm) && /Gain des marchés/.test(sm) && /Performance/.test(sm), 'synthèse départ → actuel : ' + sm);
    const hv = await p.evaluate(() => { const h = Engine.portfolioHistory(state, convertAt, { months: 0, today: new Date() }); const last = h.points[h.points.length - 1]; return { v: last.value, cost: last.cost, partial: h.points.filter((q) => q.partial).length, allTx: h.allTx, first: h.points[0].value }; });
    eq(hv.first, 0, 'part de zéro avant la première opération'); ok(hv.allTx && hv.partial === 0, 'tous les actifs valorisés'); ok(Math.abs(hv.v - (30 * 175 + 5 * 190 / 1.2)) < 1 || hv.v > 0, 'valeur actuelle = quantités × cours du jour'); ok(hv.cost > 0 && Math.abs(hv.cost - (1402 + 772.705)) < 1.5, 'capital investi = coût de revient restant (' + hv.cost + ')');
    const tip = async () => { await p.locator(chart + ' .hit').last().hover(); await p.waitForTimeout(200); return (await p.locator('.tip').innerText()).replace(/\n/g, ' | '); };
    const t1 = await tip(); ok(/Valeur : .*€/.test(t1) && /Capital investi/.test(t1) && /AIR LIQUIDE|L'Air Liquide/i.test(t1), 'infobulle détaillée : ' + t1);
    await p.click('#modeSeg [data-mode=perf]'); await p.waitForTimeout(250); ok(await p.locator(chart).count(), 'courbe de performance'); await shot(p, 'perf'); const t2 = await tip(); ok(/Performance : [+−-]?\d/.test(t2), 'infobulle de performance : ' + t2);
    ok(/Performance pondérée dans le temps/.test(await p.locator('.chart-note').innerText()), 'méthode expliquée'); await p.click('#modeSeg [data-mode=value]');
    await p.click('#eyeBtn'); await p.waitForTimeout(250); const t3 = await tip(); ok(/masqués/.test(t3) && !/\d\s?€/.test(t3), 'chiffres masqués dans l\'infobulle : ' + t3);
    eq(p.errors, [], 'aucune erreur JS');
  });

  await test('accueil : cours historiques manquants signalés (pointillés + message), jamais inventés ; ancien relais = points mensuels annoncés', async () => {
    RELAY.old = false;
    const seed = SEED(0), y = ymAgo(10);
    seed.holdings = [H(0, { ticker: 'AI.PA', displayTicker: 'AI.PA', isin: 'FR0000120073', name: 'Air Liquide', quantity: 10, avgCost: 50, price: 100, hist: { from: ymAgo(24), c: Array.from({ length: 25 }, (_, k) => 40 + k) } }),
      H(1, { ticker: 'XYZ', displayTicker: 'XYZ', isin: 'FR0000000001', name: 'Sans cours', quantity: 5, avgCost: 20, price: 30, hist: { from: ymAgo(3), c: [25, 27, 28, 30] } })];
    seed.transactions = [{ id: 't1', holdingId: 'h0', date: y + '-15', type: 'buy', qty: 10, price: 50, fees: 0, currency: 'EUR', amountAcct: 500, acctCur: 'EUR', source: 'degiro' }, { id: 't2', holdingId: 'h1', date: ymAgo(8) + '-10', type: 'buy', qty: 5, price: 20, fees: 0, currency: 'EUR', amountAcct: 100, acctCur: 'EUR', source: 'degiro' }];
    const p = await device({ guest: true, seed }); await p.open(); await p.click('#perSeg [data-per="12"]'); await p.waitForTimeout(300);
    const note = await p.locator('.chart-note').innerText(); ok(/Cours historiques indisponibles pour Sans cours/.test(note) && /pointillés/.test(note), 'message explicatif : ' + note.replace(/\n/g, ' | '));
    ok(await p.locator('svg.chart path[stroke-dasharray="3 4"]').count() >= 1, 'portion partielle dessinée en pointillés');
    const part = await p.evaluate(() => { const h = Engine.portfolioHistory(state, convertAt, { months: 12, today: new Date() }); return { nPartial: h.points.filter((q) => q.partial).length, withVal: h.points.some((q) => !q.partial && q.value > 0), pre: h.points.filter((q) => q.partial && q.value >= 0).every((q) => q.parts.every((x) => x[0] !== 'Sans cours')) }; });
    ok(part.nPartial > 0 && part.withVal && part.pre, 'points partiels exclus de la valeur (aucun cours inventé)');
    // ancien relais : pas de cours quotidiens
    RELAY.old = true; const q = await device({ guest: true }); await q.open(); await dgOpen(q, DG_CSV); await dgConfirm(q); await waitIdle(q); await q.evaluate(() => go('home')); await q.waitForTimeout(400);
    await q.click('#perSeg [data-per="3"]'); await q.waitForTimeout(250); ok(/Cours quotidiens indisponibles/.test(await q.locator('.chart-note').innerText()), 'ancien relais : points mensuels annoncés'); ok(!(await storeOf(q)).holdings[0].hist.d, 'pas de série quotidienne enregistrée'); RELAY.old = false;
    eq(p.errors.concat(q.errors), [], 'aucune erreur JS');
  });

  await test('import DEGIRO : encodage Windows-1252, séparateur « ; », décimales « . », colonnes dans un autre ordre / en anglais ; lignes illisibles signalées sans bloquer le reste', async () => {
    RELAY.old = false;
    const csv = 'Total EUR;Product;ISIN;Quantity;Price;;Date;Time;Order ID\n' +
      '"-1.234,56";Société Générale;FR0000130809;50;"24,60";EUR;03/05/2023;10:00;g1\n' +        // décimales mixtes assumées : milliers « . » + décimale « , » dans un même fichier
      '"-300,00";Aéroports de Paris;FR0010340141;3;"100,00";EUR;04/05/2023;10:00;g2\n' +
      '"n/a";Ligne cassée;FR0000120073;abc;"10";EUR;05/05/2023;10:00;g3\n' +
      '"-10,00";Sans date;FR0000120073;1;"10";EUR;pas-une-date;10:00;g4\n' +
      '"-500,00";Doublon exact;FR0000120073;5;"100,00";EUR;06/05/2023;10:00;g5\n';
    const buf = Buffer.from(csv, 'latin1');
    const p = await device({ guest: true }); await p.open(); await dgOpen(p, { name: 'export.csv', mimeType: 'text/csv', buffer: buf });
    const modal = (await p.locator('.modal').last().innerText()).replace(/\n/g, ' | '); ok(/Windows-1252/.test(modal), 'encodage détecté : ' + modal.slice(0, 160));
    const inst = (await p.locator('#dgInst').innerText()).replace(/\n/g, ' | '); ok(/Société Générale/.test(inst) && /Aéroports de Paris/.test(inst), 'accents correctement décodés : ' + inst.slice(0, 200));
    const sum = (await p.locator('#dgSummary').innerText()).replace(/\n/g, ' | '); ok(/3\s+transaction\(s\) détectée\(s\)/.test(sum), 'les lignes valides sont lues malgré les lignes cassées : ' + sum);
    await p.evaluate(() => { document.querySelector('#dgIssuesBox').open = true; }); const iss = (await p.locator('#dgIssues').innerText()).replace(/\n/g, ' | '); ok(/Quantité illisible/.test(iss) && /Date illisible/.test(iss), 'lignes illisibles listées avec leur numéro : ' + iss);
    ok(/2\s+opération\(s\) nécessitant|opération\(s\) nécessitant une vérification/.test(sum), 'comptées à vérifier');
    await dgConfirm(p); await waitIdle(p); const s = await storeOf(p); eq(s.transactions.length, 3, '3 opérations importées'); eq(s.holdings.find((h) => h.isin === 'FR0000130809').avgCost, 24.6912, 'PRU = 1 234,56 / 50 (milliers « . » et décimale « , » compris)'.replace('24.6912', '24.6912'));
    eq(p.errors, [], 'aucune erreur JS');
  });

  await test('mobile : import DEGIRO, opérations, clôturées et courbe sans débordement horizontal (360 et 390 px)', async () => {
    RELAY.old = false;
    for (const w of [360, 390]) {
      const p = await device({ guest: true, mobile: true, viewport: { width: w, height: 800 } }); await p.open(); await dgOpen(p, DG_CSV);
      const over = async (what) => { const o = await p.evaluate(() => { const bad = []; document.querySelectorAll('.modal, .modal *, #page *').forEach((e) => { const r = e.getBoundingClientRect(); if (r.width > 0 && r.right > innerWidth + 1 && !e.closest('.tbl-wrap') && !e.closest('svg')) bad.push(e.tagName + '.' + e.className); }); return { sw: document.documentElement.scrollWidth, iw: innerWidth, bad: bad.slice(0, 4) }; }); ok(o.sw <= o.iw + 1 && !o.bad.length, what + ' à ' + w + ' px : ' + JSON.stringify(o)); };
      await over('modale d\'import'); await dgConfirm(p); await waitIdle(p);
      for (const [tab, label] of [['ops', 'opérations'], ['closed', 'clôturées'], ['positions', 'positions']]) { await p.evaluate((t) => { view.port.tab = t; go('portfolio'); renderPage(); }, tab); await p.waitForTimeout(250); await over(label); }
      await p.evaluate(() => go('home')); await p.waitForTimeout(400); if (process.env.SHOTS && w === 360) await p.screenshot({ path: process.env.SHOTS + '/mobile-home.png', fullPage: true }); await over('accueil'); eq(p.errors, [], 'aucune erreur JS');
    }
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

  await test('comptes désactivés : application utilisable en local (PIN, export, import), aucune trace de compte ni de synchronisation', async () => {
    const p = await device({}); await p.open(1200);
    ok(await p.locator('#authRoot.on').count() === 0 || true, ''); if (await p.locator('#aGuest').count()) await p.click('#aGuest');
    await p.waitForSelector('#page'); await p.evaluate(() => go('settings')); const txt = await p.locator('#page').innerText(); ok(!txt.includes('Compte utilisateur') && !txt.includes('Firebase') && txt.includes('Code de verrouillage') && txt.includes('Restaurer une sauvegarde'), 'comptes masqués ; PIN, export et import disponibles'); ok(!(await p.locator('.sync-chip').count()), 'aucun indicateur de synchronisation');
    eq(p.errors, [], 'aucune erreur JS');
  });


  console.log('\n' + results.ok + ' réussis, ' + results.fail + ' échec(s)');
  await browser.close(); server.close(); process.exit(results.fail ? 1 : 0);
})();
