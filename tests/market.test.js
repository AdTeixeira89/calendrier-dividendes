const assert = require('assert');
const M = require('../market.js');
M.setDelay(0);
let n=0; const t=async(name,fn)=>{ try{ await fn(); n++; console.log('ok  ',name);}catch(e){ console.log('FAIL',name,'\n   ',e.message); process.exitCode=1; } };
const ts = d => Math.floor(Date.parse(d)/1000);
const mkFetch = (routes) => async (url) => { const u = new URL(url); for (const [k,v] of Object.entries(routes)) if (url.includes(k)) { const r = typeof v==='function'? v(u):v; return { status: r.status||200, ok:(r.status||200)<400, json: async()=> r.body }; } return { status:404, ok:false, json: async()=>null }; };
const chart = (cur, divs, type='EQUITY', name='Air Liquide') => ({ chart:{ result:[{ meta:{ currency:cur, longName:name, instrumentType:type }, events:{ dividends: Object.fromEntries(divs.map((d,i)=>[i,{amount:d[1],date:ts(d[0])}])) } }] } });
(async()=>{
 await t('pickSymbol prefers listing matching ISIN country', ()=>{
   const q=[{symbol:'AIR.DE',quoteType:'EQUITY'},{symbol:'AI.PA',quoteType:'EQUITY'},{symbol:'X',quoteType:'OPTION'}];
   assert.strictEqual(M.pickSymbol(q,'FR0000120073'),'AI.PA');
   assert.strictEqual(M.pickSymbol([{symbol:'AAPL.MX'},{symbol:'AAPL'}],'US0378331005'),'AAPL');
 });
 await t('detectFrequency uses median (special dividend does not break it)', ()=>{
   assert.strictEqual(M.detectFrequency(['2025-02-01','2025-05-02','2025-06-01','2025-08-01','2025-11-01']),'quarterly');
   assert.strictEqual(M.detectFrequency(['2024-05-01','2025-05-01']),'annual');
 });
 await t('fetchAsset: ISIN -> symbol -> dividends, pence converted', async()=>{
   const c=M.makeClient({getRelay:()=>'https://r.dev',fetch:mkFetch({'/search':{body:{quotes:[{symbol:'AI.PA',quoteType:'EQUITY'}]}},'/chart':{body:chart('GBp',[['2025-05-01',50],['2026-05-01',60]])}})});
   const a=await c.fetchAsset('FR0000120073','AIR LIQUIDE'); assert.strictEqual(a.symbol,'AI.PA'); assert.strictEqual(a.currency,'GBP'); assert.strictEqual(a.dividends[1].amount,0.6); assert.strictEqual(a.resolved,true);
 });
 await t('applyToHolding: payer gets pattern (pay-date model) from ex-date + lag, manual fields untouched', ()=>{
   const h={id:'1',ticker:'FR0000120073',displayTicker:'FR0000120073',name:'AIR LIQUIDE',type:'stock',quantity:7,avgCost:100,dividend:{payDay:12,taxRate:30}};
   const a={symbol:'AI.PA',resolved:true,name:'L\'Air Liquide',currency:'EUR',instrumentType:'EQUITY',dividends:[{exDate:'2024-05-14',amount:3},{exDate:'2025-05-12',amount:3.2},{exDate:'2026-05-11',amount:3.4}]};
   M.applyToHolding(h,a,'2026-10-12');
   assert.strictEqual(h.ticker,'AI.PA'); assert.strictEqual(h.isin,'FR0000120073'); assert.strictEqual(h.name,'AIR LIQUIDE');
   assert.strictEqual(h.dividend.lastAmount,3.4); assert.strictEqual(h.dividend.anchorMonth,5); assert.strictEqual(h.dividend.frequency,'annual'); assert.strictEqual(h.dividend.dateKind,'pay');
   assert.strictEqual(h.quantity,7); assert.strictEqual(h.avgCost,100); assert.strictEqual(h.dividend.payDay,12); assert.strictEqual(h.dividend.taxRate,30);
 });
 await t('no recent dividend -> "none", never invented; ETF becomes accumulating', ()=>{
   const h={id:'1',ticker:'IWDA.AS',type:'stock',dividend:{lastAmount:5,anchorMonth:3,frequency:'annual'}};
   M.applyToHolding(h,{symbol:'IWDA.AS',resolved:false,name:'iShares',currency:'EUR',instrumentType:'ETF',dividends:[]},'2026-10-12');
   assert.strictEqual(h.dividend.none,true); assert.strictEqual(h.dividend.lastAmount,null); assert.strictEqual(h.type,'etf_acc');
   const h2={id:'2',ticker:'Z',type:'stock',typeLocked:true,dividend:{}}; M.applyToHolding(h2,{symbol:'Z',dividends:[],instrumentType:'ETF'},'2026-10-12'); assert.strictEqual(h2.type,'stock');
 });
 await t('stale dividend (older than 18 months) is not forecast', ()=>{
   const h={id:'1',ticker:'Z',type:'stock',dividend:{}}; M.applyToHolding(h,{symbol:'Z',dividends:[{exDate:'2024-01-10',amount:1}]},'2026-10-12'); assert.strictEqual(h.dividend.none,true);
 });
 await t('refreshMany stops on rate limit and reports', async()=>{
   let calls=0; const c=M.makeClient({getRelay:()=>'https://r.dev',fetch:async()=>{calls++; return {status:429,ok:false,json:async()=>({})};}});
   const hs=[1,2,3].map(i=>({id:''+i,ticker:'T'+i,dividend:{}})); const r=await M.refreshMany(c,hs,'2026-10-12'); assert.strictEqual(r.stopped,true); assert.strictEqual(calls,1);
 });
 await t('missing relay gives explicit message', async()=>{ const c=M.makeClient({getRelay:()=>''}); await assert.rejects(()=>c.fetchAsset('AAPL'),/relais/i); });
 console.log(n+' tests passed');
})();
(async () => {
  const c = M.makeClient({ getRelay: () => 'https://r.dev', fetch: async () => ({ status: 200, ok: true, json: async () => ({ chart: { result: [{ meta: { currency: 'GBp', longName: 'X', regularMarketPrice: 250, regularMarketTime: 1791800000 }, events: {} }] } }) }) });
  const a = await c.fetchAsset('XYZ.L'); assert.strictEqual(a.price, 2.5, 'pence → livres'); assert.ok(a.priceAt.startsWith('2026-'));
  const h = { id: '1', ticker: 'XYZ.L', dividend: {} }; M.applyToHolding(h, a, '2026-10-12'); assert.strictEqual(h.price, 2.5); assert.strictEqual(h.currency, 'GBP');
  console.log('ok   cours : récupéré, converti (pence) et enregistré');
})();
(() => {
  const d = (a) => a.map((x) => ({ exDate: x[0], amount: x[1] }));
  const sl = M.buildSlots(d([['2024-03-22', 6.4], ['2024-08-15', 3.5], ['2025-03-28', 7.9], ['2025-08-15', 3.75], ['2026-03-27', 7.95], ['2026-08-14', 3.75]]), '2026-10-14');
  assert.deepStrictEqual(sl, [{ month: 3, amount: 7.95 }, { month: 8, amount: 3.75 }]);
  assert.strictEqual(M.buildSlots(d([['2025-03-10', 1], ['2025-09-10', 1], ['2026-03-10', 1], ['2026-09-10', 1], ['2026-12-01', 5]]), '2026-12-20'), null, 'dividende exceptionnel isolé jamais reconduit');
  assert.strictEqual(M.buildSlots(d([['2025-02-10', 1], ['2025-05-10', 1], ['2025-08-10', 1], ['2025-11-10', 1.02], ['2026-02-10', 1.02], ['2026-05-10', 1.02], ['2026-08-10', 1.02], ['2026-11-10', 1.04]]), '2026-11-20'), null, 'montants quasi égaux : modèle simple');
  assert.strictEqual(M.buildSlots(d([['2025-05-10', 3], ['2026-05-10', 3.2]]), '2026-10-14'), null, 'un seul versement par an : modèle simple');
  const h = { id: '1', ticker: 'NOVO-B.CO', type: 'stock', dividend: {} };
  M.applyToHolding(h, { symbol: 'NOVO-B.CO', resolved: false, currency: 'DKK', dividends: d([['2024-03-22', 6.4], ['2024-08-15', 3.5], ['2025-03-28', 7.9], ['2025-08-15', 3.75], ['2026-03-27', 7.95], ['2026-08-14', 3.75]]) }, '2026-10-14');
  assert.deepStrictEqual(h.dividend.slots, [{ month: 4, amount: 7.95 }, { month: 8, amount: 3.75 }]); // créneaux exprimés en mois de PAIEMENT (détachement fin mars → versement début avril)
  console.log('ok   créneaux de versement (acompte + solde) : détection sûre');
})();
(async () => {
  const ts = (d) => Math.floor(Date.parse(d) / 1000);
  const res = { timestamp: [ts('2026-07-01'), ts('2026-08-01'), ts('2026-10-01'), ts('2026-10-14')], indicators: { quote: [{ close: [100, 110, 120, 125] }] } };
  const s = M.monthlySeries(res, false);
  assert.deepStrictEqual(s, { from: '2026-07', c: [100, 110, null, 125] }, 'mois manquant = null, dernière valeur du mois retenue');
  assert.strictEqual(M.monthlySeries(res, true).c[0], 1);
  assert.strictEqual(M.deriveCountry('AI.PA', 'FR0000120073'), 'France'); assert.strictEqual(M.deriveCountry('AAPL', ''), 'États-Unis'); assert.strictEqual(M.deriveCountry('NOVO-B.CO', ''), 'Danemark');
  assert.strictEqual(M.deriveCountry('CCO.TO', 'CA13321L1085'), 'Canada'); assert.strictEqual(M.deriveCountry('IWDA.AS', 'IE00B4L5Y983', true), 'ETF multi-pays');
  const c = M.makeClient({ getRelay: () => 'https://r.dev', fetch: async (u) => ({ status: 200, ok: true, json: async () => u.includes('/search') ? { quotes: [{ symbol: 'NOVO-B.CO', sector: 'Healthcare', industry: 'Drug Manufacturers—General' }] } : { chart: { result: [{ meta: { currency: 'DKK', longName: 'Novo', regularMarketPrice: 300 }, timestamp: res.timestamp, indicators: res.indicators, events: {} }] } } }) });
  const a = await c.fetchAsset('NOVO-B.CO', '', { needSector: true }); assert.strictEqual(a.sector, 'Healthcare'); assert.strictEqual(a.hist.c.length, 4);
  const h = { id: '1', ticker: 'NOVO-B.CO', type: 'stock', dividend: {} }; M.applyToHolding(h, a, '2026-10-14');
  assert.deepStrictEqual([h.sector, h.country, h.hist.from], ['Healthcare', 'Danemark', '2026-07']);
  const h2 = { id: '2', ticker: 'NOVO-B.CO', type: 'stock', geoLocked: true, sector: 'Ma saisie', country: 'Mon pays', dividend: {} }; M.applyToHolding(h2, a, '2026-10-14'); assert.deepStrictEqual([h2.sector, h2.country], ['Ma saisie', 'Mon pays']);
  console.log('ok   historique de cours mensuel, secteur et pays (dérivé ou saisi)');
})();
(async () => {
  const now = Math.floor(Date.now() / 1000), j = { news: [{ title: ' A ', publisher: 'P', link: 'https://x.dev/a', providerPublishTime: now, relatedTickers: ['AAPL'] }, { title: 'B', link: 'https://x.dev/b', providerPublishTime: now, relatedTickers: ['AAPL', 'A', 'B', 'C'] }, { title: 'C', link: 'http://x.dev/c', providerPublishTime: now, relatedTickers: ['AAPL'] }, { title: 'D', link: 'https://x.dev/d', providerPublishTime: now, relatedTickers: ['MSFT'] }, { title: 'E', link: 'https://x.dev/e', relatedTickers: ['AAPL'] }] };
  const r = M.parseNews(j, 'aapl'); assert.deepStrictEqual(r.items.map((x) => x.title), ['A'], 'seul l\'article ciblant ce titre, https, daté'); assert.strictEqual(M.parseNews({}, 'X').unrecognized, true);
  console.log('ok   actualités : seuls les articles qui citent le titre (pas de panorama), liens https, date obligatoire');
})();
(async () => {
  const mk = (tr) => M.makeClient({ getRelay: () => 'https://r.dev', fetch: async () => ({ status: 200, ok: true, json: async () => ({ translations: tr }) }) });
  assert.deepStrictEqual(await mk(['Bonjour', null, 'Same']).translate(['Hello', 'World', 'Same']), ['Bonjour', null, null], 'null ou identique = non traduit');
  assert.deepStrictEqual(await mk([]).translate([]), []);
  console.log('ok   traduction des titres : non traduit = original conservé');
})();
(async () => {
  const c = M.makeClient({ getRelay: () => 'https://r.dev', fetch: async (u) => { const q = new URL(u).searchParams.get('q'); if (q === 'KO') return { ok: false, status: 429, json: async () => ({}) }; if (q === 'Quota') return { ok: true, json: async () => ({ responseData: { translatedText: 'MYMEMORY WARNING: YOU USED ALL AVAILABLE FREE TRANSLATIONS' } }) }; return { ok: true, json: async () => ({ responseData: { translatedText: q === 'Same' ? 'Same' : 'L&#39;action de ' + q } }) }; } });
  assert.deepStrictEqual(await c.translateDirect(['Apple', 'KO', 'Quota', 'Same']), ["L'action de Apple", null, null, null], 'échec, quota ou texte identique = non traduit');
  console.log('ok   traduction de secours (navigateur) : quota et erreurs = original conservé');
})();
(async () => {
  const ts = (d) => Math.floor(Date.parse(d) / 1000);
  const c = M.makeClient({ getRelay: () => 'https://r.dev', fetch: async (u) => ({ status: 200, ok: true, json: async () => (u.includes('/search') ? { quotes: [{ symbol: 'ULVR.L', quoteType: 'EQUITY' }] } : { chart: { result: [{ meta: { currency: 'GBp' }, events: { dividends: { 1: { amount: 120, date: ts('2026-05-01') }, 0: { amount: 100, date: ts('2025-11-01') }, 2: { amount: 0, date: ts('2026-08-01') } } } }] } }) }) });
  const r = await c.fetchDividends('ULVR.L'); assert.deepStrictEqual(r.items, [['2025-11-01', 1], ['2026-05-01', 1.2]], 'pence → livres, triés, montants nuls écartés'); assert.strictEqual(r.currency, 'GBP');
  console.log('ok   historique complet des dividendes : pence convertis, triés, montants nuls écartés');
})();

(async () => {
  M.setDelay(0);
  // fusion de l'historique : les mois récents remplacent, les anciens sont conservés, le quotidien vient du nouveau
  const mg = M.mergeHist({ from: '2020-01', c: [1, 2, null, 4, 5], d: { t: [20200501], c: [5] } }, { from: '2020-04', c: [40, 50, 60], d: { t: [20200601], c: [6] } });
  assert.deepStrictEqual(mg, { from: '2020-01', c: [1, 2, null, 40, 50, 60], d: { t: [20200501, 20200601], c: [5, 6] } });      // quotidien : union par date
  assert.deepStrictEqual(M.mergeHist({ from: '2020-01', c: [1, 2], d: { t: [1], c: [1] } }, { from: '2020-02', c: [9] }).d, { t: [1], c: [1] }, 'ancien relais : quotidien conservé');
  assert.strictEqual(M.splitsChanged({ splits: [{ date: '2019-01-01', ratio: 2 }] }, { hist: { from: '2021-01' }, splits: [] }), false, 'split antérieur à la fenêtre ignoré');
  assert.strictEqual(M.splitsChanged({ splits: [] }, { hist: { from: '2021-01' }, splits: [{ date: '2025-05-05', ratio: 4 }] }), true, 'nouveau split détecté');
  // actualisation légère : une requête de 5 ans par actif, historique fusionné, pas de recherche de secteur ; actif neuf / ancien = complète
  const calls = [];
  const client = { fetchAsset: async (t, n, o) => { calls.push([t, o.range || '10y', !!o.needSector]); return { symbol: t, resolved: false, name: t, currency: 'EUR', price: 11, priceAt: '2026-11-11T10:00:00Z', hist: { from: '2026-09', c: [10, 11] }, splits: [], sector: null, dividends: [{ exDate: '2026-10-01', amount: 1 }], prevClose: 10.5, prevCloseAt: '2026-11-10' }; } };
  const now = Date.now(), H = (o) => Object.assign({ id: 'x', ticker: 'T', name: 'T', dividend: { history: [{ exDate: '2026-10-01', payDate: null, amount: 1 }] }, hist: { from: '2026-07', c: [8, 9, 10, 11] }, fullAt: now - 86400000, splits: [] }, o);
  const a = H({ ticker: 'A' }), b = H({ ticker: 'B', hist: null }), c = H({ ticker: 'C', fullAt: now - 20 * 86400000 }), d = H({ ticker: 'D', quickAt: now - 60000 }), e = H({ ticker: 'E', dividend: { history: [] } });
  const r = await M.refreshMany(client, [a, b, c, d, e], '2026-11-11', { quick: true });
  const key = (l) => l.map((x) => x.join('/')).sort();
  assert.deepStrictEqual(key(calls), key([['A', '6mo', false], ['B', '10y', true], ['C', '10y', true], ['E', '6mo', false], ['E', '10y', true]]), 'A : une requête légère (6 mois) ; B sans historique et C complète il y a 20 j : complètes ; D à jour : rien ; E nouveau dividende : légère puis complète pour cet actif seulement');
  assert.deepStrictEqual([r.ok, r.skipped, r.fail, r.newDiv], [4, 1, 0, 1]); assert.deepStrictEqual(a.hist.c, [8, 9, 10, 11], 'historique ancien conservé, mois récents mis à jour'); assert.strictEqual(a.price, 11); assert.ok(a.quickAt >= now);
  console.log('ok   actualisation légère : une requête de 6 mois par actif, historique fusionné, revue complète seulement si nécessaire (nouveau dividende, split, 14 jours)');
})();
(async () => {
  M.setDelay(0);
  const mkClient = (chart) => M.makeClient({ getRelay: () => 'https://r.dev', fetch: async (u) => ({ status: 200, ok: true, json: async () => (u.includes('/search') ? { quotes: [] } : chart) }) });
  await assert.rejects(() => mkClient({ chart: { result: null, error: { description: 'No data found, symbol may be delisted' } } }).fetchAsset('CARM.PA', 'Carmat'), (e) => e.delisted === true);
  await assert.rejects(() => mkClient({}).fetchAsset('FR0012616852', 'Carmat'), (e) => e.notFound === true, 'ISIN absent de Yahoo');
  const bad = { id: 'b', ticker: 'X', dividend: {} }, gone = { id: 'g', ticker: 'G', listing: 'delisted', dividend: {} };
  let n = 0; const r = await M.refreshMany({ fetchAsset: async (t) => { n++; throw Object.assign(new Error('Yahoo : plus de données'), { delisted: true }); } }, [bad, gone], '2026-11-11', { quick: true });
  assert.deepStrictEqual([n, r.fail, r.skipped], [1, 1, 1], 'société déclarée plus cotée : aucune requête'); assert.strictEqual(bad.listingSuspect.kind, 'delisted');
  const st = { dividend: {} }; M.noteListing(st, { priceAt: '2026-01-05T10:00:00Z' }, '2026-11-11'); assert.strictEqual(st.listingSuspect.kind, 'stale', 'dernière cotation > 45 jours');
  M.noteListing(st, { priceAt: '2026-11-10T10:00:00Z' }, '2026-11-11'); assert.ok(!st.listingSuspect, 'cotation récente : repère retiré');
  console.log('ok   société plus cotée : détection (Yahoo « delisted », ISIN absent, cotation ancienne), jamais décidée automatiquement, aucune requête une fois déclarée');
})();
(async () => {
  M.setDelay(0);
  // ISIN avec deux cotations : la première (ancien symbole) n'a pas de cours → la seconde est retenue ; sans aucune cotation valide, la réponse vide est renvoyée (anomalie signalée)
  const mk = (prices) => M.makeClient({ getRelay: () => 'https://r.dev', fetch: async (u) => ({ status: 200, ok: true, json: async () => {
    if (u.includes('/search')) return { quotes: [{ symbol: 'OLD.PA', quoteType: 'EQUITY' }, { symbol: 'NEW.PA', quoteType: 'EQUITY' }] };
    const sym = new URL(u).searchParams.get('symbol'); return { chart: { result: [{ meta: { currency: 'EUR', regularMarketPrice: prices[sym], regularMarketTime: 1762000000 }, timestamp: [], indicators: { quote: [{ close: [] }] } }] } };
  } }) });
  const a = await mk({ 'OLD.PA': undefined, 'NEW.PA': 2.1 }).fetchAsset('FR0014009YQ1', 'Lhyfe', { needSector: false });
  assert.deepStrictEqual([a.symbol, a.price, a.resolved], ['NEW.PA', 2.1, true], 'le symbole avec un cours est retenu');
  const b = await mk({}).fetchAsset('FR0014009YQ1', 'Lhyfe', { needSector: false }); assert.strictEqual(b.price, null, 'aucune cotation valide : réponse sans cours renvoyée');
  const sg = await mk({ 'OLD.PA': undefined, 'NEW.PA': 2.1 }).suggestSymbols('FR0014009YQ1', 'Lhyfe'); assert.deepStrictEqual(sg.map((x) => [x.symbol, x.price]), [['OLD.PA', null], ['NEW.PA', 2.1]]);
  const h = { id: 'h', ticker: 'OLD.PA', name: 'L', dividend: {} }, r = await M.refreshMany({ fetchAsset: async () => ({ symbol: 'OLD.PA', price: null, hist: null, dividends: [], resolved: false }) }, [h], '2026-11-11', {});
  assert.deepStrictEqual([r.fail, r.ok], [1, 0]); assert.ok(/aucun cours pour OLD\.PA/.test(h.marketError), 'cours vide = erreur explicite');
  console.log('ok   ISIN à plusieurs cotations : celle qui a un cours est retenue, suggestions pour l\'utilisateur, cours vide signalé');
})();
