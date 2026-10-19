/* Relais Cloudflare Workers pour Calendrier Dividendes.
   Yahoo Finance n'autorise pas les appels directs depuis une page web (CORS) :
   ce relais les fait à la place du navigateur et ajoute l'en-tête manquant.
   Il n'expose que des routes en lecture seule (Yahoo ; Quiver en option) et n'accepte que votre site. */

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
  async fetch(request, env){
    const origin = request.headers.get('Origin') || '';
    if(!ALLOWED_ORIGINS.includes(origin)){
      return new Response('Origine non autorisée', { status: 403 });
    }
    if(request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(origin) });
    if(request.method !== 'GET') return reply({ error: 'Méthode non autorisée' }, 405, origin);

    const url = new URL(request.url);
    let target;

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
    }else if(url.pathname === '/quiver'){
      // Quiver Quantitative (optionnel) : transactions du Congrès américain. Le jeton API reste un SECRET du relais
      // (Cloudflare → Settings → Variables and Secrets → QUIVER_TOKEN) : il n'est jamais envoyé au navigateur.
      const token = env && env.QUIVER_TOKEN;
      if(!token) return reply({ error: 'quiver_not_configured' }, 501, origin);
      const ticker = (url.searchParams.get('ticker') || '').trim().toUpperCase();
      if(ticker && !/^[A-Z0-9.\-]{1,10}$/.test(ticker)) return reply({ error: 'Symbole invalide' }, 400, origin);
      const path = ticker ? `/beta/historical/congresstrading/${encodeURIComponent(ticker)}` : '/beta/live/congresstrading';
      const up = await fetch('https://api.quiverquant.com' + path, {
        headers: { 'Authorization': 'Bearer ' + token, 'Accept': 'application/json', 'User-Agent': UA },
        cf: { cacheTtl: 3600, cacheEverything: true },
      });
      const body = await up.text();
      return reply(body, up.status, origin, { 'Cache-Control': 'private, max-age=3600' });
    }else{
      return reply({ error: 'Route inconnue (utilisez /chart, /search ou /quiver)' }, 404, origin);
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
