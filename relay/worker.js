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

    if(url.pathname === '/chart'){
      // Historique des dividendes (date ex-dividende + montant), nom et devise.
      const symbol = (url.searchParams.get('symbol') || '').trim();
      if(!/^[A-Za-z0-9.\-^=]{1,20}$/.test(symbol)) return reply({ error: 'Symbole invalide' }, 400, origin);
      target = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=5y&interval=1mo&events=div`;
    }else if(url.pathname === '/search'){
      // Recherche d'un titre par ISIN ou par nom → symbole Yahoo.
      const q = (url.searchParams.get('q') || '').trim();
      if(!q || q.length > 80) return reply({ error: 'Requête invalide' }, 400, origin);
      target = `https://query2.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(q)}&quotesCount=8&newsCount=0&listsCount=0`;
    }else{
      return reply({ error: 'Route inconnue (utilisez /chart ou /search)' }, 404, origin);
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
