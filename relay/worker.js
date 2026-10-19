/* Relais Cloudflare Workers pour Calendrier Dividendes.
   Yahoo Finance n'autorise pas les appels directs depuis une page web (CORS) :
   ce relais les fait à la place du navigateur et ajoute l'en-tête manquant.
   Il n'expose que deux routes en lecture seule et n'accepte que votre site. */

const ALLOWED_ORIGINS = [
  'https://adteixeira89.github.io',
];

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

function cors(origin){
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
  };
}

function reply(body, status, origin, extra){
  return new Response(typeof body === 'string' ? body : JSON.stringify(body), {
    status,
    headers: Object.assign({ 'Content-Type': 'application/json; charset=utf-8' }, cors(origin), extra || {}),
  });
}

export default {
  async fetch(request){
    const origin = request.headers.get('Origin') || '';
    if(!ALLOWED_ORIGINS.includes(origin)){
      return new Response('Origine non autorisée', { status: 403 });
    }
    if(request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(origin) });
    if(request.method !== 'GET') return reply({ error: 'Méthode non autorisée' }, 405, origin);

    const url = new URL(request.url);
    let target;

    if(url.pathname === '/translate'){
      // Traduction automatique en français des titres d'actualités (service public de traduction de Google, puis MyMemory en secours ; sans clé).
      // Jusqu'à 10 titres de 220 caractères au plus ; en cas d'échec, la traduction est null (l'application garde le titre d'origine).
      const titles = url.searchParams.getAll('t').slice(0, 10).map((x) => x.slice(0, 220));
      if(!titles.length) return reply({ error: 'Aucun titre' }, 400, origin);
      const dec = (x) => x.replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
      const viaGoogle = async (t) => {
        const r = await fetch('https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=fr&dt=t&q=' + encodeURIComponent(t), { headers: { 'User-Agent': UA }, cf: { cacheTtl: 86400, cacheEverything: true } });
        if(!r.ok) return null;
        const d = await r.json();
        return Array.isArray(d && d[0]) ? d[0].map((seg) => (seg && seg[0]) || '').join('').trim() : null;
      };
      const viaMyMemory = async (t) => {           // secours gratuit sans clé (quota quotidien limité)
        const r = await fetch('https://api.mymemory.translated.net/get?langpair=en%7Cfr&q=' + encodeURIComponent(t), { headers: { 'User-Agent': UA }, cf: { cacheTtl: 86400, cacheEverything: true } });
        if(!r.ok) return null;
        const d = await r.json();
        const fr = d && d.responseData && typeof d.responseData.translatedText === 'string' ? dec(d.responseData.translatedText).trim() : '';
        return fr && !/MYMEMORY WARNING|QUERY LENGTH LIMIT/i.test(fr) ? fr : null;
      };
      const out = await Promise.all(titles.map(async (t) => {
        for(const f of [viaGoogle, viaMyMemory]){
          try{ const fr = await f(t); if(fr) return fr; }catch(e){ /* service suivant */ }
        }
        return null;
      }));
      return reply({ translations: out }, 200, origin, { 'Cache-Control': 'public, max-age=86400' });
    }

    if(url.pathname === '/chart'){
      // Cours, dividendes (date ex-dividende + montant), fractionnements, nom et devise.
      const symbol = (url.searchParams.get('symbol') || '').trim();
      if(!/^[A-Za-z0-9.\-^=]{1,20}$/.test(symbol)) return reply({ error: 'Symbole invalide' }, 400, origin);
      // Période et pas facultatifs (liste blanche) : l'application demande 10 ans en quotidien ; une ancienne version
      // du relais ignore ces paramètres et renvoie 5 ans en mensuel (l'application sait s'en contenter).
      const range = ['5y', '10y', 'max'].includes(url.searchParams.get('range')) ? url.searchParams.get('range') : '5y';
      const interval = ['1mo', '1wk', '1d'].includes(url.searchParams.get('interval')) ? url.searchParams.get('interval') : '1mo';
      target = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=${range}&interval=${interval}&events=div,splits`;
    }else if(url.pathname === '/search'){
      // Recherche d'un titre par ISIN ou par nom → symbole Yahoo.
      const q = (url.searchParams.get('q') || '').trim();
      if(!q || q.length > 80) return reply({ error: 'Requête invalide' }, 400, origin);
      target = `https://query2.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(q)}&quotesCount=8&newsCount=0&listsCount=0`;
    }else if(url.pathname === '/news'){
      // Actualités Yahoo Finance d'un titre (gratuit, sans clé).
      const symbol = (url.searchParams.get('symbol') || '').trim();
      if(!/^[A-Za-z0-9.\-^=]{1,20}$/.test(symbol)) return reply({ error: 'Symbole invalide' }, 400, origin);
      target = `https://query2.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(symbol)}&quotesCount=0&newsCount=10&listsCount=0`;
    }else{
      return reply({ error: 'Route inconnue (utilisez /chart, /search, /news ou /translate)' }, 404, origin);
    }

    // Cache de 6 h côté Cloudflare : ménage Yahoo et accélère les relances.
    const upstream = await fetch(target, {
      headers: { 'User-Agent': UA, 'Accept': 'application/json' },
      cf: { cacheTtl: 21600, cacheEverything: true },
    });
    const text = await upstream.text();
    return reply(text, upstream.status, origin, { 'Cache-Control': 'public, max-age=21600' });
  },
};
