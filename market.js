/* ==================================================================
   market.js — données de marché via le relais Yahoo Finance (Cloudflare).
   Remplace entièrement l'ancienne API Financial Modeling Prep.
   Fournit : symbole (depuis un ISIN ou un nom), nom, devise, type (action / ETF),
   historique des dividendes (date de détachement + montant par titre).
   Ne fournit PAS : date de mise en paiement, retenue fiscale, prix de revient.
   Rien n'est inventé : sans donnée, l'actif reste « données manquantes ».
   ================================================================== */
(function (root) {
  const ISIN_RE = /^[A-Z]{2}[A-Z0-9]{9}[0-9]$/;
  const isISIN = (s) => ISIN_RE.test(String(s || '').trim().toUpperCase());

  const COUNTRY_SUFFIX = { FR: ['.PA'], NL: ['.AS'], DE: ['.DE', '.F'], GB: ['.L'], IT: ['.MI'], ES: ['.MC'], BE: ['.BR'], PT: ['.LS'], CH: ['.SW'],
    SE: ['.ST'], DK: ['.CO'], FI: ['.HE'], NO: ['.OL'], IE: ['.IR', '.L'], AT: ['.VI'], US: [''], CA: ['.TO'] };

  /* Choisit la cotation cohérente avec le pays de l'ISIN (devise, place). */
  function pickSymbol(quotes, isin) {
    const rows = (quotes || []).filter((q) => q && q.symbol && (!q.quoteType || ['EQUITY', 'ETF'].indexOf(q.quoteType) >= 0));
    if (!rows.length) return null;
    const want = COUNTRY_SUFFIX[String(isin || '').slice(0, 2).toUpperCase()];
    if (want) {
      for (let i = 0; i < want.length; i++) {
        const suf = want[i];
        const hit = rows.find((q) => (suf === '' ? q.symbol.indexOf('.') < 0 : q.symbol.toUpperCase().endsWith(suf)));
        if (hit) return hit.symbol;
      }
    }
    return rows[0].symbol;
  }

  /* Toutes les cotations plausibles d'un ISIN, la plus cohérente avec le pays de l'ISIN en premier (pour essayer les suivantes si la première n'a pas de cours). */
  function rankSymbols(quotes, isin) {
    const rows = (quotes || []).filter((q) => q && q.symbol && (!q.quoteType || ['EQUITY', 'ETF'].indexOf(q.quoteType) >= 0)), out = [];
    const want = COUNTRY_SUFFIX[String(isin || '').slice(0, 2).toUpperCase()] || [];
    want.forEach((suf) => rows.forEach((q) => { if ((suf === '' ? q.symbol.indexOf('.') < 0 : q.symbol.toUpperCase().endsWith(suf)) && out.indexOf(q.symbol) < 0) out.push(q.symbol); }));
    rows.forEach((q) => { if (out.indexOf(q.symbol) < 0) out.push(q.symbol); });
    return out;
  }
  const COUNTRY_NAME = { US: 'États-Unis', FR: 'France', DE: 'Allemagne', NL: 'Pays-Bas', GB: 'Royaume-Uni', CH: 'Suisse', IT: 'Italie', ES: 'Espagne', BE: 'Belgique', PT: 'Portugal',
    SE: 'Suède', DK: 'Danemark', FI: 'Finlande', NO: 'Norvège', IE: 'Irlande', AT: 'Autriche', LU: 'Luxembourg', CA: 'Canada', JP: 'Japon', AU: 'Australie', CN: 'Chine', HK: 'Hong Kong',
    KY: 'Îles Caïmans', BM: 'Bermudes', JE: 'Jersey', GG: 'Guernesey', SG: 'Singapour', KR: 'Corée du Sud', TW: 'Taïwan', IN: 'Inde', BR: 'Brésil', MX: 'Mexique', PL: 'Pologne', GR: 'Grèce' };
  const SUFFIX_COUNTRY = { PA: 'FR', AS: 'NL', DE: 'DE', F: 'DE', L: 'GB', MI: 'IT', MC: 'ES', BR: 'BE', LS: 'PT', SW: 'CH', ST: 'SE', CO: 'DK', HE: 'FI', OL: 'NO', VI: 'AT', IR: 'IE', TO: 'CA', V: 'CA', T: 'JP', AX: 'AU', HK: 'HK' };
  /* Pays d'une action : pays de l'ISIN (domiciliation de l'émetteur), à défaut place de cotation.
     Un ETF n'a pas de pays unique (« ETF multi-pays ») ; modifiable à la main sur la fiche de l'actif. */
  function deriveCountry(ticker, isin, isEtf) {
    if (isEtf) return 'ETF multi-pays';
    const i = String(isin || (isISIN(ticker) ? ticker : '') || '').toUpperCase();
    if (i.length >= 2 && COUNTRY_NAME[i.slice(0, 2)]) return COUNTRY_NAME[i.slice(0, 2)];
    const m = String(ticker || '').toUpperCase().match(/\.([A-Z]{1,2})$/);
    if (m && SUFFIX_COUNTRY[m[1]]) return COUNTRY_NAME[SUFFIX_COUNTRY[m[1]]];
    if (ticker && !String(ticker).includes('.') && !isISIN(ticker)) return 'États-Unis';
    return null;
  }

  /* Série mensuelle des cours de clôture (devise de cotation) : { from: 'AAAA-MM', c: [cours…] }, null si mois manquant. */
  function monthlySeries(res, pence) {
    const ts = res.timestamp || [], cl = ((res.indicators || {}).quote || [{}])[0].close || [];
    const by = {};
    for (let i = 0; i < ts.length; i++) {
      const v = cl[i]; if (!(v > 0)) continue;
      const d = new Date(ts[i] * 1000); const ym = d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0');
      by[ym] = Math.round((pence ? v / 100 : v) * 10000) / 10000;     // la dernière valeur du mois l'emporte
    }
    const keys = Object.keys(by).sort(); if (!keys.length) return null;
    const out = [], y0 = Number(keys[0].slice(0, 4)), m0 = Number(keys[0].slice(5)), y1 = Number(keys[keys.length - 1].slice(0, 4)), m1 = Number(keys[keys.length - 1].slice(5));
    for (let y = y0, m = m0; y < y1 || (y === y1 && m <= m1); m++) { if (m > 12) { m = 1; y++; } const k = y + '-' + String(m).padStart(2, '0'); out.push(by[k] === undefined ? null : by[k]); if (y === y1 && m === m1) break; }
    return { from: keys[0], c: out };
  }

  /* Cours quotidiens récents { t: [aaaammjj…], c: [cours…] } (≈ 6 mois de séance) si la source est quotidienne, sinon null. */
  function dailySeries(res, pence, keep) {
    const ts = res.timestamp || [], cl = ((res.indicators || {}).quote || [{}])[0].close || [];
    const t = [], c = [];
    for (let i = 0; i < ts.length; i++) {
      const v = cl[i]; if (!(v > 0)) continue;
      const d = new Date(ts[i] * 1000);
      t.push(d.getUTCFullYear() * 10000 + (d.getUTCMonth() + 1) * 100 + d.getUTCDate());
      c.push(Math.round((pence ? v / 100 : v) * 10000) / 10000);
    }
    if (t.length < 40) return null;
    const dayNum = (x) => Date.UTC(Math.floor(x / 10000), Math.floor(x / 100) % 100 - 1, x % 100) / 86400000;
    const tail = t.slice(-30), gaps = []; for (let i = 1; i < tail.length; i++) gaps.push(dayNum(tail[i]) - dayNum(tail[i - 1]));
    gaps.sort((a, b) => a - b); if (gaps[Math.floor(gaps.length / 2)] > 5) return null;          // données mensuelles ou hebdomadaires : pas de série quotidienne
    const k = keep || 140; return { t: t.slice(-k), c: c.slice(-k) };
  }
  /* Fractionnements d'actions [{ date, ratio }] (10 pour 1 → ratio 10), pour ramener les anciennes quantités à la base actuelle. */
  function splitList(res) {
    const ev = (res.events && res.events.splits) || {};
    return Object.keys(ev).map((k) => ev[k]).filter((s) => s && s.date && s.numerator > 0 && s.denominator > 0)
      .map((s) => ({ date: new Date(s.date * 1000).toISOString().slice(0, 10), ratio: Math.round(s.numerator / s.denominator * 1e6) / 1e6 })).filter((s) => s.ratio !== 1).sort((a, b) => (a.date < b.date ? -1 : 1));
  }

  /* Clôture de la séance précédente (variation journalière) : dernier cours QUOTIDIEN antérieur au jour du dernier cours ; null si la source n'est pas quotidienne. */
  function prevCloseOf(res, meta, pence) {
    const ts = res.timestamp || [], cl = ((res.indicators || {}).quote || [{}])[0].close || [];
    if (!meta || !meta.regularMarketTime || ts.length < 5) return { prevClose: null, prevCloseAt: null };
    const day = (t) => new Date(t * 1000).toISOString().slice(0, 10), today = day(meta.regularMarketTime);
    const gaps = []; for (let i = Math.max(1, ts.length - 20); i < ts.length; i++) gaps.push((ts[i] - ts[i - 1]) / 86400); gaps.sort((a, b) => a - b);
    if (gaps[Math.floor(gaps.length / 2)] > 5) return { prevClose: null, prevCloseAt: null };               // mensuel / hebdomadaire : pas de clôture précédente fiable
    for (let i = ts.length - 1; i >= 0; i--) if (day(ts[i]) < today && cl[i] > 0) return { prevClose: Math.round((pence ? cl[i] / 100 : cl[i]) * 10000) / 10000, prevCloseAt: day(ts[i]) };
    return { prevClose: null, prevCloseAt: null };
  }
  const withDaily = (mo, d) => { if (mo && d) mo.d = d; return mo; };

  function detectFrequency(isoDates) {
    if (isoDates.length < 2) return 'irregular';
    const ms = (s) => { const a = s.split('-').map(Number); return Date.UTC(a[0], a[1] - 1, a[2]); };
    const gaps = [];
    for (let i = 1; i < isoDates.length; i++) gaps.push((ms(isoDates[i]) - ms(isoDates[i - 1])) / 86400000);
    gaps.sort((a, b) => a - b);
    const med = gaps[Math.floor(gaps.length / 2)];            // médiane : résiste aux dividendes exceptionnels
    if (med < 45) return 'monthly';
    if (med < 135) return 'quarterly';
    if (med < 270) return 'semiannual';
    return 'annual';
  }

  /* Actualités Yahoo d'un titre → liste normalisée. N'est retenu que ce qui concerne vraiment ce titre : il doit figurer parmi les titres liés de l'article,
     et l'article ne doit pas être un panorama de marché (plus de 3 titres liés). Lien https uniquement. */
  function parseNews(json, symbol) {
    const arr = json && Array.isArray(json.news) ? json.news : null;
    if (!arr) return { items: [], unrecognized: true };
    const sym = String(symbol || '').toUpperCase(), items = [];
    arr.forEach((n) => {
      if (!n || typeof n.title !== 'string' || typeof n.link !== 'string' || !/^https:\/\//i.test(n.link) || !(n.providerPublishTime > 0)) return;
      const rel = Array.isArray(n.relatedTickers) ? n.relatedTickers.map((x) => String(x).toUpperCase()) : [];
      if (!rel.includes(sym) || rel.length > 3) return;
      items.push({ symbol: sym, title: n.title.trim(), publisher: String(n.publisher || '').trim(), link: n.link, at: new Date(n.providerPublishTime * 1000).toISOString() });
    });
    return { items, unrecognized: false };
  }

  function makeClient(opts) {
    const getRelay = opts.getRelay;
    const fetchFn = opts.fetch || function () { return globalThis.fetch.apply(globalThis, arguments); };

    async function call(path) {
      const relay = (getRelay() || '').replace(/\/+$/, '');
      if (!relay) throw new Error("Aucune adresse de relais de données (Paramètres → Données de marché).");
      let r;
      try { r = await fetchFn(relay + path); }
      catch (e) { throw new Error('Relais de données injoignable (hors-ligne ou adresse incorrecte).'); }
      if (r.status === 403) throw Object.assign(new Error("Relais refusé (403) : l'adresse de ce site n'est pas autorisée dans le relais."), { fatal: true });
      if (r.status === 429) throw Object.assign(new Error('Yahoo limite temporairement les requêtes (429) — réessayez dans quelques minutes.'), { rate: true });
      const data = await r.json().catch(() => null);
      if (!r.ok || !data) throw new Error('Réponse de données invalide (code ' + r.status + ').');
      return data;
    }

    async function search(q) {
      const data = await call('/search?q=' + encodeURIComponent(q));
      return (data.quotes || []).filter((x) => x && x.symbol);
    }

    async function candidates(input, nameHint) {
      const t = String(input || '').trim();
      if (!isISIN(t)) return [t];
      const queries = [t.toUpperCase()];
      if (nameHint && String(nameHint).trim()) queries.push(String(nameHint).trim().slice(0, 60));
      for (let i = 0; i < queries.length; i++) {
        const quotes = await search(queries[i]).catch((e) => { if (e.rate || e.fatal) throw e; return []; });
        const syms = rankSymbols(quotes, t);
        if (syms.length) return syms.slice(0, 4);
      }
      throw Object.assign(new Error('ISIN introuvable chez Yahoo Finance : la société n\'est peut-être plus cotée (radiation, liquidation, rachat), ou renseignez le symbole boursier (ex : AI.PA).'), { notFound: true });
    }

    /* Données d'un actif. Renvoie toujours un objet explicite, jamais de valeurs inventées. */
    async function fetchChart(symbol, input, opts) {
      const data = await call('/chart?symbol=' + encodeURIComponent(symbol) + '&range=' + (opts.range === '6mo' || opts.range === '5y' ? opts.range : '10y') + '&interval=1d');
      const res = data.chart && data.chart.result && data.chart.result[0];
      if (!res) {
        const desc = data.chart && data.chart.error && data.chart.error.description;
        if (desc && /delisted|no data found|not found/i.test(desc)) throw Object.assign(new Error('Yahoo Finance : plus aucune donnée pour ce symbole (probablement retiré de la cote : radiation, liquidation, rachat).'), { delisted: true });
        throw new Error(desc ? 'Yahoo : ' + desc : 'Symbole inconnu.');
      }
      const meta = res.meta || {};
      const pence = meta.currency === 'GBp' || meta.currency === 'GBX';
      const currency = pence ? 'GBP' : (meta.currency || null);
      const divs = Object.keys((res.events && res.events.dividends) || {}).map((k) => res.events.dividends[k])
        .filter((d) => d && d.amount > 0 && d.date)
        .map((d) => ({ exDate: new Date(d.date * 1000).toISOString().slice(0, 10), payDate: null, amount: pence ? d.amount / 100 : d.amount }))
        .sort((a, b) => (a.exDate < b.exDate ? -1 : 1));
      return {
        symbol, resolved: symbol.toUpperCase() !== String(input).trim().toUpperCase(),
        name: meta.longName || meta.shortName || null, currency, exchange: meta.fullExchangeName || meta.exchangeName || null,
        instrumentType: meta.instrumentType || null,        // EQUITY | ETF | …
        price: meta.regularMarketPrice > 0 ? (pence ? meta.regularMarketPrice / 100 : meta.regularMarketPrice) : null,
        priceAt: meta.regularMarketTime ? new Date(meta.regularMarketTime * 1000).toISOString() : null,
        hist: withDaily(monthlySeries(res, pence), dailySeries(res, pence)), splits: splitList(res), sector: null, industry: null, ...prevCloseOf(res, meta, pence),
        dividends: divs
      };
    }

    /* Données d'un actif. Pour un ISIN, plusieurs cotations peuvent exister (ancien et nouveau symbole, autre place) : on essaie la plus cohérente, puis les suivantes
       tant qu'aucune ne donne un cours ; sinon on renvoie la première réponse (cours vide) pour que l'anomalie soit signalée. */
    async function fetchAsset(input, nameHint, opts) {
      opts = opts || {};
      const cands = await candidates(input, nameHint); let first = null, firstErr = null, best = null;
      for (let i = 0; i < cands.length; i++) {
        try { const r = await fetchChart(cands[i], input, opts); if (r.price > 0) { best = r; break; } if (!first) first = r; }
        catch (e) { if (e.rate || e.fatal) throw e; if (!firstErr) firstErr = e; }
      }
      best = best || first; if (!best) throw firstErr || new Error('Symbole inconnu.');
      if (opts.needSector !== false) {      // un appel de plus, une seule fois par actif (le secteur ne change presque jamais)
        try {
          const q = (await search(best.symbol)).find((x) => x.symbol && x.symbol.toUpperCase() === best.symbol.toUpperCase());
          if (q) { best.sector = q.sector || null; best.industry = q.industry || null; }
        } catch (e) { if (e.rate || e.fatal) throw e; }
      }
      return best;
    }
    /* Symboles possibles pour un ISIN, avec le dernier cours de chacun (à la demande de l'utilisateur, jamais appliqués automatiquement). */
    async function suggestSymbols(isin, nameHint) {
      const out = []; let cands = [];
      try { cands = await candidates(isin, nameHint); } catch (e) { if (e.rate || e.fatal) throw e; return out; }
      for (let i = 0; i < cands.length; i++) {
        try { const r = await fetchChart(cands[i], isin, { range: '6mo' }); out.push({ symbol: cands[i], name: r.name, exchange: r.exchange, currency: r.currency, price: r.price, priceAt: r.priceAt }); }
        catch (e) { if (e.rate || e.fatal) throw e; out.push({ symbol: cands[i], name: null, exchange: null, currency: null, price: null, priceAt: null, error: e.message }); }
      }
      return out;
    }

    /* Fractionnements d'un actif (Yahoo) : [{ date, ratio }]. Un ancien relais ne les renvoie pas (liste vide). */
    async function fetchSplits(input, nameHint) {
      const symbol = (await candidates(input, nameHint))[0];
      const data = await call('/chart?symbol=' + encodeURIComponent(symbol) + '&range=max&interval=1mo');
      const res = data.chart && data.chart.result && data.chart.result[0];
      if (!res) throw new Error('Symbole inconnu.');
      return { symbol, splits: splitList(res) };
    }

    /* Historique complet des dividendes en espèces d'un titre (Yahoo : date de détachement + montant par titre, devise de cotation). La date de PAIEMENT n'est pas fournie. */
    async function fetchDividends(input, nameHint) {
      const symbol = (await candidates(input, nameHint))[0];
      const data = await call('/chart?symbol=' + encodeURIComponent(symbol) + '&range=max&interval=1mo');
      const res = data.chart && data.chart.result && data.chart.result[0];
      if (!res) throw new Error('Symbole inconnu.');
      const meta = res.meta || {}, pence = meta.currency === 'GBp' || meta.currency === 'GBX';
      const items = Object.keys((res.events && res.events.dividends) || {}).map((k) => res.events.dividends[k]).filter((d) => d && d.amount > 0 && d.date)
        .map((d) => [new Date(d.date * 1000).toISOString().slice(0, 10), Math.round((pence ? d.amount / 100 : d.amount) * 1e6) / 1e6]).sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
      return { symbol, currency: pence ? 'GBP' : (meta.currency || null), items };
    }

    async function fetchNews(symbol) {
      const data = await call('/news?symbol=' + encodeURIComponent(symbol));
      return parseNews(data, symbol);
    }

    /* Titres traduits en français (null = non traduit : on garde alors l'original). */
    async function translate(titles) {
      if (!titles.length) return [];
      const data = await call('/translate?' + titles.map((t) => 't=' + encodeURIComponent(t)).join('&'));
      const tr = data && Array.isArray(data.translations) ? data.translations : [];
      return titles.map((t, i) => (typeof tr[i] === 'string' && tr[i].trim() && tr[i].trim() !== t ? tr[i].trim() : null));
    }

    /* Secours : traduction directement depuis le navigateur par MyMemory (gratuit, sans clé, accessible en CORS) quand le relais ne traduit pas. Un titre à la fois ; null = non traduit. */
    async function translateDirect(titles) {
      return Promise.all(titles.map(async (t) => {
        try {
          const r = await fetchFn('https://api.mymemory.translated.net/get?langpair=en%7Cfr&q=' + encodeURIComponent(t.slice(0, 220)));
          if (!r.ok) return null;
          const d = await r.json(), x = d && d.responseData && typeof d.responseData.translatedText === 'string' ? d.responseData.translatedText : '';
          const fr = x.replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&').trim();
          return fr && fr !== t && !/MYMEMORY WARNING|QUERY LENGTH LIMIT|INVALID/i.test(fr) ? fr : null;
        } catch (e) { return null; }
      }));
    }

    return { call, search, candidates, suggestSymbols, fetchAsset, fetchSplits, fetchDividends, fetchNews, translate, translateDirect };
  }

  /* Créneaux de versement (mois → montant) quand l'actif verse plusieurs fois par an des montants INÉGAUX
     (ex. Novo Nordisk : acompte ~3,75 en août, solde ~7,95 en mars). Retenus seulement si le même schéma
     (mêmes mois, même nombre de versements) existait déjà l'année précédente : un dividende exceptionnel
     isolé n'est donc jamais reconduit. Sinon null → modèle simple « dernier montant × fréquence ». */
  function buildSlots(divs, nowISO) {
    const t12 = shiftMonths(nowISO, -12), t24 = shiftMonths(nowISO, -24);
    const cur = divs.filter((d) => d.exDate > t12), prev = divs.filter((d) => d.exDate > t24 && d.exDate <= t12);
    if (cur.length < 2 || cur.length !== prev.length) return null;
    const byM = {}; cur.forEach((d) => { const m = Number(d.exDate.slice(5, 7)); byM[m] = (byM[m] || 0) + d.amount; });
    const months = Object.keys(byM).map(Number);
    const prevM = prev.map((d) => Number(d.exDate.slice(5, 7)));
    const near = (a, b) => { const x = Math.abs(a - b); return Math.min(x, 12 - x) <= 1; };
    if (!months.every((m) => prevM.some((pm) => near(pm, m)))) return null;
    const amts = months.map((m) => byM[m]);
    if (Math.max.apply(null, amts) / Math.min.apply(null, amts) < 1.25) return null;
    return months.sort((a, b) => a - b).map((m) => ({ month: m, amount: Math.round(byM[m] * 1e6) / 1e6 }));
  }

  /* Calendrier de PAIEMENT d'un actif : le versement tombe en moyenne « délai » jours après la date de détachement.
     Le délai est appris des versements réels (Dividends.learnPayLags) ; à défaut, 10 jours (valeur indicative). Mois, jour habituel et créneaux sont calculés sur les dates de PAIEMENT estimées. */
  const LAG_DEFAUT = 10;
  const addDaysISO = (iso, n) => new Date(Date.parse(iso) + n * 86400000).toISOString().slice(0, 10);
  function deriveSchedule(h, nowISO, divs) {
    const d = h.dividend; if (!d || d.none) return;
    const src = Array.isArray(divs) && divs.length ? divs : (Array.isArray(d.history) ? d.history.map((x) => ({ exDate: x.exDate, amount: x.amount })) : []);
    if (!src.length) return;
    const lag = Number(d.payLagDays) >= 0 && d.payLagDays !== null ? Number(d.payLagDays) : LAG_DEFAUT;
    const pays = src.map((x) => ({ exDate: addDaysISO(x.exDate, lag), amount: x.amount }));
    const active = pays.filter((x) => x.exDate >= shiftMonths(nowISO, -18)); if (!active.length) return;
    const last = active[active.length - 1];
    d.anchorMonth = Number(last.exDate.slice(5, 7)); d.payDayApi = Number(last.exDate.slice(8, 10)); d.dateKind = 'pay';
    d.slots = buildSlots(pays, nowISO);
  }

  /* Applique les données de marché à un actif. Ne touche jamais aux champs saisis
     à la main (quantité, prix de revient, compte, retenue fiscale, jour de paiement). */
  function applyToHolding(h, a, nowISO) {
    h.dividend = h.dividend || {};
    const d = h.dividend;
    if (a.resolved && isISIN(h.ticker)) { h.isin = h.isin || h.ticker.toUpperCase(); }
    if (a.resolved) { h.ticker = a.symbol; h.displayTicker = a.symbol.toUpperCase(); }
    if (a.name && !h.name) h.name = a.name;
    if (a.currency) h.currency = a.currency;
    if (a.price > 0) { h.price = a.price; h.priceAt = a.priceAt || nowISO; }
    if (a.hist) h.hist = a.hist;
    if (a.splits) h.splits = a.splits;
    if (a.instrumentType) h.instrumentType = a.instrumentType;
    if ('prevClose' in a) { h.prevClose = a.prevClose; h.prevCloseAt = a.prevCloseAt || null; }
    if (!h.geoLocked) {     // secteur et pays : sauf si vous les avez saisis vous-même
      if (a.sector) { h.sector = a.sector; h.industry = a.industry || h.industry || null; }
      else if (a.instrumentType === 'ETF' && !h.sector) h.sector = 'ETF';
      if (!h.country) h.country = deriveCountry(a.resolved ? a.symbol : h.ticker, h.isin, a.instrumentType === 'ETF' || h.type === 'etf_dist' || h.type === 'etf_acc');
    }
    const recent = a.dividends.slice(-16);
    d.history = recent.map((x) => ({ exDate: x.exDate, payDate: null, amount: x.amount }));
    d.updatedAt = nowISO;
    // Un actif est considéré comme versant un dividende s'il en a versé un dans les 18 derniers mois.
    const active = a.dividends.filter((x) => x.exDate >= shiftMonths(nowISO, -18));
    if (!active.length) {
      // Aucun dividende récent : on ne prévoit rien. ETF → capitalisant probable (modifiable).
      d.none = true; d.lastAmount = null; d.anchorMonth = null; d.frequency = 'none'; d.slots = null;
      if (a.instrumentType === 'ETF' && !h.typeLocked) h.type = 'etf_acc';
    } else {
      d.none = false;
      const last = active[active.length - 1];
      d.lastAmount = last.amount;
      let freq = detectFrequency(a.dividends.slice(-8).map((x) => x.exDate));
      if (freq === 'irregular' && active.length === 1) freq = 'annual';
      d.frequency = freq;
      deriveSchedule(h, nowISO, a.dividends);          // mois, jour et créneaux de PAIEMENT (détachement + délai)
      if (a.instrumentType === 'ETF' && !h.typeLocked && h.type === 'stock') h.type = 'etf_dist';
    }
    return h;
  }
  /* Positions soldées (archive) : uniquement l'historique de cours, le nom et la devise servent à valoriser le passé. */
  function applyToArchive(a, f, nowISO) {
    if (f.resolved) { a.ticker = f.symbol; a.displayTicker = f.symbol.toUpperCase(); }
    if (f.name && !a.name) a.name = f.name;
    if (f.currency) a.currency = f.currency;
    if (f.hist) a.hist = f.hist;
    if (f.splits) a.splits = f.splits;
    a.marketAt = nowISO; a.marketError = null; delete a.listingSuspect;
    return a;
  }
  function shiftMonths(iso, n) {
    const y = Number(iso.slice(0, 4)), m = Number(iso.slice(5, 7)) - 1 + n, d = iso.slice(8, 10);
    const yy = y + Math.floor(m / 12), mm = ((m % 12) + 12) % 12 + 1;
    return yy + '-' + String(mm).padStart(2, '0') + '-' + d;
  }

  /* ---------- actualisation LÉGÈRE (bouton, tirer pour actualiser, actualisation automatique) ----------
     Met à jour seulement les cours, la variation du jour et les nouveaux dividendes des actifs détenus : une requête de 5 ans par actif,
     fusionnée avec l'historique déjà enregistré (jamais remplacé). Pas de recherche de secteur, pas de positions clôturées.
     Une actualisation COMPLÈTE (10 ans, secteur…) reste faite pour un actif neuf, sans historique, après un fractionnement, ou tous les 14 jours. */
  const QUICK_MIN_MS = 5 * 60 * 1000, FULL_EVERY_MS = 14 * 86400000;
  const padM = (n) => String(n).padStart(2, '0');
  function mergeHist(old, nw) {
    if (!nw) return old || null;
    if (!old || !old.c || !old.from) return nw;
    const by = {};
    const put = (s) => { if (!s || !s.c || !s.from) return; let y = Number(s.from.slice(0, 4)), mo = Number(s.from.slice(5, 7)); s.c.forEach((v) => { if (v !== null && v !== undefined) by[y + '-' + padM(mo)] = v; mo++; if (mo > 12) { mo = 1; y++; } }); };
    put(old); put(nw);                                              // les mois récents (nouveaux) remplacent les anciens
    const keys = Object.keys(by).sort(); if (!keys.length) return old;
    const out = [], y1 = Number(keys[keys.length - 1].slice(0, 4)), m1 = Number(keys[keys.length - 1].slice(5));
    for (let y = Number(keys[0].slice(0, 4)), mo = Number(keys[0].slice(5)); ; mo++) { if (mo > 12) { mo = 1; y++; } const k = y + '-' + padM(mo); out.push(by[k] === undefined ? null : by[k]); if (y === y1 && mo === m1) break; }
    const res = { from: keys[0], c: out };
    if (nw.d && old.d && nw.d.t && old.d.t) {                      // quotidien : union par date, les nouveaux cours l'emportent, 140 séances conservées
      const dm = {}; [old.d, nw.d].forEach((s) => s.t.forEach((t, i) => { dm[t] = s.c[i]; }));
      const ts = Object.keys(dm).map(Number).sort((a, b) => a - b).slice(-140); res.d = { t: ts, c: ts.map((t) => dm[t]) };
    } else if (nw.d || old.d) res.d = nw.d || old.d;
    return res;
  }
  /* Fractionnement apparu depuis la dernière fois : les anciens cours sont alors tous ajustés, la fusion serait fausse → actualisation complète de cet actif. */
  function splitsChanged(h, a) {
    const from = a.hist && a.hist.from ? a.hist.from + '-01' : '';
    const sig = (l) => JSON.stringify((l || []).filter((s) => s.date >= from).map((s) => s.date + ':' + s.ratio));
    return sig(h.splits) !== sig(a.splits);
  }
  const STALE_DAYS = 45;
  /* Dernière cotation très ancienne → la société est peut-être plus cotée : signalé (jamais décidé tout seul). */
  function noteListing(h, a, nowISO) {
    const t = a && a.priceAt ? Date.parse(a.priceAt) : NaN;
    if (!isNaN(t) && Date.parse(nowISO) - t > STALE_DAYS * 86400000) h.listingSuspect = { kind: 'stale', since: a.priceAt.slice(0, 10), at: nowISO };
    else delete h.listingSuspect;
  }
  const noPriceMsg = (a) => 'Yahoo Finance ne renvoie aucun cours pour ' + (a.symbol || 'ce symbole') + ' (symbole sans cotation : essayez un autre symbole pour cet ISIN).';
  const needsFull = (h, now) => !h.hist || !h.hist.c || !h.hist.c.length || (h.fullAt && now - h.fullAt > FULL_EVERY_MS);
  /* Mise à jour LÉGÈRE d'un actif : cours, variation du jour, devise et fin de l'historique. Les dividendes et le calendrier ne sont pas recalculés. */
  function applyQuote(h, a, nowISO) {
    if (a.currency) h.currency = a.currency;
    if (a.price > 0) { h.price = a.price; h.priceAt = a.priceAt || nowISO; }
    if (a.instrumentType) h.instrumentType = a.instrumentType;
    if ('prevClose' in a) { h.prevClose = a.prevClose; h.prevCloseAt = a.prevCloseAt || null; }
    if (a.hist) h.hist = mergeHist(h.hist, a.hist);
    return h;
  }
  /* Nouveaux dividendes = détachements absents de ceux déjà enregistrés (les 16 derniers). */
  function newDividends(h, a) {
    const st = ((h.dividend || {}).history || []), known = new Set(st.map((x) => x.exDate)), min = st.length >= 16 ? st.reduce((mn, x) => (x.exDate < mn ? x.exDate : mn), '9999') : '';
    return (a.dividends || []).filter((x) => !known.has(x.exDate) && x.exDate > min);
  }

  /* Actualise plusieurs actifs ; s'arrête sur quota/relais refusé.
     hooks.quick : actualisation légère (voir ci-dessus), 4 requêtes en parallèle ; sinon un actif à la fois avec une pause. */
  async function refreshMany(client, holdings, nowISO, hooks) {
    hooks = hooks || {};
    const quick = !!hooks.quick, res = { ok: 0, fail: 0, skipped: 0, newDiv: 0, errors: [], stopped: false }, now = Date.now();
    let next = 0, halt = false, done = 0;
    const one = async (h) => {
      let pause = true;
      if (h.listing === 'delisted') { res.skipped++; return; }                       // société déclarée plus cotée : plus aucune requête
      try {
        if (quick && !needsFull(h, now)) {
          if (h.quickAt && now - h.quickAt < QUICK_MIN_MS) { res.skipped++; pause = false; }            // tout juste actualisé
          else if (h.listingSuspect && h.listingSuspect.kind !== 'stale' && h.listingSuspect.at === nowISO) { res.skipped++; pause = false; }   // déjà tenté aujourd'hui (introuvable)
          else {
            const a = await client.fetchAsset(h.ticker, h.name, { needSector: false, range: '6mo' });
            const fresh = newDividends(h, a);
            if (fresh.length || splitsChanged(h, a)) {                                                    // nouveau dividende ou fractionnement : revue complète de CET actif seulement
              const f = await client.fetchAsset(h.ticker, h.name, { needSector: !h.sector && !h.geoLocked });
              applyToHolding(h, f, nowISO); noteListing(h, f, nowISO); h.fullAt = now; if (fresh.length) res.newDiv++;
            } else { applyQuote(h, a, nowISO); noteListing(h, a, nowISO); if (!h.fullAt) h.fullAt = now; }
            h.quickAt = now; h.marketError = null;
            if (!(a.price > 0) && !fresh.length) throw new Error(noPriceMsg(a));
            res.ok++;
          }
        } else {
          const a = await client.fetchAsset(h.ticker, h.name, { needSector: !h.sector && !h.geoLocked });
          applyToHolding(h, a, nowISO); noteListing(h, a, nowISO); h.fullAt = now; h.quickAt = now; h.marketError = null;
          if (!(a.price > 0)) throw new Error(noPriceMsg(a));
          res.ok++;
        }
      } catch (e) {
        res.fail++; res.errors.push({ ticker: h.displayTicker || h.ticker, message: e.message }); h.marketError = e.message;
        if (e.delisted || e.notFound) h.listingSuspect = { kind: e.delisted ? 'delisted' : 'notfound', at: nowISO, msg: e.message };
        if (e.rate || e.fatal) { res.stopped = true; halt = true; }
      }
      const gap = quick ? Math.min(opts_delay, 80) : opts_delay;
      if (pause && gap > 0 && !halt) await new Promise((r) => setTimeout(r, gap));
    };
    const worker = async () => {
      while (!halt) {
        if (hooks.cancelled && hooks.cancelled()) { res.stopped = true; halt = true; break; }
        const i = next++; if (i >= holdings.length) break;
        await one(holdings[i]); done++; if (hooks.progress) hooks.progress(done, holdings.length, holdings[i]);
      }
    };
    await Promise.all(Array.from({ length: quick ? 4 : 1 }, worker));
    return res;
  }
  let opts_delay = 250;

  root.Market = { isISIN, pickSymbol, rankSymbols, parseNews, detectFrequency, buildSlots, deriveCountry, monthlySeries, dailySeries, splitList, COUNTRY_NAME, makeClient, applyToHolding, deriveSchedule, addDaysISO, LAG_DEFAUT, applyToArchive, refreshMany, mergeHist, splitsChanged, noteListing, newDividends, applyQuote, setDelay: (ms) => { opts_delay = ms; } };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.Market;
})(typeof self !== 'undefined' ? self : this);
