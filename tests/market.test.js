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
