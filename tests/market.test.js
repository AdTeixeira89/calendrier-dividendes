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
 await t('applyToHolding: payer gets pattern from ex-date, manual fields untouched', ()=>{
   const h={id:'1',ticker:'FR0000120073',displayTicker:'FR0000120073',name:'AIR LIQUIDE',type:'stock',quantity:7,avgCost:100,dividend:{payDay:12,taxRate:30}};
   const a={symbol:'AI.PA',resolved:true,name:'L\'Air Liquide',currency:'EUR',instrumentType:'EQUITY',dividends:[{exDate:'2024-05-14',amount:3},{exDate:'2025-05-12',amount:3.2},{exDate:'2026-05-11',amount:3.4}]};
   M.applyToHolding(h,a,'2026-10-12');
   assert.strictEqual(h.ticker,'AI.PA'); assert.strictEqual(h.isin,'FR0000120073'); assert.strictEqual(h.name,'AIR LIQUIDE');
   assert.strictEqual(h.dividend.lastAmount,3.4); assert.strictEqual(h.dividend.anchorMonth,5); assert.strictEqual(h.dividend.frequency,'annual'); assert.strictEqual(h.dividend.dateKind,'ex');
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
  assert.deepStrictEqual(h.dividend.slots, [{ month: 3, amount: 7.95 }, { month: 8, amount: 3.75 }]);
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
