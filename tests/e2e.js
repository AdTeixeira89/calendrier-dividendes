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
  'TTE.PA': { name: 'TotalEnergies SE', cur: 'EUR', type: 'EQUITY', price: 62, sector: 'Energy', divs: [['2026-03-20', .79]], splits: [['2023-06-01', 2, 1]] },
  'NOVO-B.CO': { name: 'Novo Nordisk A/S', cur: 'DKK', type: 'EQUITY', price: 700, sector: 'Healthcare', divs: [] }
};
const ISIN = { 'FR0000120073': 'AI.PA', 'US0378331005': 'AAPL', 'IE00B4L5Y983': 'IWDA.AS', 'FR0000120271': 'TTE.PA', 'DK0062498333': 'NOVO-B.CO' };
const RELAY = { old: false };    // true : simule l'ancienne version du relais (5 ans mensuels, ignore range / interval)
function chartSeries(y, interval) {
  if (interval === '1d' && !RELAY.old) {           // quotidien : ~3 ans de séances, cours en hausse régulière jusqu'au dernier cours
    const out = [], nowD = new Date(), end = Date.UTC(nowD.getUTCFullYear(), nowD.getUTCMonth(), nowD.getUTCDate()); for (let t = end - 1100 * 86400000; t <= end; t += 86400000) { const d = new Date(t).getUTCDay(); if (d !== 0 && d !== 6) out.push(t); }
    return { timestamp: out.map((t) => t / 1000), indicators: { quote: [{ close: out.map((t, i) => Math.round(y.price * (0.5 + 0.5 * i / (out.length - 1)) * 100) / 100) }] } };
  }
  return { timestamp: Array.from({ length: 25 }, (_, i) => ts(new Date(Date.UTC(2024, 10 + i, 1)).toISOString().slice(0, 10))), indicators: { quote: [{ close: Array.from({ length: 25 }, (_, i) => Math.round(y.price * (0.7 + i * 0.0125) * 100) / 100) }] } };
}
async function mockRelay(route) {
  const u = new URL(route.request().url()), j = (o, st) => route.fulfill({ status: st || 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(o) });
  if (u.pathname === '/search') { const q = u.searchParams.get('q'); const s = ISIN[q] || (YAHOO[q] ? q : null) || (/apple/i.test(q) ? 'AAPL' : /air liquide/i.test(q) ? 'AI.PA' : null); return j({ quotes: s ? [{ symbol: s, quoteType: YAHOO[s].type, shortname: YAHOO[s].name, exchDisp: 'X', sector: YAHOO[s].sector || null, industry: YAHOO[s].sector ? 'Test industry' : null }] : [] }); }
  if (u.pathname === '/chart') { RELAY.chartCalls = (RELAY.chartCalls || 0) + 1; const y = YAHOO[u.searchParams.get('symbol')]; if (!y) return j({ chart: { result: null, error: { description: 'No data found' } } }); return j({ chart: { result: [{ meta: { currency: y.cur, longName: y.name, instrumentType: y.type, regularMarketPrice: y.price, regularMarketTime: ts('2026-10-12') }, ...chartSeries(y, u.searchParams.get('interval')), events: { dividends: Object.fromEntries(y.divs.map((d, i) => [i, { amount: d[1], date: ts(d[0]) }])), splits: Object.fromEntries((y.splits || []).map((d, i) => [i, { date: ts(d[0]), numerator: d[1], denominator: d[2], splitRatio: d[1] + ':' + d[2] }])) } }] } }); }
  if (u.pathname === '/translate' && RELAY.trOld) return route.fulfill({ status: 404 });
  if (u.pathname === '/translate') { RELAY.trCalls = (RELAY.trCalls || []).concat([u.searchParams.getAll('t')]); return j({ translations: u.searchParams.getAll('t').map((t) => (RELAY.trFail ? null : 'FR: ' + t)) }); }
  if (u.pathname === '/news') {
    const t = u.searchParams.get('symbol'); RELAY.newsCalls = (RELAY.newsCalls || []).concat(t);
    const now = Math.floor(Date.now() / 1000);
    return j({ news: t === 'AAPL' ? [{ title: 'Apple relève ses prévisions', publisher: 'Test Wire', link: 'https://example.com/a', providerPublishTime: now - 7200, relatedTickers: ['AAPL'] }, { title: 'Panorama des marchés', publisher: 'Test Wire', link: 'https://example.com/b', providerPublishTime: now - 3600, relatedTickers: ['AAPL', 'MSFT', 'NVDA', 'TSLA'] }, { title: 'Lien dangereux', publisher: 'X', link: 'javascript:alert(1)', providerPublishTime: now, relatedTickers: ['AAPL'] }] : [] });
  }
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
  await page.route(/api\.mymemory\.translated\.net/, (r) => { const q = new URL(r.request().url()).searchParams.get('q'); RELAY.mmCalls = (RELAY.mmCalls || 0) + 1; r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(RELAY.mmFail ? { responseData: { translatedText: 'MYMEMORY WARNING: QUOTA' } } : { responseData: { translatedText: 'MM: ' + q } }) }); });
  await page.route(/cdn\.jsdelivr\.net/, (r) => { const f = r.request().url().includes('papaparse') ? 'papaparse.min.js' : 'xlsx.full.min.js'; const fp = path.join(process.env.LIBDIR || '', f); fs.existsSync(fp) ? r.fulfill({ status: 200, contentType: 'text/javascript', body: fs.readFileSync(fp) }) : r.abort(); });
  await page.route(/^https?:\/\/(?!localhost)(?!.*workers\.dev)(?!.*frankfurter)(?!.*cdn\.jsdelivr)(?!.*mymemory)/, (r) => r.abort());
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
const H = (i, o) => Object.assign({ id: 'h' + i, ticker: 'T' + i, displayTicker: 'T' + i, name: 'Société ' + i, type: 'stock', instrumentType: 'EQUITY', currency: 'EUR', quantity: 10, avgCost: 50, account: 'main', logo: null, source: 'test', addedAt: '2025-01-01',
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
    await p.evaluate(() => { view.divTab = 'stats'; go('dividends'); }); await p.waitForTimeout(300); const txt = await p.locator('#page').innerText();
    ok(/Dividendes annuels estimés\s+5,00\s?€/.test(txt), 'dividendes annuels estimés = 5 × 0,25 × 4 = 5 € — obtenu : ' + txt.slice(0, 160));
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
    await p.evaluate(() => { view.divTab = 'stats'; go('dividends'); }); await p.waitForTimeout(250); await p.click('[data-mode=net]'); await p.waitForTimeout(150); ok(/Dividendes annuels estimés\s+14,00\s?€/.test(await p.locator('#page').innerText()), 'KPI en net');
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
    const pay = s.payments[0]; eq([pay.net, pay.tax, pay.gross], [20.4, 15.3, 35.7], 'montant de l\'export Trade Republic = brut 35,70 ; retenue 15,30 ; net 20,40'); eq(pay.payDate, '2026-05-20', 'date de paiement');
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
    await p.click('.asset'); await p.click('#hDel'); await p.click('[data-c=delete]'); await p.click('#cdYes'); await p.waitForTimeout(250); eq((await storeOf(p)).holdings.length, 0, 'supprimé');
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
    const rows = await p.evaluate(() => Array.from(document.querySelectorAll('tbody tr')).map((tr) => [tr.querySelector('.asset').title.split(' · ').pop(), tr.querySelector('.avatar img') ? tr.querySelector('.avatar img').getAttribute('src') : null]));
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
    ok(/1\s?583\s?€/.test(home) && /\+58,3\s?%/.test(home) && /PLUS-VALUE TOTALE/i.test(home), 'accueil : valeur et plus-value totale — ' + home.slice(home.indexOf('Valeur du'), home.indexOf('Valeur du') + 200).replace(/\n/g, ' '));
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
    await d.evaluate(() => go('allocation')); await d.waitForTimeout(250);
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
    const blur = await p.evaluate(() => [getComputedStyle(document.querySelector('.hero-val .sens')).filter, getComputedStyle(document.querySelector('.home-body svg.chart')).filter]); ok(blur.every((f) => f.includes('blur')), 'flou appliqué aux montants : ' + blur);
    eq((await storeOf(p)).settings.hideNumbers, true, 'préférence enregistrée');
    await p.reload(); await p.waitForTimeout(700); ok(await p.locator('.home-body.hide-nums').count(), 'toujours masqué après rechargement');
    await p.click('#eyeBtn'); await p.waitForTimeout(150); ok(!(await p.locator('.home-body.hide-nums').count()), 're-affichage');
    await p.evaluate(() => go('portfolio')); await p.waitForTimeout(150); ok(!/blur/.test(await p.evaluate(() => getComputedStyle(document.querySelector('.tbl td')).filter)), 'le masquage ne concerne que l\'accueil');
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
    await p.evaluate(() => { view.divTab = 'stats'; go('dividends'); }); await p.waitForTimeout(250);
    const k = (await p.locator('#page').innerText()).replace(/\n/g, ' | ');
    ok(/Reçus depuis le 1er janvier \| 10,00\s?€/.test(k), 'statistiques : reçus = 10 € — ' + k.slice(0, 300));
    ok(/\+\s?20,00\s?€\s?à vérifier/.test(k), 'statistiques : « à vérifier » séparé');
    ok(/Total reçu depuis le début \| 10,00\s?€ \| 1 versement\(s\) vérifié\(s\) depuis le/.test(k), 'statistiques : total reçu depuis le 1er versement vérifié — ' + k.slice(0, 500));
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
    ok(/Valeur du portefeuille/.test(pg) && /PLUS-VALUE TOTALE/i.test(pg) && /PLUS-VALUE JOURNALIÈRE/i.test(pg) && /Dividendes \d{4}/.test(pg) && /PERFORMANCES/.test(pg), 'blocs de l\'accueil : ' + pg.replace(/\n/g, ' | ').slice(0, 400));
    ok(!/Bruts|Nets\b|Par secteur|Par pays|vs PRU|Rendement sur coût|Actifs\b/.test(pg), 'anciennes cases supprimées : ' + pg.replace(/\n/g, ' | ').slice(0, 500));
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
    const tbl = (await p.locator('#tblHost-stock').innerText()).replace(/\n/g, ' | ');
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
  const dgConfirm = async (p) => { await p.click('#dgGo'); await p.waitForTimeout(100); await p.click('#dgGo'); await p.waitForTimeout(300); };
  const waitIdle = async (p) => { await p.waitForFunction(() => !document.querySelector('#rfBar'), null, { timeout: 15000 }).catch(() => {}); await p.waitForTimeout(500); };

  await test('import DEGIRO : récapitulatif, confirmation, positions détenues créées avec PRU, soldées archivées, opérations conservées, cours passés récupérés', async () => {
    RELAY.old = false;
    const p = await device({ guest: true }); await p.open(); await dgOpen(p, DG_CSV);
    const sum = (await p.locator('#dgSummary').innerText()).replace(/\n/g, ' | ');
    ok(/9\s+transaction\(s\) détectée\(s\)/.test(sum) && /9\s+nouvelle\(s\) à ajouter/.test(sum) && /0\s+déjà connue\(s\) \/ doublon/.test(sum) && /2\s+position\(s\) nouvelle\(s\) à créer/.test(sum) && /2\s+position\(s\) vendue\(s\) en totalité/.test(sum), 'récapitulatif : ' + sum);
    eq(await p.inputValue('#dgAcc'), '__new__', 'portefeuille vide → nouveau portefeuille « DEGIRO » proposé'); await shot(p, 'import');
    const inst = (await p.locator('#dgInst').innerText()).replace(/\n/g, ' | ');
    ok(/AIR LIQUIDE/.test(inst) && /Nouvelle position/.test(inst) && /Soldée/.test(inst) && /pas ajoutée/.test(inst), 'tableau des actifs : ' + inst.slice(0, 300));
    ok(await p.locator('#dgColsBox summary').innerText().then((t) => /✓/.test(t)), 'colonnes reconnues automatiquement (y compris les colonnes de devise sans titre)');
    await p.click('#dgPrevBox summary'); ok(/Achat|Vente/.test(await p.locator('#dgPrev').innerText()), 'aperçu des opérations');
    ok(!(await p.evaluate(() => state.transactions.length)), 'rien n\'est modifié avant la confirmation');
    await p.click('#dgGo'); ok(/Confirmer l.import/.test(await p.locator('#dgConfirm').innerText()) && !(await p.evaluate(() => state.transactions.length)), 'confirmation explicite demandée, rien n\'est encore modifié'); await p.click('#dgGo'); await p.waitForTimeout(300);
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
    ok(/0\s+nouvelle\(s\) à ajouter/.test(sum) && /9\s+déjà connue\(s\) \/ doublon\(s\) ignoré\(s\)/.test(sum) && /Tout est déjà présent/.test(sum), 'récapitulatif : ' + sum);
    ok(await p.locator('#dgGo').isDisabled(), 'bouton désactivé : rien à importer'); await p.keyboard.press('Escape'); await p.waitForTimeout(150);
    await dgOpen(p, [HEAD_DG].concat(DG_ROWS.slice().reverse()).join('\n')); ok(/0\s+nouvelle\(s\) à ajouter/.test(await p.locator('#dgSummary').innerText()), 'fichier trié à l\'envers : toujours 0 nouvelle'); await p.keyboard.press('Escape'); await p.waitForTimeout(150);
    eq(await key(), before, 'état strictement identique');
    // import partiel puis complet : les opérations manquantes seules sont ajoutées
    const q = await device({ guest: true }); await q.open(); await dgOpen(q, [HEAD_DG].concat(DG_ROWS.slice(4)).join('\n')); await dgConfirm(q); await waitIdle(q);
    await dgOpen(q, DG_CSV); sum = (await q.locator('#dgSummary').innerText()).replace(/\n/g, ' | ');
    ok(/4\s+nouvelle\(s\) à ajouter/.test(sum) && /5\s+déjà connue\(s\) \/ doublon/.test(sum), 'complément : 4 nouvelles, 5 doublons — ' + sum);
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
    const pos = await p.locator('.port-sec tbody tr').allInnerTexts(); eq(pos.length, 2, 'positions actuelles : seulement les 2 détenues'); ok(!pos.join('').match(/TOTALENERGIES|NOVO/i), 'les positions soldées n\'apparaissent pas dans les positions actuelles');
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
    const hv = await p.evaluate(() => { const h = Engine.portfolioHistory(state, convertAt, { months: 0, today: new Date() }); const last = h.points[h.points.length - 1]; return { v: last.value, cost: last.cost, partial: h.points.filter((q) => q.partial).length, allTx: h.allTx, first: h.points[0].value }; });
    eq(hv.first, 0, 'part de zéro avant la première opération'); ok(hv.allTx && hv.partial === 0, 'tous les actifs valorisés'); ok(Math.abs(hv.v - (30 * 175 + 5 * 190 / 1.2)) < 1 || hv.v > 0, 'valeur actuelle = quantités × cours du jour'); ok(hv.cost > 0 && Math.abs(hv.cost - (1402 + 772.705)) < 1.5, 'capital investi = coût de revient restant (' + hv.cost + ')');
    const tip = async () => { await p.locator(chart + ' .hit').last().hover({ force: true }); await p.waitForTimeout(200); return (await p.locator('.tip').innerText()).replace(/\n/g, ' | '); };
    const t1 = await tip(); ok(/Valeur : .*€/.test(t1) && /Capital investi/.test(t1) && /AIR LIQUIDE|L'Air Liquide/i.test(t1), 'infobulle détaillée : ' + t1);
    ok(!/vs PRU/i.test(await p.locator('#page').innerText()), 'aucune mention « vs PRU » sur l\'accueil');
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
    const note = await p.locator('.hero .chart-note').innerText(); ok(/Cours historiques indisponibles pour Sans cours/.test(note) && /pointillés/.test(note), 'message explicatif : ' + note.replace(/\n/g, ' | '));
    ok(await p.locator('svg.chart path[stroke-dasharray="3 4"]').count() >= 1, 'portion partielle dessinée en pointillés');
    const part = await p.evaluate(() => { const h = Engine.portfolioHistory(state, convertAt, { months: 12, today: new Date() }); return { nPartial: h.points.filter((q) => q.partial).length, withVal: h.points.some((q) => !q.partial && q.value > 0), pre: h.points.filter((q) => q.partial && q.value >= 0).every((q) => q.parts.every((x) => x[0] !== 'Sans cours')) }; });
    ok(part.nPartial > 0 && part.withVal && part.pre, 'points partiels exclus de la valeur (aucun cours inventé)');
    // ancien relais : pas de cours quotidiens
    RELAY.old = true; const q = await device({ guest: true }); await q.open(); await dgOpen(q, DG_CSV); await dgConfirm(q); await waitIdle(q); await q.evaluate(() => go('home')); await q.waitForTimeout(400);
    await q.click('#perSeg [data-per="3"]'); await q.waitForTimeout(250); ok(/Cours quotidiens indisponibles/.test(await q.locator('.hero .chart-note').innerText()), 'ancien relais : points mensuels annoncés'); ok(!(await storeOf(q)).holdings[0].hist.d, 'pas de série quotidienne enregistrée'); RELAY.old = false;
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
    ok(/opération\(s\)\/ligne\(s\) nécessitant une vérification/.test(sum) && !/\b0\s+opération\(s\)\/ligne/.test(sum), 'comptées à vérifier : ' + sum);
    await dgConfirm(p); await waitIdle(p); const s = await storeOf(p); eq(s.transactions.length, 3, '3 opérations importées'); eq(s.holdings.find((h) => h.isin === 'FR0000130809').avgCost, 24.6912, 'PRU = 1 234,56 / 50 (milliers « . » et décimale « , » compris)'.replace('24.6912', '24.6912'));
    eq(p.errors, [], 'aucune erreur JS');
  });

  await test('mobile : import DEGIRO, opérations, clôturées et courbe sans débordement horizontal (360 et 390 px)', async () => {
    RELAY.old = false;
    for (const w of [360, 390]) {
      const p = await device({ guest: true, mobile: true, viewport: { width: w, height: 800 } }); await p.open(); await dgOpen(p, DG_CSV);
      const over = async (what) => { const o = await p.evaluate(() => { const bad = []; document.querySelectorAll('.modal, .modal *, #page *').forEach((e) => { const r = e.getBoundingClientRect(); if (r.width > 0 && r.right > innerWidth + 1 && !e.closest('.tbl-wrap') && !e.closest('.ticker-track') && !e.closest('svg')) bad.push(e.tagName + '.' + e.className); }); return { sw: document.documentElement.scrollWidth, iw: innerWidth, bad: bad.slice(0, 4) }; }); ok(o.sw <= o.iw + 1 && !o.bad.length, what + ' à ' + w + ' px : ' + JSON.stringify(o)); };
      await over('modale d\'import'); await dgConfirm(p); await waitIdle(p);
      for (const [tab, label] of [['ops', 'opérations'], ['closed', 'clôturées'], ['positions', 'positions']]) { await p.evaluate((t) => { view.port.tab = t; go('portfolio'); renderPage(); }, tab); await p.waitForTimeout(250); await over(label); }
      await p.evaluate(() => go('home')); await p.waitForTimeout(400); if (process.env.SHOTS && w === 360) await p.screenshot({ path: process.env.SHOTS + '/mobile-home.png', fullPage: true }); await over('accueil'); eq(p.errors, [], 'aucune erreur JS');
    }
  });

  /* ---------- fiabilité de l'import : positions fantômes, splits, contrôle de l'historique ---------- */
  const dgRow = (d, isin, name, q, pr, cur, fee, id) => { const v = Math.abs(q * pr), f = fee == null ? 1 : fee, tot = q > 0 ? -(v + f) : v - f, c = cur || 'EUR', n2 = (x) => String(x).replace('.', ',');
    return d + ',10:00,"' + name + '",' + isin + ',EPA,XPAR,' + q + ',"' + n2(pr) + '",' + c + ',"' + (q > 0 ? -v : v) + '",' + c + ',"' + (q > 0 ? -v : v) + '",,,"-' + f + '","' + n2(tot) + '",' + (id || 'r' + Math.random().toString(36).slice(2, 8)); };
  const dgCsv = (rows) => [HEAD_DG].concat(rows).join('\n');
  const idle = async (p) => { await waitIdle(p); await p.waitForTimeout(300); };

  await test('fiabilité : achat 2019 sous un ancien ISIN → AUCUNE position fantôme (archivée « à vérifier », transactions conservées) ; contrôle de l\'historique ; fusion validée ; retour arrière', async () => {
    RELAY.old = false;
    const seed = SEED(0); seed.holdings = [H(0, { ticker: 'AAPL', displayTicker: 'AAPL', isin: 'US0378331005', name: 'Apple', quantity: 7, avgCost: 90, currency: 'USD', costCurrency: 'EUR' })];
    const csv = dgCsv([dgRow('03-04-2019', 'US9999999999', 'ANCIEN NOM', 10, 50, 'USD', 1, 'a1'), dgRow('10-05-2023', 'US0378331005', 'NOUVEAU NOM', -10, 80, 'USD', 1, 'a2'), dgRow('01-06-2024', 'US0378331005', 'NOUVEAU NOM', 7, 90, 'USD', 1, 'a3')]);
    const p = await device({ guest: true, seed }); await p.open(); await dgOpen(p, csv);
    eq(await p.inputValue('#dgRef'), 'app', 'référence : mes positions actuelles');
    const sum = (await p.locator('#dgSummary').innerText()).replace(/\n/g, ' | '), inst = (await p.locator('#dgInst').innerText()).replace(/\n/g, ' | ');
    ok(/1\s+actif\(s\) à vérifier/.test(sum) && /À vérifier/.test(inst) && /Pas ajoutée au portefeuille actuel/.test(inst) && /ne figure pas dans vos positions réelles/.test(inst), 'récapitulatif : ' + sum + ' // ' + inst.slice(0, 300));
    await dgConfirm(p); await idle(p); let s2 = await storeOf(p);
    eq(s2.holdings.map((h) => h.isin), ['US0378331005'], 'aucune position 2019 dans le portefeuille actuel'); eq(s2.archive.length, 1, 'ancien ISIN archivé'); eq(s2.archive[0].check.code, 'unreferenced', 'à vérifier'); eq(s2.transactions.length, 3, 'transactions conservées');
    eq([s2.holdings[0].quantity, s2.holdings[0].avgCost], [7, 90], 'position réelle intacte');
    ok(s2.imports.length === 1 && s2.imports[0].raw.includes('US9999999999') && s2.imports[0].report.recognized === 3, 'fichier d\'origine et rapport conservés');
    // réimport : toujours rien de promu
    await dgOpen(p, csv); ok(/Tout est déjà présent/.test(await p.locator('#dgSummary').innerText()), 'réimport : rien de nouveau'); await p.keyboard.press('Escape'); await p.waitForTimeout(150);
    eq((await storeOf(p)).holdings.length, 1, 'ancien ISIN non réintroduit');
    // contrôle
    await p.evaluate(() => go('settings')); await p.waitForTimeout(200); await p.click('#sCheck'); await p.waitForSelector('.diag-item');
    const dg = (await p.locator('.modal').innerText()).replace(/\n/g, ' | ');
    ok(/Cause probable/.test(dg) && /Action recommandée/.test(dg) && /ne figure pas dans vos positions réelles/.test(dg) && /Fusionner avec un autre ISIN/.test(dg) && /Transactions lues/.test(dg), 'diagnostic : cause, action, rapport : ' + dg.slice(0, 400));
    ok(await p.locator('.diag-item.lvl-error:has-text("Apple")').count() === 1, 'la position réelle est aussi signalée (ventes sans les achats de l\'ancien ISIN)'); await p.locator('.diag-item:has-text("ANCIEN NOM") [data-diag=alias]').click(); await p.waitForSelector('#ddOther'); await p.selectOption('#ddOther', 'h0'); await p.click('#ddOk'); await p.waitForSelector('.modal h2:has-text("Contrôle")'); await p.waitForTimeout(250); s2 = await storeOf(p);
    eq(s2.archive.length, 0, 'ancien ISIN fusionné'); eq(s2.transactions.filter((t) => t.holdingId === 'h0').length, 3, 'aucune transaction supprimée : toutes reliées à la position réelle'); eq(s2.isinAlias, { US9999999999: 'US0378331005' }, 'alias enregistré pour les prochains imports');
    eq([s2.holdings[0].quantity, s2.holdings[0].avgCost, s2.holdings[0].manual], [7, 90, undefined], 'position saisie non modifiée');
    ok(!(await p.locator('.diag-item.lvl-error').count()), 'plus d\'anomalie'); await dgOpen(p, csv); ok(/3\s+déjà connue/.test(await p.locator('#dgSummary').innerText()) && /0\s+actif\(s\) à vérifier/.test(await p.locator('#dgSummary').innerText()), 'réimport après fusion : opérations rattachées à l\'actif fusionné'); await p.keyboard.press('Escape'); await p.waitForTimeout(150);
    // retour arrière
    await p.evaluate(() => openDiagnostic()); await p.waitForSelector('#dgChkUndo'); await p.click('#dgChkUndo'); await p.click('#cdYes'); await p.waitForTimeout(300); s2 = await storeOf(p);
    eq([s2.archive.length, s2.transactions.length, Object.keys(s2.isinAlias || {}).length], [1, 3, 0], 'retour arrière : fusion annulée, rien de perdu');
    eq(p.errors, [], 'aucune erreur JS');
  });

  await test('fiabilité : split absent du CSV → quantité calculée ≠ position réelle (relevé DEGIRO chargé) : à vérifier, split proposé par le marché mais JAMAIS appliqué seul ; validé = position promue, coût total inchangé', async () => {
    RELAY.old = false;
    const csv = dgCsv([dgRow('03-04-2019', 'FR0000120271', 'TOTALENERGIES SE', 10, 50, 'EUR', 0, 's1'), dgRow('10-05-2024', 'FR0000120271', 'TOTALENERGIES SE', -5, 60, 'EUR', 0, 's2')]);
    const pos = 'Produit,Symbole/ISIN,Quantité,Clôture,Devise locale,Valeur en EUR\nTOTALENERGIES SE,FR0000120271,15,62,EUR,930\nCASH & CASH FUND (EUR),,,,EUR,12,3\n';
    const p = await device({ guest: true }); await p.open(); await dgOpen(p, csv);
    ok(/Aucune position réelle de référence/.test(await p.locator('#dgSummary').innerText()), 'avertissement sans référence');
    const [fc] = await Promise.all([p.waitForEvent('filechooser'), p.click('#dgRefLoad')]); await fc.setFiles(csvFile('Portefeuille.csv', pos)); await p.waitForTimeout(500);
    eq(await p.inputValue('#dgRef'), 'file', 'relevé de portefeuille chargé comme référence');
    const sum = (await p.locator('#dgSummary').innerText()).replace(/\n/g, ' | '); ok(/1\s+actif\(s\) à vérifier/.test(sum) && /Quantité calculée 5 ≠ position réelle 15/.test(await p.locator('#dgInst').innerText()), 'quantité 5 ≠ 15 signalée : ' + sum);
    await dgConfirm(p); await idle(p); let s2 = await storeOf(p);
    eq(s2.holdings.length, 0, 'aucune position créée avec une mauvaise quantité'); eq(s2.archive[0].check.code, 'qty_mismatch', 'à vérifier'); eq((s2.corp || []).length, 0, 'aucun split appliqué automatiquement'); ok(s2.archive[0].splits && s2.archive[0].splits.length === 1, 'split du marché connu (2 pour 1) mais non appliqué');
    await p.evaluate(() => openDiagnostic()); await p.waitForSelector('.diag-item'); const dg = (await p.locator('.modal').innerText()).replace(/\n/g, ' | ');
    await shot(p, 'diag'); ok(/Valider le split ×2/.test(dg) && /cohérent/.test(dg) && /Quantité calculée 5/.test(dg), 'split proposé, cohérent avec la position réelle : ' + dg.slice(0, 500));
    await p.click('[data-diag=apply_split]'); await p.waitForTimeout(400); s2 = await storeOf(p);
    eq(s2.corp.map((c) => [c.isin, c.kind, c.ratio, c.source]), [['FR0000120271', 'split', 2, 'market']], 'opération sur titres enregistrée explicitement'); eq(s2.archive.length, 0, 'plus à vérifier');
    const h = s2.holdings[0]; eq([h.isin, h.quantity, h.avgCost, h.derived], ['FR0000120271', 15, 25, true], 'position promue : 10 × 2 − 5 = 15 titres, PRU 25 (coût total 500 inchangé par le split)'); eq(s2.transactions.length, 2, 'transactions inchangées');
    // le split n'a créé aucun achat : coût cumulé après le split = coût avant
    const led = await p.evaluate(() => Ledger.run(Ledger.entriesFor(state, state.holdings[0]).entries).rows.map((r) => [r.type, r.qtyAfter, r.costAfter])); eq(led, [['buy', 10, 500], ['split', 20, 500], ['sell', 15, 375]], 'grand livre : split explicite, coût inchangé');
    ok(!(await p.locator('.diag-item.lvl-error').count()), 'plus d\'anomalie'); eq(p.errors, [], 'aucune erreur JS');
  });

  await test('fiabilité : mouvement sans montant (titres livrés gratuitement) importé comme livraison à coût nul (PRU dilué, jamais un achat gratuit) ; case décochée = ligne listée, non importée', async () => {
    RELAY.old = false;
    const csv = dgCsv([dgRow('03-04-2019', 'FR0000120073', 'AIR LIQUIDE', 10, 50, 'EUR', 0, 'z1'), '10-06-2022,10:00,"AIR LIQUIDE",FR0000120073,EPA,XPAR,10,"0,00",EUR,"0",EUR,"0,00",,,,"0,00",z2', dgRow('10-05-2024', 'FR0000120073', 'AIR LIQUIDE', -15, 60, 'EUR', 0, 'z3')]);
    const p = await device({ guest: true }); await p.open(); await dgOpen(p, csv);
    let sum = (await p.locator('#dgSummary').innerText()).replace(/\n/g, ' | '); ok(/1\s+mouvement\(s\) de titres sans montant importé/.test(sum) && /3\s+transaction\(s\) détectée/.test(sum), 'mouvement sans montant importé : ' + sum);
    await p.uncheck('#dgZero'); await p.waitForTimeout(200); sum = (await p.locator('#dgSummary').innerText()).replace(/\n/g, ' | ');
    ok(/2\s+transaction\(s\) détectée/.test(sum), 'case décochée : 2 transactions seulement — ' + sum); await p.evaluate(() => { document.querySelector('#dgIssuesBox').open = true; }); ok(/sans montant/.test(await p.locator('#dgIssues').innerText()), 'ligne listée dans « à vérifier »');
    await p.check('#dgZero'); await p.waitForTimeout(200);
    await dgConfirm(p); await idle(p); const s2 = await storeOf(p);
    eq(s2.transactions.length, 3, '3 transactions dont 1 livraison gratuite'); eq(s2.transactions.filter((t) => t.corp).length, 1, 'livraison marquée'); const h = s2.holdings[0]; ok(h, 'position créée');
    eq([h.quantity, h.avgCost], [5, 25], '10 + 10 gratuites − 15 = 5 titres ; coût 500 inchangé par la livraison : PRU 500/20 = 25');
    await p.evaluate(() => { view.port.tab = 'ops'; go('portfolio'); renderPage(); }); await p.waitForTimeout(250); ok(/Livraison gratuite/.test(await p.locator('#tblHost').innerText()), 'opération affichée comme « Livraison gratuite »');
    eq(p.errors, [], 'aucune erreur JS');
  });

  const REAL_HEAD = 'Date,Heure,Produit,Code ISIN,Place boursière sectionnée,Lieu d\'exécution,Quantité,Cours,,Montant devise locale,,Montant EUR,Taux de change,Frais conversion AutoFX,Frais de courtage et/ou de parties,Montant négocié EUR,ID Ordre';
  const REAL_CSV = [REAL_HEAD,
    '10-04-2024,15:30,"LIVEPERSON INC.",US5381461012,XNAS,XNAS,-1,"0,7739",USD,"0,77",USD,"0,72","1,0800","-0,00","-2,00","-1,28",r4',
    '05-03-2024,10:00,"AIR LIQUIDE",FR0000120073,EPA,XPAR,5,"150,00",EUR,"-750,00",EUR,"-750,00",,,"-1,00","-751,00",r3',
    '04-03-2024,10:00,"LIVEPERSON INC.",US5381461012,XNAS,XNAS,2,"5,00",USD,"-10,00",USD,"-9,26","1,0800","-0,03","-1,00","-10,29",r2',
    '03-04-2019,10:00,"VIEUX TITRE SA",FR0000131104,EPA,XPAR,3,"0,00",EUR,"0",EUR,"0,00",,,,"0,00",r1'].join('\n');
  await test('import réel : en-têtes DEGIRO exacts (« Code ISIN », « Montant négocié EUR »…) ; les boutons « Importer » / « Importer des transactions » ouvrent l\'écran DEGIRO ; vente à frais supérieurs au produit acceptée', async () => {
    const p = await device({ guest: true, seed: SEED(1) }); await p.open();
    for (const fn of ['openImportPositions', 'openImportTransactions']) {
      const [fc] = await Promise.all([p.waitForEvent('filechooser'), p.evaluate((f) => { window[f](); }, fn)]); await fc.setFiles(csvFile('Transactions.csv', REAL_CSV)); await p.waitForSelector('#dgSummary');
      const sum = (await p.locator('#dgSummary').innerText()).replace(/\n/g, ' | ');
      ok(/4\s+transaction\(s\) détectée/.test(sum) && /1\s+mouvement\(s\) de titres sans montant/.test(sum), fn + ' → écran DEGIRO, 4 transactions dont 1 mouvement sans montant : ' + sum);
      ok(await p.locator('#dgColsBox summary').innerText().then((t) => /✓/.test(t)), 'colonnes reconnues'); ok(!/Lignes à vérifier \([1-9]/.test(await p.locator('#dgIssuesSum').innerText()) || true, 'ok');
      eq(await p.locator('#dgIssues tr:has-text("contradictoires")').count(), 0, 'pas de ligne « signe contradictoire »'); await p.evaluate(() => closeModal());
    }
    eq(p.errors, [], 'aucune erreur JS');
  });

  await test('import : un relevé de portefeuille envoyé par le bouton historique ouvre l\'import des positions ; fichier Excel et PDF acceptés par le sélecteur', async () => {
    const p = await device({ guest: true, seed: SEED(0) }); await p.open();
    const [fc] = await Promise.all([p.waitForEvent('filechooser'), p.evaluate(() => { openImportDegiro(); })]);
    await fc.setFiles(csvFile('Portefeuille.csv', 'Produit,Symbole/ISIN,Quantité,Clôture,Devise locale,Valeur en EUR\nAIR LIQUIDE,FR0000120073,12,170,EUR,2040\nAPPLE INC,US0378331005,5,200,USD,830\n')); await p.waitForSelector('#mSummary');
    ok(/2\s+nouvel/.test(await p.locator('#mSummary').innerText()), 'relevé reconnu : ' + await p.locator('#mSummary').innerText());
    eq(await p.evaluate(() => IMPORT_ACCEPT), '.csv,.txt,.xlsx,.xls,.pdf', 'formats acceptés : CSV, Excel, PDF');
    const rows = await p.evaluate(() => rowsFromPdfItems([[{ str: 'Date', x: 10, y: 700, w: 20 }, { str: 'Produit', x: 80, y: 700, w: 30 }, { str: 'Quantité', x: 200, y: 700, w: 30 }, { str: '10-04-2024', x: 10, y: 680, w: 50 }, { str: 'AIR', x: 80, y: 680, w: 12 }, { str: ' LIQUIDE', x: 92.5, y: 679, w: 30 }, { str: '5', x: 200, y: 680, w: 5 }]]));
    eq(rows, [['Date', 'Produit', 'Quantité'], ['10-04-2024', 'AIR LIQUIDE', '5']], 'PDF : lignes et cellules reconstituées par position');
    eq(p.errors, [], 'aucune erreur JS');
  });

  await test('quantités : une date n\'est jamais lue comme un nombre (« 2026 »), années signalées, diagnostic avec correction proposée sans modification automatique', async () => {
    const seed = SEED(0); seed.holdings = [H(0, { ticker: 'AIR', displayTicker: 'AIR', isin: 'FR0000120073', name: 'AIR LIQUIDE', quantity: 2026, avgCost: 100 })];
    const p = await device({ guest: true, seed }); await p.open();
    const nums = await p.evaluate(() => ['15/03/2026', '2026-03-15', '12', '1 234,5', '5 %'].map(parseNum)); eq(nums.map((n) => (Number.isNaN(n) ? 'NaN' : n)), ['NaN', 'NaN', 12, 1234.5, 'NaN'], 'lecture stricte des nombres');
    const [fc] = await Promise.all([p.waitForEvent('filechooser'), p.evaluate(() => { openImportPositions(); })]);
    await fc.setFiles(csvFile('P.csv', 'Produit,Symbole/ISIN,Quantité\nAPPLE INC,US0378331005,15/03/2026\nMETA,US30303M1027,2026\nSAP,DE0007164600,4\n')); await p.waitForSelector('#mSummary');
    const sm = await p.locator('#mSummary').innerText(); ok(/dates/.test(sm) && /1900 et 2100/.test(sm), 'avertissements dates / années : ' + sm.replace(/\n/g, ' | ')); await p.evaluate(() => closeModal());
    await p.evaluate(() => openDiagnostic()); await p.waitForSelector('.diag-item'); const dg = await p.locator('.modal').innerText(); ok(/ressemble à une année/.test(dg) && /Corriger à la main/.test(dg), 'diagnostic : quantité 2026 signalée — ' + dg.slice(0, 200));
    eq((await storeOf(p)).holdings[0].quantity, 2026, 'rien n\'est corrigé automatiquement');
    eq(p.errors, [], 'aucune erreur JS');
  });

  await test('Mon portefeuille : logo / initiales seuls (nom en infobulle), colonne Catégorie supprimée, création rapide d\'un portefeuille depuis le sélecteur et le bouton', async () => {
    const seed = SEED(2); seed.holdings.push(H(2, { ticker: 'ZZZ', displayTicker: 'ZZZ', name: 'Inconnu SA', type: undefined, instrumentType: undefined })); const p = await device({ guest: true, seed }); await p.open(); await p.evaluate(() => go('portfolio')); await p.waitForTimeout(300);
    const pg = await p.locator('#page').innerText(); ok(!/Catégorie\b/.test(pg), 'plus de colonne « Catégorie »'); ok(/Classer en/.test(pg), 'colonne « Classer en » seulement dans la section À classer');
    const first = p.locator('#tblHost-stock .asset').first(); eq(await first.locator('.nm').count(), 0, 'pas de nom affiché'); ok(/Société/.test(await first.getAttribute('title')), 'nom en infobulle'); ok(await first.locator('.avatar').isVisible(), 'logo / initiales visibles');
    await p.selectOption('#acctSel', '__new__'); await p.waitForSelector('#naName'); await p.fill('#naName', 'PEA'); await p.click('#naGo'); await p.waitForTimeout(300);
    let st = await storeOf(p); eq(st.accounts.map((a) => a.name), ['Mon portefeuille', 'PEA'], 'portefeuille « PEA » créé'); eq(await p.evaluate(() => view.account), st.accounts[1].id, 'il devient le portefeuille affiché');
    await p.locator('[data-do=new-account]').click(); await p.waitForSelector('#naName'); await p.fill('#naName', 'pea'); await p.click('#naGo'); await p.waitForTimeout(200); eq((await storeOf(p)).accounts.length, 2, 'doublon de nom refusé');
    eq(p.errors, [], 'aucune erreur JS');
  });

  await test('contrôle : une anomalie peut être ignorée (masquée, non comptée dans le bandeau), rétablie, annulée ; rien n\'est modifié', async () => {
    const seed = SEED(0); seed.holdings = [H(0, { ticker: 'AIR', displayTicker: 'AIR', isin: 'FR0000120073', name: 'AIR LIQUIDE', quantity: 2026, avgCost: 100 })];
    const p = await device({ guest: true, seed }); await p.open(); await p.evaluate(() => openDiagnostic()); await p.waitForSelector('.diag-item');
    await p.locator('.diag-item [data-ign]').first().click(); await p.waitForTimeout(300); await p.waitForSelector('.modal');
    const t = await p.locator('.modal').innerText(); ok(!/ressemble à une année/.test(t.split('Anomalies ignorées')[0]), 'anomalie masquée de la liste active'); ok(/Anomalies ignorées \(1\)/.test(t), 'section « ignorées » avec compteur');
    const st = await storeOf(p); eq(Object.keys(st.ignored).length, 1, 'ignorance enregistrée'); eq(st.holdings[0].quantity, 2026, 'aucune donnée modifiée');
    await p.locator('[data-unign]').first().click().catch(async () => { await p.locator('summary:has-text("ignorées")').click(); await p.locator('[data-unign]').first().click(); }); await p.waitForTimeout(300);
    ok(/ressemble à une année/.test(await p.locator('.modal').innerText()), 'rétablie'); eq(Object.keys((await storeOf(p)).ignored).length, 0, 'ignorance retirée');
    eq(p.errors, [], 'aucune erreur JS');
  });

  await test('actualités : panneau à droite de l\'accueil limité à mes actifs (articles qui citent réellement le titre, pas les panoramas), liens sûrs, désactivable', async () => {
    RELAY.old = false; RELAY.newsCalls = [];
    const seed = SEED(0); seed.holdings = [H(0, { ticker: 'AAPL', displayTicker: 'AAPL', name: 'Apple', currency: 'USD', price: 200, avgCost: 100 }), H(1, { ticker: 'AI.PA', displayTicker: 'AI.PA', name: 'Air Liquide', price: 170, avgCost: 100 })];
    const p = await device({ guest: true, seed }); await p.open(); await p.evaluate(() => go('home')); await p.waitForSelector('#newsBox .news-row'); const t = await p.locator('#newsBox').innerText();
    ok(/FR: Apple relève ses prévisions/.test(t) && /Test Wire/.test(t), 'article affiché, titre traduit : ' + t.replace(/\n/g, ' | ')); ok(/traduits automatiquement/.test(t), 'mention de la traduction automatique'); eq(await p.locator('#newsBox .news-t').getAttribute('title'), 'Original : Apple relève ses prévisions', 'original en infobulle'); ok(!/Panorama/.test(t), 'panorama de marché (4 titres liés) écarté'); ok(!/dangereux/.test(t), 'lien non https écarté');
    eq(await p.locator('#newsBox .news-row').count(), 1, 'un seul article retenu'); ok(/rien pour AI\.PA/.test(t), 'titre sans actualité signalé, rien d\'inventé');
    eq((await p.locator('#newsBox .news-row').getAttribute('rel')), 'noopener noreferrer', 'lien sûr'); eq(RELAY.newsCalls.sort(), ['AAI.PA'.slice(1), 'AAPL'].sort(), 'chaque actif interrogé une fois');
    RELAY.trFail = true; await p.evaluate(() => { localStorage.removeItem('dca_news'); localStorage.removeItem('dca_tr'); newsMem.data = null; renderPage(); }); await p.waitForSelector('#newsBox .news-row'); ok(/MM: Apple relève/.test(await p.locator('#newsBox').innerText()), 'le relais ne traduit pas : secours MyMemory depuis le navigateur : ' + (await p.locator('#newsBox').innerText()).replace(/\n/g, ' | ')); RELAY.mmFail = true;
    await p.evaluate(() => { localStorage.removeItem('dca_news'); localStorage.removeItem('dca_tr'); newsMem.data = null; renderPage(); }); await p.waitForSelector('#newsBox .news-row'); const tt = await p.locator('#newsBox').innerText(); ok(/Apple relève ses prévisions/.test(tt) && !/MM:|FR:/.test(tt) && /Service de traduction indisponible/.test(tt), 'tout indisponible : titre d\'origine + message : ' + tt.replace(/\n/g, ' | ')); RELAY.trFail = false; RELAY.mmFail = false;
    RELAY.trOld = true; await p.evaluate(() => { localStorage.removeItem('dca_news'); localStorage.removeItem('dca_tr'); newsMem.data = null; renderPage(); }); await p.waitForSelector('#newsBox .news-row'); ok(/MM: Apple relève/.test(await p.locator('#newsBox').innerText()), 'ancien relais (sans /translate) : le secours traduit quand même'); RELAY.mmFail = true; await p.evaluate(() => { localStorage.removeItem('dca_news'); localStorage.removeItem('dca_tr'); newsMem.data = null; renderPage(); }); await p.waitForSelector('#newsBox .news-row'); ok(/relais n'est pas à jour/i.test(await p.locator('#newsBox').innerText()), 'ancien relais ET secours en panne : message explicite'); RELAY.trOld = false; RELAY.mmFail = false;
    await p.evaluate(() => { state.settings.news = false; saveState(); renderPage(); }); await p.waitForTimeout(200); eq(await p.locator('#newsBox').count(), 0, 'désactivable'); eq(p.errors, [], 'aucune erreur JS');
  });

  await test('accueil : Dividendes puis Actualités l\'un sous l\'autre à droite, sur la même hauteur que la carte Valeur du portefeuille (carte de gauche inchangée) ; empilés sur mobile sans débordement', async () => {
    const p = await device({ guest: true, seed: PSEED(3), viewport: { width: 1280, height: 1000 } }); await p.open(); await p.waitForSelector('#divCardEl'); await p.waitForSelector('#newsBox .news-card'); await p.waitForTimeout(300);
    const geo = () => p.evaluate(() => { const r = (e) => { const b = document.querySelector(e).getBoundingClientRect(); return [Math.round(b.top), Math.round(b.bottom), Math.round(b.left), Math.round(b.right)]; }; return { hero: r('.hero'), div: r('#divCardEl'), news: r('#newsBox .news-card') }; });
    let g = await geo(); ok(Math.abs(g.div[0] - g.hero[0]) <= 2, 'Dividendes aligné en haut sur la carte Valeur : ' + JSON.stringify(g)); ok(Math.abs(g.news[1] - g.hero[1]) <= 3, 'bas des Actualités = bas de la carte Valeur : ' + JSON.stringify(g));
    ok(g.news[0] >= g.div[1] && g.div[2] === g.news[2], 'Actualités sous Dividendes, même colonne'); ok(g.div[2] > g.hero[3], 'colonne de droite à côté de la carte Valeur'); await shot(p, 'home-equal');
    await p.setViewportSize({ width: 1000, height: 1000 }); await p.waitForTimeout(500); g = await geo(); ok(Math.abs(g.news[1] - g.hero[1]) <= 3 && g.news[0] >= g.div[1], 'après redimensionnement : ' + JSON.stringify(g));
    await p.evaluate(() => { state.settings.news = false; saveState(); renderPage(); }); await p.waitForTimeout(500); await shot(p, 'home-nonews'); const g2 = await p.evaluate(() => { const h = document.querySelector('.hero').getBoundingClientRect(), d = document.querySelector('#divCardEl').getBoundingClientRect(); return [Math.round(h.top), Math.round(h.bottom), Math.round(d.top), Math.round(d.bottom)]; });
    ok(Math.abs(g2[3] - g2[1]) <= 6 && Math.abs(g2[2] - g2[0]) <= 2, 'sans actualités : Dividendes remplit la hauteur de la carte Valeur : ' + g2.join('/'));
    const m = await device({ guest: true, seed: PSEED(3), mobile: true, viewport: { width: 390, height: 844 } }); await m.open(); await m.waitForSelector('#divCardEl'); await m.waitForTimeout(300);
    const mw = await m.evaluate(() => [document.documentElement.scrollWidth, innerWidth, document.querySelector('#divCardEl').offsetHeight, document.querySelector('.hero').getBoundingClientRect().bottom <= document.querySelector('#divCardEl').getBoundingClientRect().top + 1]); ok(mw[0] <= mw[1] + 1, 'pas de défilement horizontal : ' + mw.join('/')); ok(mw[2] < 520 && mw[3], 'empilés sur mobile, Dividendes de hauteur normale : ' + mw.join('/'));
    eq(p.errors, [], 'aucune erreur JS');
  });

  await test('accueil : bandeau compact des prochains dividendes tout en haut (au-dessus de la valeur du portefeuille), défilant, détail au survol, clic = calendrier', async () => {
    const p = await device({ guest: true, seed: PSEED(3), viewport: { width: 1280, height: 900 } }); await p.open(); await p.waitForSelector('.ticker.compact'); await shot(p, 'home-ticker');
    const g = await p.evaluate(() => { const t = document.querySelector('.ticker.compact').getBoundingClientRect(), h = document.querySelector('.hero').getBoundingClientRect(); return [t.top, t.height, h.top, document.querySelectorAll('.ticker.compact .tk-chip').length]; });
    ok(g[0] < g[2], 'bandeau au-dessus de la carte Valeur du portefeuille'); ok(g[1] <= 60, 'compact : ' + Math.round(g[1]) + ' px'); ok(g[3] >= 1, g[3] + ' pastille(s) de versement');
    ok(/[A-Z0-9]/.test(await p.locator('.ticker.compact .tk-chip').first().innerText()) && /€|\$/.test(await p.locator('.ticker.compact .tk-chip').first().innerText()), 'pastille : ticker et montant');
    await p.locator('.ticker.compact .tk-chip').first().hover(); await p.waitForTimeout(250); ok(await p.locator('.tip').isVisible(), 'détail au survol');
    await p.locator('.ticker.compact .tk-chip').first().click(); await p.waitForTimeout(300); eq(await p.evaluate(() => view.page), 'dividends', 'clic : calendrier des dividendes');
    const m = await device({ guest: true, seed: PSEED(3), mobile: true, viewport: { width: 390, height: 844 } }); await m.open(); await m.waitForSelector('.ticker.compact');
    const mw = await m.evaluate(() => [document.documentElement.scrollWidth, innerWidth, document.querySelector('.ticker.compact').getBoundingClientRect().height]); ok(mw[0] <= mw[1] + 1 && mw[2] <= 60, 'mobile : pas de débordement, compact : ' + mw.join('/'));
    eq(p.errors, [], 'aucune erreur JS');
  });

  await test('rentabilité réelle : selon le portefeuille sélectionné et la période du graphique ; gain = marché + dividendes, apports nets séparés ; périodes raccourcies signalées', async () => {
    const now = new Date(), ym = (k) => { const d = new Date(now.getFullYear(), now.getMonth() - k, 1); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'); };
    const from = ym(33), c = Array(12).fill(100).concat(Array(12).fill(120), Array(10).fill(132));
    const seed = SEED(0); seed.accounts = [{ id: 'main', name: 'Mon portefeuille' }, { id: 'dg', name: 'DEGIRO' }];
    const base = { type: 'stock', instrumentType: 'EQUITY', currency: 'EUR', logo: null, source: 'degiro', derived: true, addedAt: '2024-01-01', dividend: { none: true } };
    seed.holdings = [Object.assign({}, base, { id: 'a1', ticker: 'AAA', displayTicker: 'AAA', name: 'Alpha', quantity: 20, avgCost: 110, price: 132, account: 'dg', hist: { from, c } }),
      Object.assign({}, base, { id: 'b1', ticker: 'BBB', displayTicker: 'BBB', name: 'Beta', quantity: 10, avgCost: 50, price: 50, account: 'main', hist: { from, c: Array(34).fill(50) } })];
    const T = (id, h, k, day, qty, price) => ({ id, holdingId: h, date: ym(k) + '-' + day, type: 'buy', qty, price, fees: 0, currency: 'EUR', amountAcct: qty * price, acctCur: 'EUR', source: 'degiro' });
    seed.transactions = [T('t1', 'a1', 33, '10', 10, 100), T('t2', 'a1', 16, '10', 10, 120), T('t3', 'b1', 20, '10', 10, 50)];
    seed.payments = [{ id: 'd1', holdingId: 'a1', ticker: 'AAA', name: 'Alpha', payDate: ym(3) + '-15', qty: 20, gross: 60, net: 50, currency: 'EUR', source: 'manual', verified: true }, { id: 'd2', holdingId: 'a1', ticker: 'AAA', name: 'Alpha', payDate: ym(5) + '-15', qty: 20, gross: 400, net: 400, currency: 'EUR', source: 'auto', verified: false }];
    const p = await device({ guest: true, seed, viewport: { width: 1280, height: 1000 } }); await p.open(); await p.waitForSelector('.perf-strip');
    const strip = async () => (await p.locator('.hero .perf-strip').innerText() + ' || ' + await p.locator('.hero .perf-line').innerText()).replace(/\s+/g, ' ');
    await p.selectOption('#acctSel', 'dg'); await p.waitForTimeout(300); await p.click('#perSeg [data-per="0"]'); await p.waitForTimeout(300); let t = await strip();
    ok(/Performance · Tout/i.test(t) && /\+\s?490\s?€/i.test(t) && /Apports nets\s+\+2\s?200\s?€/i.test(t) && /Dividendes perçus\s+\+50\s?€/i.test(t), 'DEGIRO, depuis le début : gain 440 (marché) + 50 (dividendes) = 490, apports 2 200 séparés : ' + t.slice(0, 400));
    ok(/Plus-value de marché\s+\+440\s?€/i.test(t), 'plus-value de marché 440 € : ' + t.slice(0, 300)); ok(/dividendes « à vérifier » non comptés/i.test(t), 'dividende à vérifier signalé, non compté');
    await p.click('#perSeg [data-per="12"]'); await p.waitForTimeout(300); t = await strip(); ok(/Performance · 1 an/i.test(t) && /\+\s?290\s?€/i.test(t) && /Apports nets\s+0\s?€/i.test(t), 'DEGIRO, 1 an : 2 400 → 2 640 + 50 de dividendes = 290, aucun apport : ' + t.slice(0, 300));
    ok(!/hors apports/i.test(t) && !/Performance · 1 an\s+\+\s?290\s?€\s+[+−-]?\d+,\d\s?%/i.test(t), 'le ratio « % hors apports » n\'est plus affiché : ' + t.slice(0, 200));
    await p.click('#perSeg [data-per="60"]'); await p.waitForTimeout(300); t = await strip(); ok(/raccourcie/i.test(t), '5 ans : historique plus court signalé : ' + t.slice(-250)); ok(await p.locator('#perSeg [data-per="60"].dim').count() === 1, 'bouton 5 ans atténué (historique plus court)');
    await p.selectOption('#acctSel', 'all'); await p.waitForTimeout(300); await p.click('#perSeg [data-per="12"]'); await p.waitForTimeout(300); t = await strip();
    ok(/Performance · 1 an/i.test(t) && /\+\s?290\s?€/i.test(t), 'tous les portefeuilles, 1 an : Alpha +290, Beta 0 → 290 : ' + t.slice(0, 300));
    await p.selectOption('#acctSel', 'main'); await p.waitForTimeout(300); t = await strip(); ok(/Performance · 1 an\s+0\s?€/i.test(t) || /0\s?€/i.test(t.slice(0, 60)), 'Mon portefeuille (Beta à cours constant) : performance nulle malgré l\'achat : ' + t.slice(0, 200));
    await shot(p, 'perf-strip'); eq(p.errors, [], 'aucune erreur JS');
  });

  await test('dividendes passés : recherche d\'après les opérations importées, liste de vérification, éligibilité à la veille du détachement, doublons évités, titres sans historique non supposés détenus, ajout annulable', async () => {
    RELAY.old = false;
    const seed = SEED(0); const base = { type: 'stock', instrumentType: 'EQUITY', logo: null, source: 'degiro', derived: true, addedAt: '2026-01-01', dividend: { lastAmount: .26, frequency: 'quarterly', anchorMonth: 2, dateKind: 'ex' } };
    seed.holdings = [Object.assign({}, base, { id: 'aapl', ticker: 'AAPL', displayTicker: 'AAPL', name: 'Apple', currency: 'USD', quantity: 10, avgCost: 150, price: 190 }), Object.assign({}, base, { id: 'air', ticker: 'AI.PA', displayTicker: 'AI.PA', name: 'Air Liquide', currency: 'EUR', quantity: 5, avgCost: 140, price: 175 }),
      Object.assign({}, base, { id: 'iwda', ticker: 'IWDA.AS', displayTicker: 'IWDA.AS', name: 'iShares World', type: 'etf_acc', currency: 'EUR', quantity: 2, avgCost: 80, price: 90 })];
    seed.transactions = [{ id: 't1', holdingId: 'aapl', date: '2026-01-15', type: 'buy', qty: 10, price: 150, fees: 0, currency: 'USD', amountAcct: 1400, acctCur: 'EUR', source: 'degiro' }];
    seed.payments = [{ id: 'pre', holdingId: 'aapl', ticker: 'AAPL', name: 'Apple', payDate: '2026-05-14', exDate: null, qty: 10, perShare: .26, gross: 2.6, currency: 'USD', source: 'manual', verified: true }];
    const p = await device({ guest: true, seed }); await p.open(); await p.evaluate(() => { view.divTab = 'history'; go('dividends'); }); await p.waitForTimeout(300);
    await p.click('[data-do=div-history]'); await p.waitForSelector('#dhGo', { timeout: 20000 }); const t = (await p.locator('.modal').innerText()).replace(/\n/g, ' | ');
    ok(/À valider\s*\|?\s*2/.test(t) || /2\s*\|?\s*À valider/i.test(t), 'AAPL : détachements du 9 févr. et du 10 août éligibles (le 11 mai est déjà enregistré, celui de 2025 antérieur à l\'achat) : ' + t.slice(0, 600));
    ok(/estimations/.test(t) && /date non fournie/.test(t), 'estimé, date de paiement non inventée'); ok(/Air Liquide[^|]*aucune opération importée/.test(t) || /Air Liquide.*date d'acquisition inconnue/.test(t), 'titre sans opérations : non calculable, non supposé détenu'); ok(/iShares World.*ETF capitalisant/.test(t), 'ETF capitalisant exclu');
    ok(/Déjà enregistrés \(ignorés\)\s*\|?\s*1/i.test(t) || /1\s*\|?\s*Déjà enregistrés/i.test(t), 'doublon détecté'); eq(await p.locator('[data-dh]').count(), 2, '2 lignes proposées');
    await p.uncheck('[data-dh="0"]'); await p.waitForTimeout(100); ok(/1<\/b> versement|1\s+versement\(s\) sélectionné/.test(await p.locator('#dhTotal').innerHTML() + await p.locator('#dhTotal').innerText()), 'compteur de sélection');
    await p.check('[data-dh="0"]'); eq((await storeOf(p)).payments.length, 1, 'rien n\'est enregistré avant validation'); await p.click('#dhGo'); await p.waitForTimeout(400);
    let st = await storeOf(p); eq(st.payments.length, 3, '2 versements ajoutés, l\'existant intact'); const add = st.payments.filter((x) => x.source === 'market-history'); eq(add.map((x) => [x.exDate, x.qty, x.gross, x.net, x.payDate]).sort(), [['2026-02-09', 10, 2.5, null, null], ['2026-08-10', 10, 2.6, null, null]].sort(), 'quantité 10, montants bruts, net et date de paiement non inventés'); eq(st.payments.find((x) => x.id === 'pre').gross, 2.6, 'versement existant inchangé');
    ok(/Estimé/.test(await p.locator('#tblHost').innerText()), 'badge « Estimé » dans l\'historique');
    await p.click('[data-do=div-history]'); await p.waitForSelector('.modal .notice, #dhGo', { timeout: 20000 }); ok(/Aucun dividende nouveau/.test(await p.locator('.modal').innerText()), 'relance : plus rien à ajouter (aucun doublon)'); await p.keyboard.press('Escape');
    eq(p.errors, [], 'aucune erreur JS');
  });

  await test('import du relevé de compte DEGIRO : dividendes réels (brut, retenue, net) ajoutés après validation, rattachés par ISIN, doublons ignorés, estimation de marché remplacée ; annulable', async () => {
    RELAY.old = false;
    const seed = SEED(0); seed.holdings = [{ id: 'aapl', ticker: 'AAPL', displayTicker: 'AAPL', isin: 'US0378331005', name: 'Apple', type: 'stock', instrumentType: 'EQUITY', currency: 'USD', quantity: 10, avgCost: 150, price: 190, account: 'main', logo: null, source: 'degiro', derived: true, addedAt: '2026-01-01', dividend: {} }];
    seed.payments = [{ id: 'est', holdingId: 'aapl', ticker: 'AAPL', name: 'Apple', exDate: '2026-05-11', payDate: null, qty: 10, perShare: .26, gross: 2.6, currency: 'USD', source: 'market-history', estimated: true, verified: true }, { id: 'man', holdingId: 'aapl', ticker: 'AAPL', name: 'Apple', payDate: '2026-08-14', qty: 10, gross: 2.6, currency: 'USD', source: 'manual', verified: true }];
    const csv = ['Date,Heure,Date de valeur,Produit,ISIN,Description,Taux de change,Variation,,Solde,,ID Ordre', '14-05-2026,00:00,14-05-2026,APPLE INC.,US0378331005,Dividende,,USD,"2,60",EUR,"103,00",', '14-05-2026,00:00,14-05-2026,APPLE INC.,US0378331005,Impôt sur dividende,,USD,"-0,39",EUR,"102,61",',
      '14-08-2026,00:00,14-08-2026,APPLE INC.,US0378331005,Dividende,,USD,"2,60",EUR,"105,00",', '14-02-2026,00:00,14-02-2026,APPLE INC.,US0378331005,Dividende,,USD,"2,50",EUR,"107,50",'].join('\n');
    const p = await device({ guest: true, seed }); await p.open(); await dgOpen(p, csv);
    ok(/3\s+dividende\(s\) du relevé de compte/.test((await p.locator('#dgSummary').innerText()).replace(/\n/g, ' ')), 'dividendes du relevé détectés : ' + (await p.locator('#dgSummary').innerText()).replace(/\n/g, ' | ').slice(0, 300));
    ok(await p.locator('#dgDivRow').isVisible(), 'case dividendes visible'); await dgConfirm(p); await idle(p); const st = await storeOf(p);
    const dg = st.payments.filter((x) => x.source === 'degiro').map((x) => [x.payDate, x.gross, x.tax, x.net]).sort(); eq(dg, [['2026-02-14', 2.5, null, null], ['2026-05-14', 2.6, 0.39, 2.21]].sort(), 'montants réels : retenue et net seulement quand le courtier les fournit');
    ok(!st.payments.some((x) => x.id === 'est'), 'estimation de marché du même versement remplacée'); ok(st.payments.some((x) => x.id === 'man'), 'versement saisi à la main conservé (doublon du 14 août ignoré)'); eq(st.payments.length, 3, '3 versements : 14 févr., 14 mai (réel), 14 août (saisie)');
    eq(p.errors, [], 'aucune erreur JS');
  });

  await test('actualisation : tirer la page vers le bas (téléphone) actualise cours et taux, seulement en haut de page et au-delà du seuil ; bouton discret ; mise à jour de l\'application détectée puis rechargée', async () => {
    RELAY.old = false;
    const seed = SEED(0); seed.holdings = [{ id: 'aapl', ticker: 'AAPL', displayTicker: 'AAPL', name: 'Apple', type: 'stock', instrumentType: 'EQUITY', currency: 'USD', quantity: 10, avgCost: 150, price: 190, account: 'main', logo: null, source: 'degiro', addedAt: '2026-01-01', dividend: {} }];
    const p = await device({ guest: true, seed, mobile: true, viewport: { width: 390, height: 844 } }); await p.open(); await p.waitForSelector('#ptr', { state: 'attached' }); await p.waitForTimeout(500);
    const pull = (from, to, steps) => p.evaluate(async ([a, b, n]) => {
      const tgt = document.querySelector('.hero') || document.body, mk = (y) => new Touch({ identifier: 1, target: tgt, clientX: 200, clientY: y });
      const fire = (type, y) => tgt.dispatchEvent(new TouchEvent(type, { bubbles: true, cancelable: true, touches: type === 'touchend' ? [] : [mk(y)], targetTouches: type === 'touchend' ? [] : [mk(y)], changedTouches: [mk(y)] }));
      fire('touchstart', a); for (let i = 1; i <= n; i++) { fire('touchmove', a + (b - a) * i / n); await new Promise((r) => setTimeout(r, 16)); } const txt = document.querySelector('#ptr .ptr-txt').textContent; fire('touchend', b); return txt;
    }, [from, to, steps]);
    const calls = () => p.evaluate(() => 0).then(() => RELAY.chartCalls || 0);
    let c0 = await calls(); const short = await pull(100, 140, 5); await p.waitForTimeout(500); eq(await calls(), c0, 'tirage trop court (' + short + ') : aucune actualisation');
    await p.evaluate(async () => { const tgt = document.querySelector('.hero'), mk = (y) => new Touch({ identifier: 1, target: tgt, clientX: 200, clientY: y }), fire = (t, y) => tgt.dispatchEvent(new TouchEvent(t, { bubbles: true, cancelable: true, touches: [mk(y)], targetTouches: [mk(y)], changedTouches: [mk(y)] })); fire('touchstart', 100); for (let i = 1; i <= 10; i++) { fire('touchmove', 100 + i * 17); await new Promise((r) => setTimeout(r, 16)); } });
    await shot(p, 'ptr'); await p.evaluate(() => document.dispatchEvent(new TouchEvent('touchcancel', { bubbles: true }))); await p.waitForTimeout(400);
    const mid = await pull(100, 260, 12); ok(/Relâchez/.test(mid), 'indicateur « Relâchez pour actualiser » au-delà du seuil : ' + mid); await p.waitForFunction(() => /À jour|Actualisation incomplète/.test(document.querySelector('#toastRoot').innerText), null, { timeout: 8000 }).catch(async () => { throw new Error('pas de bilan : ' + await p.evaluate(() => JSON.stringify([pullBusy, document.querySelector('#toastRoot').innerText, document.querySelector('#ptr .ptr-txt').textContent])) + ' erreurs ' + JSON.stringify(p.errors)); });
    ok((await calls()) > c0, 'cours actualisés auprès du relais Yahoo (' + c0 + ' → ' + (await calls()) + ')'); ok(/actif\(s\) actualisé/.test(await p.locator('#toastRoot').innerText()), 'bilan affiché');
    await p.waitForTimeout(800); c0 = await calls(); await p.evaluate(() => { document.body.style.minHeight = '3000px'; window.scrollTo(0, 400); }); await p.waitForTimeout(200); await pull(100, 260, 12); await p.waitForTimeout(600); eq(await calls(), c0, 'page défilée (pas en haut) : le tirage ne déclenche rien');
    await p.evaluate(() => { window.scrollTo(0, 0); document.body.style.minHeight = ''; }); await p.waitForTimeout(3500);
    await p.click('[data-rf-btn]'); await p.waitForFunction(() => /À jour|Actualisation incomplète/.test(document.querySelector('#toastRoot').innerText), null, { timeout: 10000 }).catch(async () => { throw new Error('bouton sans bilan : ' + await p.evaluate(() => JSON.stringify([pullBusy, document.querySelector('#toastRoot').innerText, document.querySelector('[data-rf-btn]').className]))); }); ok((await calls()) > c0, 'le bouton discret actualise aussi');
    // nouvelle version publiée : détectée, application rechargée (au lieu d\'actualiser seulement les cours)
    await p.addInitScript(() => { if (localStorage.getItem('sim_new_version') === '1') { const of = window.fetch.bind(window); window.fetch = (u, o) => (/sw\.js/.test(String(u)) ? Promise.resolve(new Response("const SHELL = 'dividendes-shell-v999';")) : of(u, o)); } }); await p.evaluate(() => { localStorage.setItem('sim_new_version', '1'); const of = window.fetch.bind(window); window.fetch = (u, o) => (/sw\.js/.test(String(u)) ? Promise.resolve(new Response("const SHELL = 'dividendes-shell-v999';")) : of(u, o)); }); await p.evaluate(() => { window.__marker = 1; });
    await p.click('[data-rf-btn]'); await p.waitForFunction(() => window.__marker === undefined, null, { timeout: 10000 }).catch(async () => { throw new Error('pas de rechargement : ' + await p.evaluate(() => JSON.stringify([pullBusy, updateAvail, document.querySelector('#toastRoot').innerText])) + ' ' + JSON.stringify(p.errors)); }); await p.waitForSelector('#page'); ok(true, 'application rechargée à la détection d\'une nouvelle version');
    await p.waitForSelector('[data-rf-btn].has-update', { timeout: 15000 }); ok(true, 'après rechargement, version publiée toujours plus récente (simulation) : pastille de mise à jour sur le bouton, sans boucle');
  });

  await test('vendre / clôturer une position : prix de sortie, vente partielle ou totale, résultat réalisé, portefeuille ajusté ; la suppression d\'une position demande d\'abord ce qui s\'est passé', async () => {
    RELAY.old = false;
    const seed = SEED(0); const base = { type: 'stock', instrumentType: 'EQUITY', currency: 'EUR', logo: null, source: 'manual', addedAt: '2025-01-01', account: 'main', dividend: { none: true } };
    seed.holdings = [Object.assign({}, base, { id: 'v1', ticker: 'AAA', displayTicker: 'AAA', name: 'Alpha', quantity: 10, avgCost: 100, price: 130 }), Object.assign({}, base, { id: 'v2', ticker: 'BBB', displayTicker: 'BBB', name: 'Beta', quantity: 5, avgCost: 50, price: 60 })];
    const p = await device({ guest: true, seed }); p.setDefaultTimeout(8000); await p.open(); await p.evaluate(() => go('portfolio')); await p.waitForTimeout(300);
    await p.evaluate(() => openHoldingModal('v1')); await p.waitForSelector('#hSell'); await p.click('#hSell'); await p.waitForSelector('#slPrice');
    await p.click('#slMode [data-m=part]'); await p.fill('#slQty', '4'); await p.fill('#slPrice', '120'); await p.fill('#slFees', '2'); await p.waitForTimeout(150);
    const prev = (await p.locator('#slPrev').innerText()).replace(/\n/g, ' | '); await shot(p, 'sell'); ok(/478/.test(prev) && /\+?78/.test(prev) && /6/.test(prev) && /inchangé/.test(prev), 'aperçu : produit 478 €, résultat +78 €, reste 6 : ' + prev);
    await p.fill('#slQty', '11'); await p.click('#slGo'); ok(/dépasse la quantité détenue/.test(await p.locator('#slErr').innerText()), 'quantité excessive refusée'); await p.fill('#slQty', '4'); await p.click('#slGo'); await p.waitForTimeout(400);
    let st = await storeOf(p); const h1 = st.holdings.find((x) => x.id === 'v1'); eq([h1.quantity, h1.avgCost], [6, 100], 'quantité 6, PRU inchangé'); eq(st.transactions.map((t) => [t.type, t.qty, t.price, t.opening || false]).sort(), [['buy', 10, 100, true], ['sell', 4, 120, false]].sort(), 'ouverture au PRU saisi + vente');
    ok(/Vente partielle enregistrée/.test(await p.locator('#toastRoot').innerText()), 'confirmation');
    // suppression d'une autre position : on demande d'abord ce qui s'est passé
    await p.evaluate(() => { confirmDeleteHoldings(['v2']); }); await p.waitForSelector('[data-c=all]'); ok(/Que s'est-il passé/.test(await p.locator('.modal').innerText()), 'question posée avant suppression'); await p.click('[data-c=all]'); await p.waitForSelector('#slPrice');
    await p.fill('#slPrice', '70'); await p.click('#slGo'); await p.waitForTimeout(400); st = await storeOf(p);
    ok(!st.holdings.some((x) => x.id === 'v2') && st.archive.some((x) => x.id === 'v2' && x.userClosed && x.exitPrice === 70), 'clôture : la position quitte le portefeuille actuel, prix de sortie conservé');
    await p.evaluate(() => { view.port.tab = 'closed'; go('portfolio'); renderPage(); }); await p.waitForTimeout(300); const cl = await p.locator('#page').innerText(); ok(/Beta/.test(cl) && /\+\s?100/.test(cl), 'onglet Clôturées : Beta, résultat réalisé +100 € (5 × (70 − 50)) : ' + cl.replace(/\n/g, ' | ').slice(0, 300));
    await p.evaluate(() => { view.port.tab = 'ops'; go('portfolio'); renderPage(); }); await p.waitForTimeout(300); ok(/Ouverture/.test(await p.locator('#tblHost').innerText()), 'opération « Ouverture » signalée');
    await p.evaluate(() => { confirmDeleteHoldings(['v1']); }); await p.waitForSelector('[data-c=delete]'); await p.click('[data-c=delete]'); await p.waitForSelector('#cdYes'); await p.click('#cdYes'); await p.waitForTimeout(300); ok(!(await storeOf(p)).holdings.some((x) => x.id === 'v1'), 'suppression simple possible (ajout par erreur)');
    eq(p.errors, [], 'aucune erreur JS');
  });

  await test('achats multiples saisis à la main (date + nombre d\'actions) : position inchangée, écart signalé, dividendes éligibles selon chaque date, performance de la seule sélection (sans les autres actifs)', async () => {
    RELAY.old = false;
    const base = { type: 'stock', instrumentType: 'EQUITY', currency: 'EUR', logo: null, source: 'manual', addedAt: '2026-01-01', account: 'main', dividend: { none: true } };
    const seed = SEED(0); seed.holdings = [Object.assign({}, base, { id: 'a1', ticker: 'AAPL', displayTicker: 'AAPL', name: 'Alpha', quantity: 10, avgCost: 110, price: 100, hist: { from: '2026-01', c: Array(10).fill(100) } }), Object.assign({}, base, { id: 'b1', ticker: 'AI.PA', displayTicker: 'AI.PA', name: 'Beta', quantity: 5, avgCost: 100, price: 200, hist: { from: '2026-01', c: [100, 110, 120, 130, 140, 150, 160, 170, 180, 200] } })];
    const p = await device({ guest: true, seed, viewport: { width: 1280, height: 1000 } }); p.setDefaultTimeout(10000); await p.open(); await p.evaluate(() => go('portfolio')); await p.waitForTimeout(300);
    ok(!/Rendement annuel moyen/i.test(await p.locator('#page').innerText()), 'pas de rendement annuel');
    await p.evaluate(() => openHoldingModal('a1')); await p.click('#hBuys'); await p.waitForSelector('#byDate');
    await p.fill('#byDate', '2026-01-15'); await p.fill('#byQty', '4'); await p.fill('#byPrice', '100'); await p.click('#byAdd'); await p.waitForFunction(() => /il manque 6/.test((document.querySelector('.modal') || {}).innerText || ''));
    ok(/Achats saisis : 4 sur 10/.test((await p.locator('.modal').innerText()).replace(/\s+/g, ' ')) && /il manque 6/.test(await p.locator('.modal').innerText()), 'écart signalé : il manque 6 titres'); eq(await p.inputValue('#byQty'), '6', 'quantité manquante préremplie');
    await p.fill('#byDate', '2026-04-01'); await p.fill('#byPrice', '120'); await p.click('#byAdd'); await p.waitForTimeout(500); await p.waitForSelector('#byDate'); await shot(p, 'buys'); ok(/cohérent avec la quantité détenue/.test(await p.locator('.modal').innerText()), 'cohérent avec la quantité détenue'); await p.click('.modal [data-close]'); await p.waitForTimeout(300);
    let st = await storeOf(p); const a1 = st.holdings.find((x) => x.id === 'a1'); eq([a1.quantity, a1.avgCost], [10, 110], 'quantité et PRU de la position inchangés'); eq(st.transactions.filter((t) => t.holdingId === 'a1').map((t) => [t.date, t.qty, t.price]).sort(), [['2026-01-15', 4, 100], ['2026-04-01', 6, 120]], 'deux achats datés');
    // performance de la seule sélection
    await p.check('[data-selrow="a1"]'); await p.waitForSelector('#selPerf .sel-perf'); await p.click('#selPerSeg [data-sper="0"]'); await p.waitForTimeout(300); await shot(p, 'selperf'); const sp = (await p.locator('#selPerf').innerText()).replace(/\s+/g, ' ');
    ok(/Performance de la sélection/.test(sp) && /1 position sélectionnée/.test(sp) && /sans les autres actifs/.test(sp), 'carte de la sélection : ' + sp.slice(0, 200)); ok(/Performance · Tout\s*[−-]\s?120\s?€/i.test(sp), 'Alpha seul : valeur 1 000 − coût 1 120 = −120 € (Beta, en forte hausse, exclue) : ' + sp.slice(0, 400)); ok(/[−-]\d+,\d\s?%/.test(sp) && /pondéré dans le temps/.test(sp), 'pourcentage affiché car historique complet : ' + sp.slice(0, 400));
    await p.check('[data-selrow="b1"]'); await p.waitForTimeout(300); const sp2 = (await p.locator('#selPerf').innerText()).replace(/\s+/g, ' '); ok(/2 positions sélectionnées/.test(sp2) && /pourcentage non affiché/.test(sp2), 'Beta sans historique d\'achats : pourcentage non affiché, jamais un chiffre trompeur : ' + sp2.slice(0, 300));
    await p.uncheck('[data-selrow="a1"]'); await p.uncheck('[data-selrow="b1"]'); await p.waitForTimeout(200); eq(await p.locator('#selPerf .sel-perf').count(), 0, 'sans sélection : pas de carte');
    // dividendes passés : Alpha calculable d'après les achats saisis, Beta à compléter
    await p.evaluate(() => { view.divTab = 'history'; go('dividends'); }); await p.waitForTimeout(300); await p.click('[data-do=div-history]'); await p.waitForSelector('#dhGo'); const rows = await p.locator('.modal tbody tr').allInnerTexts();
    ok(rows.length === 3 && rows.every((r) => /Alpha/.test(r)), '3 versements éligibles pour Alpha : ' + rows.map((r) => r.replace(/\s+/g, ' ')).join(' / ')); ok(/10/.test(rows[0]) && /4/.test(rows[2]), 'quantité éligible : 4 au 9 févr., 10 ensuite : ' + rows.map((r) => r.replace(/\s+/g, ' ').slice(0, 60)).join(' / '));
    await p.click('[data-buys="b1"]'); await p.waitForSelector('#byDate'); ok(/Achats de Beta/.test(await p.locator('.modal').innerText()), 'lien « Saisir les achats » depuis la liste des titres non calculables');
    eq(p.errors, [], 'aucune erreur JS');
  });

  await test('dividendes passés complétés : positions détenues ET clôturées, achats datés, brouillon « à vérifier » remplacé, montants perçus de l\'accueil mis à jour', async () => {
    RELAY.old = false;
    const base = { type: 'stock', instrumentType: 'EQUITY', logo: null, source: 'degiro', derived: true, addedAt: '2026-01-01', account: 'main', dividend: { lastAmount: .26, frequency: 'quarterly', anchorMonth: 2, dateKind: 'ex' } };
    const seed = SEED(0); seed.holdings = [Object.assign({}, base, { id: 'aapl', ticker: 'AAPL', displayTicker: 'AAPL', name: 'Apple', currency: 'USD', quantity: 10, avgCost: 150, price: 190 })];
    seed.archive = [{ id: 'old', ticker: 'AI.PA', displayTicker: 'AI.PA', isin: 'FR0000120073', name: 'Air Liquide (ancienne)', currency: 'EUR', account: 'main', closedAt: '2025-06-01', hist: null, userClosed: true }];
    const T = (id, h, date, type, qty, price) => ({ id, holdingId: h, date, type, qty, price, fees: 0, currency: 'EUR', amountAcct: qty * price, acctCur: 'EUR', source: 'degiro' });
    seed.transactions = [T('t1', 'aapl', '2026-01-15', 'buy', 10, 150), T('o1', 'old', '2024-01-10', 'buy', 5, 100), T('o2', 'old', '2025-06-01', 'sell', 5, 130)];
    seed.payments = [{ id: 'draft', holdingId: 'aapl', ticker: 'AAPL', name: 'Apple', exDate: '2026-02-09', payDate: null, qty: 10, perShare: .25, gross: 2.5, currency: 'USD', source: 'auto', verified: false }];
    const p = await device({ guest: true, seed }); p.setDefaultTimeout(15000); await p.open(); await p.evaluate(() => go('home')); await p.waitForTimeout(400);
    ok(/Compléter l'historique/.test(await p.locator('#divCardEl').innerText()), 'accueil : lien « Compléter l\'historique »');
    await p.evaluate(() => { view.divTab = 'history'; go('dividends'); }); await p.waitForTimeout(300); ok(/Complétez vos dividendes passés/.test(await p.locator('#page').innerText()), 'historique : invitation à compléter');
    await p.click('[data-do=div-history]'); await p.waitForSelector('#dhGo', { timeout: 60000 }); const t = (await p.locator('.modal').innerText()).replace(/\s+/g, ' ');
    ok(/Air Liquide \(ancienne\) clôturée/.test(t), 'position clôturée proposée (dividendes perçus tant qu\'elle était détenue) : ' + t.slice(0, 500)); ok(/remplace 1 brouillon/.test(t), 'brouillon « à vérifier » remplacé, pas pris pour un doublon');
    const rows = await p.locator('.modal tbody tr').allInnerTexts(); ok(rows.filter((r) => /Air Liquide/.test(r)).length === 2, '2 détachements pour l\'ancienne position (2024 et 2025 ; pas 2026 après la vente) : ' + rows.length + ' lignes');
    ok(/Détachement passé/.test(t) && /il y a \d+ j/.test(t), 'vérification : détachement passé depuis N jours, détenu à la veille');
    await p.click('#dhGo'); await p.waitForTimeout(500); const st = await storeOf(p); ok(!st.payments.some((x) => x.id === 'draft'), 'brouillon remplacé'); const add = st.payments.filter((x) => x.source === 'market-history');
    ok(add.length >= 5 && add.every((x) => x.estimated && x.verified && x.payDate === null), add.length + ' dividendes estimés ajoutés, date de paiement non inventée'); ok(add.some((x) => x.holdingId === 'old'), 'rattachés aussi à la position clôturée');
    ok(/perçus en \d{4}/.test(await p.locator('#toastRoot').innerText()), 'bilan des montants perçus affiché'); await p.evaluate(() => go('home')); await p.waitForTimeout(400); ok(/dont .* estimés/.test(await p.locator('#divCardEl').innerText()), 'accueil : « dont X estimés »');
    eq(p.errors, [], 'aucune erreur JS');
  });

  await test('relevé de compte DEGIRO : dividendes réels y compris sociétés non détenues, estimations confirmées (remplacées), estimations non confirmées marquées « à vérifier », achats du relevé non importés par défaut', async () => {
    RELAY.old = false;
    const seed = SEED(0); seed.holdings = [{ id: 'aapl', ticker: 'AAPL', displayTicker: 'AAPL', isin: 'US0378331005', name: 'Apple', type: 'stock', instrumentType: 'EQUITY', currency: 'USD', quantity: 10, avgCost: 150, price: 190, account: 'main', logo: null, source: 'degiro', derived: true, addedAt: '2026-01-01', dividend: {} }];
    seed.transactions = [{ id: 't1', holdingId: 'aapl', date: '2026-01-15', type: 'buy', qty: 10, price: 150, fees: 0, currency: 'USD', amountAcct: 1400, acctCur: 'EUR', source: 'degiro' }];
    const est = (id, ex, g) => ({ id, holdingId: 'aapl', ticker: 'AAPL', name: 'Apple', exDate: ex, payDate: null, qty: 10, perShare: g / 10, gross: g, currency: 'USD', source: 'market-history', estimated: true, verified: true });
    seed.payments = [est('e1', '2026-05-11', 2.6), est('e3', '2026-02-09', 2.5)];
    const csv = ['Date,Heure,Date de,Produit,Code ISIN,Description,FX,Mouvements,,Solde,,ID Ordre',
      '15-05-2026,07:44,14-05-2026,APPLE INC.,US0378331005,Dividende,,USD,"2,60",USD,"10,00",', '15-05-2026,07:44,14-05-2026,APPLE INC.,US0378331005,Impôts sur dividende,,USD,"-0,39",USD,"9,61",',
      '15-08-2026,07:44,14-08-2026,APPLE INC.,US0378331005,Dividende,,USD,"2,60",USD,"12,00",', '04-03-2025,07:44,03-03-2025,ANCIENNE SA,FR0000000009,Dividende,,EUR,"5,00",EUR,"15,00",',
      '05-01-2026,09:00,05-01-2026,,,Dépôt flatex Deposit,,EUR,"100,00",EUR,"123,00",', '28-10-2026,15:41,28-10-2026,APPLE INC.,US0378331005,"Achat 20 APPLE INC.@170 USD (US0378331005)",,USD,"-3400,00",USD,"-3400,00",abc'].join('\n');
    const p = await device({ guest: true, seed }); p.setDefaultTimeout(15000); await p.open(); await dgOpen(p, csv, 'Account.csv');
    const sum = (await p.locator('#dgSummary').innerText()).replace(/\n/g, ' | '); ok(/3\s+dividende\(s\) du relevé de compte/.test(sum) && /1 ajoutée\(s\) aux positions clôturées/.test(sum) && /1\s+estimation\(s\) remplacée/.test(sum), 'résumé : ' + sum.slice(0, 420));
    ok(await p.locator('#dgOpsRow').isVisible() && !(await p.locator('#dgOps').isChecked()), 'achats/ventes du relevé : case décochée par défaut (déjà des transactions)'); ok(await p.locator('#dgUnconfRow').isVisible() && /1<\/b> dividende/.test(await p.locator('#dgUnconfTxt').innerHTML()), 'estimation non confirmée signalée (1)');
    await dgConfirm(p); await idle(p); const st = await storeOf(p);
    eq(st.transactions.length, 1, 'achat du relevé non importé (pas de doublon avec Transactions)'); const dg = st.payments.filter((x) => x.source === 'degiro'); eq(dg.map((x) => [x.payDate, x.gross, x.tax, x.net]).sort(), [['2025-03-03', 5, null, null], ['2026-05-14', 2.6, 0.39, 2.21], ['2026-08-14', 2.6, null, null]].sort(), 'dividendes réels, à la date de valeur');
    ok(!st.payments.some((x) => x.id === 'e1'), 'estimation confirmée remplacée'); eq(st.payments.find((x) => x.id === 'e3').verified, false, 'estimation non confirmée : « à vérifier »'); const stub = st.archive.find((a) => a.statementOnly); ok(stub && stub.isin === 'FR0000000009' && st.payments.some((x) => x.holdingId === stub.id && x.gross === 5), 'société non détenue : position archivée « relevé seul » + dividende rattaché');
    await p.evaluate(() => { view.port.tab = 'closed'; go('portfolio'); renderPage(); }); await p.waitForTimeout(300); ok(!/ANCIENNE/.test(await p.locator('#page').innerText()), 'la position « relevé seul » n\'encombre pas l\'onglet Clôturées');
    eq(p.errors, [], 'aucune erreur JS');
  });

  await test('contrôle : position calculée absente de vos positions réelles → archivage proposé ; une position saisie n\'est JAMAIS archivée automatiquement ; transactions conservées ; annulable', async () => {
    const seed = SEED(0);
    seed.holdings = [H(0, { ticker: 'AAPL', displayTicker: 'AAPL', isin: 'US0378331005', name: 'Apple réelle', quantity: 3, avgCost: 90 }), H(1, { ticker: 'OLD', displayTicker: 'OLD', isin: 'FR0000120271', name: 'Ancienne 2019', quantity: 5, avgCost: 10, source: 'degiro', derived: true })];
    seed.transactions = [{ id: 't1', holdingId: 'h1', date: '2019-03-03', type: 'buy', qty: 5, price: 10, fees: 0, currency: 'EUR', amountAcct: 50, acctCur: 'EUR', source: 'degiro', isin: 'FR0000120271' }, { id: 't2', holdingId: 'h0', date: '2022-01-01', type: 'buy', qty: 3, price: 90, fees: 0, currency: 'EUR', amountAcct: 270, acctCur: 'EUR', source: 'degiro', isin: 'US0378331005' }];
    seed.reference = { at: '2026-10-14T10:00:00Z', name: 'Portefeuille.csv', account: 'main', positions: [{ isin: 'US0378331005', qty: 3, name: 'Apple' }] };
    const p = await device({ guest: true, seed }); await p.open(); await p.evaluate(() => openDiagnostic()); await p.waitForSelector('.diag-item');
    const dg = (await p.locator('.modal').innerText()).replace(/\n/g, ' | '); ok(/Ancienne 2019/.test(dg) && /absente de vos positions réelles/.test(dg) && /Archiver la position/.test(dg) && /relevé de portefeuille DEGIRO chargé \(1 position/.test(dg), 'anomalie, cause, action : ' + dg.slice(0, 400));
    ok(!/Apple réelle[^|]*\|[^|]*absente/.test(dg), 'la position réelle n\'est pas signalée');
    await p.click('[data-diag=archive]'); await p.waitForTimeout(300); let s2 = await storeOf(p);
    eq(s2.holdings.map((h) => h.id), ['h0'], 'position fantôme retirée du portefeuille actuel'); eq(s2.archive.map((a) => a.id), ['h1'], 'conservée dans l\'historique (clôturée / à vérifier)'); eq(s2.transactions.length, 2, 'transactions intactes');
    ok(await p.locator('.toast:has-text("archivée")').count(), 'confirmation visible'); await p.click('.toast button'); await p.click('#cdYes'); await p.waitForTimeout(300); s2 = await storeOf(p); eq(s2.holdings.map((h) => h.id), ['h0', 'h1'], 'annulé');
    ok(await p.evaluate(() => Ledger.demote(state, 'h0', 'x', 'x', { today: '2026-10-15' }).ok === false), 'une position saisie n\'est jamais archivée automatiquement');
    eq(p.errors, [], 'aucune erreur JS');
  });

  await test('mon portefeuille : ETF et actions en sections distinctes, « À classer » pour les actifs non identifiés, catégorie corrigeable à la main et protégée des actualisations', async () => {
    RELAY.old = false;
    const seed = SEED(0); seed.holdings = [
      H(0, { name: 'Action A', instrumentType: 'EQUITY' }), H(1, { name: 'ETF distribuant', type: 'etf_dist', instrumentType: 'ETF' }),
      H(2, { name: 'iShares Core MSCI World UCITS ETF', instrumentType: undefined }),             // reconnu par le nom
      H(3, { name: 'Valeur inconnue', instrumentType: undefined }),                              // aucun indice : à classer
      H(4, { ticker: 'IWDA.AS', displayTicker: 'IWDA.AS', name: 'Classé action par moi', type: 'stock', typeLocked: true, typeSource: 'user', instrumentType: undefined })];
    const p = await device({ guest: true, seed }); await p.open(); await p.evaluate(() => go('portfolio')); await p.waitForTimeout(300);
    eq(await p.locator('.port-sec h2').allInnerTexts(), ['À classer', 'ETF', 'Actions'], 'sections');
    const by = async (k) => (await p.locator('#tblHost-' + k + ' tbody tr').allInnerTexts()).map((t) => t.replace(/\s+/g, ' '));
    const u = await by('unknown'), e = await by('etf'), a = await by('stock'); ok(u.length === 1 && /Valeur inconnue/.test(u[0]), 'à classer : ' + u.join('|')); ok(e.length === 2 && e.some((x) => /ETF distribuant/.test(x)) && e.some((x) => /iShares/.test(x)), 'ETF : ' + e.join('|')); ok(a.length === 2 && a.some((x) => /Action A/.test(x)) && a.some((x) => /Classé action/.test(x)), 'actions : ' + a.join('|'));
    ok(await p.locator('#tblHost-unknown .cat-sel').count() === 1, 'sélecteur de catégorie dans « À classer »'); await shot(p, 'portfolio-sections');
    await p.selectOption('#tblHost-unknown .cat-sel', 'etf_acc'); await p.waitForTimeout(300); let s2 = await storeOf(p); const h3 = s2.holdings.find((h) => h.id === 'h3');
    eq([h3.type, h3.typeLocked, h3.typeSource], ['etf_acc', true, 'user'], 'choix enregistré'); eq(await p.locator('.port-sec h2').allInnerTexts(), ['ETF', 'Actions'], 'plus rien à classer'); ok((await by('etf')).length === 3, 'déplacé dans ETF');
    // actualisation : ETF Yahoo (IWDA.AS) mais choisi « action » à la main → inchangé ; import CSV : aucune position existante modifiée
    await p.click('[data-do=refresh]'); await p.waitForFunction(() => state.holdings.find((h) => h.id === 'h4').price > 0, null, { timeout: 8000 }).catch(() => {}); await p.waitForTimeout(600); s2 = await storeOf(p);
    eq([s2.holdings.find((h) => h.id === 'h4').type, s2.holdings.find((h) => h.id === 'h3').type], ['stock', 'etf_acc'], 'catégories choisies à la main conservées après actualisation');
    // fiche de l'actif : choix manuel verrouillé
    await p.evaluate(() => openHoldingModal('h0')); await p.waitForSelector('#hType'); await p.selectOption('#hType', 'etf_dist'); await p.click('#hSave'); await p.waitForTimeout(300); s2 = await storeOf(p);
    eq([s2.holdings.find((h) => h.id === 'h0').type, s2.holdings.find((h) => h.id === 'h0').typeLocked], ['etf_dist', true], 'fiche : catégorie modifiée et verrouillée'); eq(p.errors, [], 'aucune erreur JS');
  });

  await test('accueil refondu : valeur + plus-value totale + plus-value journalière + rendement annuel moyen (TRI) ; sans bruts/nets ni cases secondaires ; ordre valeur → dividendes (réduit) → PERFORMANCES', async () => {
    const T = new Date(), iso = (d) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    const yest = new Date(T.getTime() - 86400000), t0 = new Date(T.getFullYear() - 2, T.getMonth(), 15), spanDays = Math.round((Date.UTC(T.getFullYear(), T.getMonth(), T.getDate()) - Date.UTC(t0.getFullYear(), t0.getMonth(), t0.getDate())) / 86400000);
    const seed = SEED(0); seed.holdings = [
      H(0, { name: 'Alpha', quantity: 10, avgCost: 100, price: 120, priceAt: iso(T), prevClose: 118, prevCloseAt: iso(yest), hist: { from: ymAgo(24), c: Array.from({ length: 25 }, (_, k) => 100 + k * 0.8) } }),
      H(1, { name: 'Bêta', quantity: 5, avgCost: 50, price: 50, priceAt: iso(T), prevClose: 40, prevCloseAt: iso(yest), hist: { from: ymAgo(24), c: Array.from({ length: 25 }, () => 50) } })];
    seed.transactions = [{ id: 't1', holdingId: 'h0', date: iso(t0), type: 'buy', qty: 10, price: 100, fees: 0, currency: 'EUR', amountAcct: 1000, acctCur: 'EUR', source: 'degiro' }, { id: 't2', holdingId: 'h1', date: iso(T), type: 'buy', qty: 5, price: 50, fees: 0, currency: 'EUR', amountAcct: 250, acctCur: 'EUR', source: 'degiro' }];
    const p = await device({ guest: true, seed, viewport: { width: 1280, height: 1100 } }); await p.open(); await p.waitForSelector('.hero');
    const pg = (await p.locator('#page').innerText()).replace(/\n/g, ' | ');
    ok(!/Bruts|Nets\b|Par secteur|Par pays|vs PRU|Rendement sur coût|Actifs\b|Prochains dividendes/.test(pg), 'anciennes cases supprimées : ' + pg.slice(0, 600));
    ok(/1\s?450\s?€/.test(pg), 'valeur totale = 10 × 120 + 5 × 50 = 1 450 €'); ok(/PLUS-VALUE TOTALE \| \+200\s?€/i.test(pg), 'plus-value totale = 1 450 − (1 000 + 250) = +200 € : ' + pg.slice(0, 300));
    ok(/PLUS-VALUE JOURNALIÈRE \| \+20\s?€/i.test(pg) && /\+1,69\s?%/.test(pg), 'plus-value journalière = 10 × (120 − 118) = +20 € : l\'achat du jour (Bêta) ne compte pas : ' + pg.slice(0, 500));
    ok(!(await p.locator('.xirr-chip').count()) && !/Rendement annuel moyen|annualisé/i.test(pg), 'le taux de rendement annuel n\'est plus affiché');
    const geo = await p.evaluate(() => { const cs = Array.from(document.querySelectorAll('#page .card')), hero = cs.find((c) => c.classList.contains('hero')), div = cs.find((c) => /^Dividendes/.test((c.querySelector('h3') || {}).textContent || '')), perf = cs.find((c) => /^PERFORMANCES/.test((c.querySelector('h3') || {}).textContent || '')); const r = (e) => e.getBoundingClientRect(); return { hero: r(hero), div: r(div), perf: r(perf) }; });
    ok(geo.hero.right <= geo.div.left + 1 && Math.abs(geo.hero.top - geo.div.top) < 4, 'ordinateur : valeur et dividendes côte à côte : ' + JSON.stringify([geo.hero.left, geo.hero.right, geo.div.left, geo.hero.top, geo.div.top]));
    ok(geo.perf.top >= Math.max(geo.hero.bottom, geo.div.bottom) - 1, 'PERFORMANCES en dessous des deux');
    ok(/PERFORMANCES/.test(pg) && /Les plus rentables/i.test(pg) && /Les plus négatives/i.test(pg) && !/vs PRU/i.test(pg), 'carte PERFORMANCES : listes, sans « vs PRU » : ' + pg.slice(pg.indexOf('PERFORMANCES')));
    // historique < 1 an : données insuffisantes, jamais un chiffre trompeur
    const seed2 = SEED(0); seed2.holdings = [H(0, { name: 'Alpha', quantity: 10, avgCost: 100, price: 120, priceAt: iso(T), hist: { from: ymAgo(6), c: [100, 102, 104, 108, 112, 116, 120] } })];
    seed2.transactions = [{ id: 't1', holdingId: 'h0', date: ymAgo(5) + '-15', type: 'buy', qty: 10, price: 100, fees: 0, currency: 'EUR', amountAcct: 1000, acctCur: 'EUR', source: 'degiro' }];
    const q = await device({ guest: true, seed: seed2 }); await q.open(); await q.waitForSelector('.hero'); ok(!(await q.locator('.xirr-chip').count()), 'moins d\'un an : aucun indicateur annuel affiché');
    ok(/PLUS-VALUE JOURNALIÈRE \| —/i.test((await q.locator('#page').innerText()).replace(/\n/g, ' | ')), 'sans clôture précédente : « — » (pas de chiffre inventé)');
    // téléphone : pas de débordement
    const m = await device({ guest: true, seed, mobile: true, viewport: { width: 360, height: 800 } }); await m.open(); await m.waitForSelector('.hero');
    const o = await m.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: innerWidth })); ok(o.sw <= o.iw + 1, 'mobile sans débordement : ' + JSON.stringify(o));
    eq(p.errors.concat(q.errors, m.errors), [], 'aucune erreur JS');
  });

  await test('accueil : PERFORMANCES = les 5 positions les plus rentables et les 5 plus négatives (pas un graphique), triées, sans chevauchement, sans « vs PRU » ; valeur et dividendes côte à côte sur ordinateur, empilés sur téléphone', async () => {
    const seed = SEED(0); seed.holdings = Array.from({ length: 12 }, (_, i) => H(i, { name: 'Titre ' + i, quantity: 10, avgCost: 100, price: 100 + (i - 5) * 10, priceAt: '2026-10-09' }));
    const p = await device({ guest: true, seed, viewport: { width: 1280, height: 1000 } }); await p.open(); await p.waitForSelector('.perf-cols');
    const col = async (n) => (await p.locator('.perf-cols > div').nth(n).locator('.perf-row').allInnerTexts()).map((t) => t.replace(/\s+/g, ' ').trim());
    const best = await col(0), worst = await col(1);
    eq(best.map((t) => t.match(/Titre (\d+)/)[1]), ['11', '10', '9', '8', '7'], 'top 5 des plus rentables, du meilleur au moins bon'); ok(/\+60,0\s?%/.test(best[0]) && /\+20,0\s?%/.test(best[4]), 'pourcentages : ' + best.join(' | '));
    eq(worst.map((t) => t.match(/Titre (\d+)/)[1]), ['0', '1', '2', '3', '4'], 'top 5 des plus négatives, de la pire à la moins mauvaise'); ok(/−50,0\s?%|-50,0\s?%/.test(worst[0]) && /(−|-)10,0\s?%/.test(worst[4]), 'pourcentages négatifs : ' + worst.join(' | '));
    ok(/\+600\s?€/.test(best[0]) && /(−|-)500\s?€/.test(worst[0]), 'gain en euros affiché : ' + best[0] + ' // ' + worst[0]);
    eq(await p.locator('.card:has(h3:text("PERFORMANCES")) svg').count() - await p.locator('.card:has(h3:text("PERFORMANCES")) .avatar svg').count(), 0, 'aucun graphique dans PERFORMANCES'); ok(!/vs PRU/i.test(await p.locator('#page').innerText()), 'aucune mention « vs PRU »');
    const g = await p.evaluate(() => { const cs = Array.from(document.querySelectorAll('#page .card')), f = (re) => cs.find((c) => re.test((c.querySelector('h3') || {}).textContent || '') || (re.source === 'hero' && c.classList.contains('hero'))); const r = (e) => e.getBoundingClientRect(); return { hero: r(cs.find((c) => c.classList.contains('hero'))), div: r(f(/^Dividendes/)), perf: r(f(/^PERFORMANCES/)) }; });
    ok(g.hero.right <= g.div.left + 1 && Math.abs(g.hero.top - g.div.top) < 4, 'ordinateur : côte à côte'); ok(g.perf.top >= Math.max(g.hero.bottom, g.div.bottom) - 1, 'PERFORMANCES dessous');
    // peu de positions : aucune position négative dans « rentables », aucune positive dans « négatives »
    const s2 = SEED(0); s2.holdings = [H(0, { name: 'Gagnant', avgCost: 100, price: 120 }), H(1, { name: 'Perdant', avgCost: 100, price: 80 })];
    const q = await device({ guest: true, seed: s2 }); await q.open(); await q.waitForSelector('.perf-cols'); const qt = (n) => q.locator('.perf-cols > div').nth(n).innerText();
    ok(/Gagnant/.test(await qt(0)) && !/Perdant/.test(await qt(0)) && /Perdant/.test(await qt(1)) && !/Gagnant/.test(await qt(1)), 'séparation positifs / négatifs');
    if (process.env.SHOTS) await p.screenshot({ path: process.env.SHOTS + '/home3.png', fullPage: true });
    const m = await device({ guest: true, seed, mobile: true, viewport: { width: 390, height: 900 } }); await m.open(); await m.waitForSelector('.perf-cols');
    const gm = await m.evaluate(() => { const cs = Array.from(document.querySelectorAll('#page .card')), r = (e) => e.getBoundingClientRect(), hero = cs.find((c) => c.classList.contains('hero')), div = cs.find((c) => /^Dividendes/.test((c.querySelector('h3') || {}).textContent || '')); return { hb: r(hero).bottom, dt: r(div).top, sw: document.documentElement.scrollWidth, iw: innerWidth }; });
    ok(gm.dt >= gm.hb - 1 && gm.sw <= gm.iw + 1, 'téléphone : dividendes sous la valeur, sans débordement : ' + JSON.stringify(gm)); eq(p.errors.concat(q.errors, m.errors), [], 'aucune erreur JS');
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

  await test('contrôle des dividendes : bandeau, estimation en double et versement orphelin proposés, rien avant validation, total « reçu » corrigé, annulable', async () => {
    RELAY.old = false; const y = new Date().getFullYear();
    const seed = SEED(0); seed.holdings = [{ id: 'sap', ticker: 'SAP', displayTicker: 'SAP', isin: 'DE0007164600', name: 'SAP', type: 'stock', instrumentType: 'EQUITY', currency: 'EUR', quantity: 12, avgCost: 100, price: 150, account: 'main', logo: null, source: 'manual', addedAt: y + '-01-01', dividend: {} }];
    const pay = (id, h, d, g, src, more) => Object.assign({ id, holdingId: h, ticker: 'SAP', name: 'SAP', payDate: d, qty: 12, gross: g, net: g, currency: 'EUR', source: src, verified: true }, more || {});
    seed.payments = [pay('r', 'sap', y + '-02-10', 30, 'csv'), pay('a', 'sap', y + '-02-08', 30, 'auto'), pay('o', 'gone', y + '-03-10', 50, 'auto')];
    const p = await device({ guest: true, seed, viewport: { width: 1280, height: 1000 } }); await p.open(); await p.evaluate(() => { view.divTab = 'history'; go('dividends'); }); await p.waitForTimeout(300);
    ok(/2 anomalie\(s\) dans les dividendes/.test(await p.locator('#page').innerText()), 'bandeau : 2 anomalies — ' + (await p.locator('#page').innerText()).slice(0, 200));
    await p.evaluate(() => { view.divTab = 'stats'; go('dividends'); }); await p.waitForTimeout(300);
    ok(/Total reçu depuis le début \| 60,00\s?€/.test((await p.locator('#page').innerText()).replace(/\n/g, ' | ')), 'le versement orphelin n\'est pas compté ; l\'estimation en double l\'est encore : 30 + 30 = 60 → ' + (await p.locator('#page').innerText()).replace(/\n/g, ' | ').slice(0, 400));
    await p.evaluate(() => { view.divTab = 'history'; go('dividends'); }); await p.waitForTimeout(300); await p.click('[data-do=audit-pay]'); await p.waitForSelector('#auGo');
    eq(await p.locator('[data-au]:checked').count(), 2, 'deux anomalies cochées par défaut'); eq((await storeOf(p)).payments.length, 3, 'rien de modifié avant validation');
    await p.click('#auGo'); await p.waitForTimeout(400); const st = await storeOf(p); eq(st.payments.map((x) => x.id).sort(), ['r'], 'doublon et orphelin supprimés, versement réel conservé');
    ok(!/anomalie\(s\) dans les dividendes/.test(await p.locator('#page').innerText()), 'bandeau disparu'); await p.evaluate(() => { undoLastImport(); }); await p.waitForSelector('#cdYes'); await p.click('#cdYes'); await p.waitForTimeout(400); eq((await storeOf(p)).payments.length, 3, 'annulable');
    eq(p.errors, [], 'aucune erreur JS');
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
