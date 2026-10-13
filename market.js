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

    async function resolveSymbol(input, nameHint) {
      const t = String(input || '').trim();
      if (!isISIN(t)) return t;
      const queries = [t.toUpperCase()];
      if (nameHint && String(nameHint).trim()) queries.push(String(nameHint).trim().slice(0, 60));
      for (let i = 0; i < queries.length; i++) {
        const quotes = await search(queries[i]).catch((e) => { if (e.rate || e.fatal) throw e; return []; });
        const sym = pickSymbol(quotes, t);
        if (sym) return sym;
      }
      throw new Error('ISIN introuvable : renseignez le symbole boursier (ex : AI.PA).');
    }

    /* Données d'un actif. Renvoie toujours un objet explicite, jamais de valeurs inventées. */
    async function fetchAsset(input, nameHint) {
      const symbol = await resolveSymbol(input, nameHint);
      const data = await call('/chart?symbol=' + encodeURIComponent(symbol));
      const res = data.chart && data.chart.result && data.chart.result[0];
      if (!res) {
        const desc = data.chart && data.chart.error && data.chart.error.description;
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
        name: meta.longName || meta.shortName || null, currency,
        instrumentType: meta.instrumentType || null,        // EQUITY | ETF | …
        price: meta.regularMarketPrice > 0 ? (pence ? meta.regularMarketPrice / 100 : meta.regularMarketPrice) : null,
        priceAt: meta.regularMarketTime ? new Date(meta.regularMarketTime * 1000).toISOString() : null,
        dividends: divs
      };
    }

    return { call, search, resolveSymbol, fetchAsset };
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
    const recent = a.dividends.slice(-12);
    d.history = recent.map((x) => ({ exDate: x.exDate, payDate: null, amount: x.amount }));
    d.updatedAt = nowISO;
    // Un actif est considéré comme versant un dividende s'il en a versé un dans les 18 derniers mois.
    const active = a.dividends.filter((x) => x.exDate >= shiftMonths(nowISO, -18));
    if (!active.length) {
      // Aucun dividende récent : on ne prévoit rien. ETF → capitalisant probable (modifiable).
      d.none = true; d.lastAmount = null; d.anchorMonth = null; d.frequency = 'none';
      if (a.instrumentType === 'ETF' && !h.typeLocked) h.type = 'etf_acc';
    } else {
      d.none = false;
      const last = active[active.length - 1];
      d.lastAmount = last.amount;
      d.anchorMonth = Number(last.exDate.slice(5, 7));
      let freq = detectFrequency(a.dividends.slice(-8).map((x) => x.exDate));
      if (freq === 'irregular' && active.length === 1) freq = 'annual';
      d.frequency = freq;
      d.dateKind = 'ex';
      if (a.instrumentType === 'ETF' && !h.typeLocked && h.type === 'stock') h.type = 'etf_dist';
    }
    return h;
  }
  function shiftMonths(iso, n) {
    const y = Number(iso.slice(0, 4)), m = Number(iso.slice(5, 7)) - 1 + n, d = iso.slice(8, 10);
    const yy = y + Math.floor(m / 12), mm = ((m % 12) + 12) % 12 + 1;
    return yy + '-' + String(mm).padStart(2, '0') + '-' + d;
  }

  /* Actualise plusieurs actifs, un par un, avec une pause ; s'arrête sur quota/relais refusé. */
  async function refreshMany(client, holdings, nowISO, hooks) {
    hooks = hooks || {};
    const res = { ok: 0, fail: 0, errors: [], stopped: false };
    for (let i = 0; i < holdings.length; i++) {
      if (hooks.cancelled && hooks.cancelled()) { res.stopped = true; break; }
      const h = holdings[i];
      try {
        const a = await client.fetchAsset(h.ticker, h.name);
        applyToHolding(h, a, nowISO);
        res.ok++;
      } catch (e) {
        res.fail++; res.errors.push({ ticker: h.displayTicker || h.ticker, message: e.message });
        if (e.rate || e.fatal) { res.stopped = true; if (hooks.progress) hooks.progress(i + 1, holdings.length, h); break; }
      }
      if (hooks.progress) hooks.progress(i + 1, holdings.length, h);
      if (opts_delay > 0) await new Promise((r) => setTimeout(r, opts_delay));
    }
    return res;
  }
  let opts_delay = 250;

  root.Market = { isISIN, pickSymbol, detectFrequency, makeClient, applyToHolding, refreshMany, setDelay: (ms) => { opts_delay = ms; } };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.Market;
})(typeof self !== 'undefined' ? self : this);
