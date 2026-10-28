/* ==================================================================
   ledger.js — import intelligent d'un historique de courtier (DEGIRO…) et grand livre.
   Module PUR (aucun accès au DOM ni au stockage) : testé sous Node.

   1. Lecture : détection des colonnes d'après leur SENS (en-têtes en plusieurs langues,
      colonnes sans titre, contenu), nombres à l'européenne, dates, devises.
   2. Grand livre : achats / ventes dans l'ordre chronologique, quantité, coût et PRU
      (coût moyen pondéré, frais d'achat inclus) après chaque opération, résultat réalisé.
   3. Plan d'import : rapprochement avec l'existant, doublons, positions à créer, soldées
      (archivées), divergences — sans jamais modifier ce qui existe sans choix explicite.
   Rien n'est inventé : une donnée absente reste absente et l'opération est signalée.
   ================================================================== */
(function (root) {
  'use strict';
  const EPS = 1e-6;
  const r8 = (x) => Math.round(x * 1e8) / 1e8;
  const r4 = (x) => Math.round(x * 1e4) / 1e4;
  const r2 = (x) => Math.round(x * 100) / 100;
  const norm = (s) => String(s == null ? '' : s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
  const ISIN_RE = /^[A-Z]{2}[A-Z0-9]{9}[0-9]$/;
  const isISIN = (s) => ISIN_RE.test(String(s || '').trim().toUpperCase());
  const pad2 = (n) => String(n).padStart(2, '0');

  /* ---------------------------------------------------------------
     NOMBRES, DATES, HEURES
     --------------------------------------------------------------- */
  /* Séparateur décimal du fichier, déduit de l'ensemble des cellules numériques. */
  function inferDecimal(cells) {
    let comma = 0, dot = 0;
    cells.forEach((raw) => {
      const s = String(raw == null ? '' : raw).trim().replace(/[\s  ']/g, '').replace(/[−‒-—]/g, '-');
      if (!/^[-+(]?[\d.,]+\)?$/.test(s)) return;
      const hasC = s.indexOf(',') >= 0, hasD = s.indexOf('.') >= 0;
      if (hasC && hasD) { if (s.lastIndexOf(',') > s.lastIndexOf('.')) comma++; else dot++; }
      else if (hasC) { if (/^[-+(]?\d{1,3}(,\d{3})+\)?$/.test(s)) dot += 0.4; else comma++; }       // « 1,234 » : probablement un milliers
      else if (hasD) { if (/^[-+(]?\d{1,3}(\.\d{3})+\)?$/.test(s)) comma += 0.4; else dot++; }
    });
    return dot > comma ? '.' : ',';
  }
  function parseNumber(raw, dec) {
    if (raw === null || raw === undefined) return NaN;
    if (typeof raw === 'number') return raw;
    let s = String(raw).trim(); if (!s) return NaN;
    let neg = false;
    if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }
    s = s.replace(/[−‒-—]/g, '-').replace(/[\s  ']/g, '').replace(/[A-Za-z€$£¥%]/g, '');
    if (!s || !/^[-+]?[\d.,]+$/.test(s)) return NaN;
    const hasC = s.indexOf(',') >= 0, hasD = s.indexOf('.') >= 0;
    if (hasC && hasD) s = s.lastIndexOf(',') > s.lastIndexOf('.') ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
    else if (hasC) s = dec === '.' ? s.replace(/,/g, '') : s.replace(/,/g, '.');
    else if (hasD && dec === ',') { if ((s.match(/\./g) || []).length > 1 || /^[-+]?\d{1,3}\.\d{3}$/.test(s)) s = s.replace(/\./g, ''); }
    if ((s.match(/\./g) || []).length > 1) return NaN;
    const v = parseFloat(s);
    return isNaN(v) ? NaN : (neg ? -v : v);
  }
  function validDate(y, m, d) { const t = new Date(Date.UTC(y, m - 1, d)); return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d; }
  function parseDate(raw, order) {
    const s = String(raw == null ? '' : raw).trim(); if (!s) return null;
    let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?!\d)/), y, mo, d;
    if (m) { y = +m[1]; mo = +m[2]; d = +m[3]; }
    else if ((m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4}|\d{2})(?!\d)/))) {
      const a = +m[1], b = +m[2]; y = +m[3]; if (m[3].length === 2) y += 2000;
      if (order === 'mdy') { mo = a; d = b; } else { d = a; mo = b; }
    } else return null;
    return validDate(y, mo, d) ? y + '-' + pad2(mo) + '-' + pad2(d) : null;
  }
  function inferDateOrder(cells) {
    let dmy = 0, mdy = 0;
    cells.forEach((raw) => { const m = String(raw || '').trim().match(/^(\d{1,2})[/.-](\d{1,2})[/.-]\d{2,4}/); if (!m) return; if (+m[1] > 12) dmy++; else if (+m[2] > 12) mdy++; });
    return mdy > dmy ? 'mdy' : 'dmy';
  }
  function parseTime(raw) { const m = String(raw == null ? '' : raw).match(/(\d{1,2}):(\d{2})/); return m ? pad2(m[1]) + ':' + m[2] : ''; }

  /* ---------------------------------------------------------------
     DÉTECTION DES COLONNES (par le sens, pas par un nom fixe)
     --------------------------------------------------------------- */
  const ROLE_TESTS = [
    ['valueDate', /\b(date de valeur|value date|valutadatum|fecha valor|data valuta|valutadatum)\b|^date de$/],
    ['date', /^(date|datum|fecha|data|trade date|transaction date|date de transaction|date d execution|date operation|datum transactie)$/],
    ['time', /^(heure|time|uhrzeit|hora|tijd|ora|heure d execution)$/],
    ['isin', /\bisin\b/],
    ['fx', /(taux de change|exchange rate|wisselkoers|wechselkurs|tipo de cambio|tasso di cambio|fx rate|koers wissel)/],
    ['localValue', /((valeur|value|waarde|wert|valor|valore) (locale|local|lokale|lokaler))|local value|valeur locale|lokale waarde|montant devise locale|local currency amount|betrag in lokaler wahrung/],
    ['orderId', /(id ordre|id de l ordre|order id|orderid|order nr|ordernummer|auftrags|id commande|order reference|ordre id)/],
    ['fee', /(frais|fees?\b|kosten|gebuhr|gebuehr|comision|commission|courtage|brokerage|autofx|costi|spese|transaction costs)/],
    ['total', /^(total|totaal|gesamt|totale|total eur|montant total|totaal eur|montant negocie|net amount|negotiated amount|genegotieerd bedrag|verhandelter betrag)( [a-z]{3})?$/],
    ['valueAcct', /^(valeur|value|waarde|wert|valor|valore|montant|amount|bedrag)( [a-z]{3})?$/],
    ['qty', /^(quantite|quantity|aantal|anzahl|cantidad|quantita|nombre|number|shares|stuks|qty|nb|nombre de titres|nbre)$/],
    ['price', /^(cours|price|koers|kurs|prix|precio|prezzo|cotation|prix unitaire|unit price)( [a-z]{3})?$/],
    ['balance', /^(solde|saldo|balance|rekeningsaldo)$/],
    ['change', /^(variation|mouvements?|mutatie|veranderung|cambio|movimientos?|movements?|bewegung|bewegingen)$/],
    ['type', /^(type|sens|side|buy sell|achat vente|b s|type d operation|operation type|transaction type|soort)$/],
    ['description', /^(description|omschrijving|beschreibung|descripcion|descrizione|operation|libelle)$/],
    ['currency', /^(devise|currency|munt|wahrung|waehrung|moneda|valuta|divisa)( .*)?$/],
    ['venue', /^(lieu d execution|lieu execution|venue|execution venue|ausfuhrungsort|ausfuehrungsort|uitvoeringsplaats|lugar de ejecucion|sede di esecuzione)$/],
    ['exchange', /^(place boursiere selectionnee|place boursiere|bourse de reference|bourse|reference exchange|exchange|referenzborse|referenzboerse|referentiebeurs|beurs|bolsa de referencia|borsa)$/],
    ['product', /^(produit|product|produkt|producto|prodotto|nom|name|titel|security|instrument|titre|naam|nom du produit|asset)$/]
  ];
  function roleOf(header) {
    const h = norm(header); if (!h) return null;
    for (let i = 0; i < ROLE_TESTS.length; i++) if (ROLE_TESTS[i][1].test(h)) return ROLE_TESTS[i][0];
    return null;
  }
  const CUR_RE = /^[A-Z]{3}$/;
  function headerScore(row) { let n = 0; (row || []).forEach((c) => { if (roleOf(c)) n++; }); return n; }
  function findHeaderRow(rows) {
    let best = -1, bs = 0;
    for (let i = 0; i < Math.min(15, rows.length); i++) { const s = headerScore(rows[i]); if (s > bs) { bs = s; best = i; } }
    return bs >= 3 ? best : -1;
  }
  const colVals = (rows, from, c) => rows.slice(from).map((r) => (r && r[c] != null ? String(r[c]).trim() : '')).filter(Boolean);
  const looksCurrencyCol = (vals) => vals.length > 0 && vals.every((v) => /^(?:[A-Z]{3}|GBp|GBX)$/.test(v));
  const looksNumberCol = (vals, dec) => vals.length > 0 && vals.filter((v) => !isNaN(parseNumber(v, dec))).length / vals.length > 0.9;

  /* Reconnaît la structure d'un export. Retourne les indices de colonnes par rôle. */
  function detect(rows, forcedHeader) {
    const out = { headerIdx: -1, cols: { fees: [] }, acctCur: 'EUR', statement: false, missing: [], notes: [] };
    if (!rows || !rows.length) { out.missing = ['date']; return out; }
    const n = Math.max.apply(null, rows.map((r) => (r || []).length));
    const h = forcedHeader !== undefined && forcedHeader !== null ? forcedHeader : findHeaderRow(rows); out.headerIdx = h;
    const head = h >= 0 ? rows[h].slice() : [], from = h + 1; while (head.length < n) head.push('');
    const cols = out.cols;
    head.forEach((cell, i) => {
      const role = roleOf(cell); if (!role) return;
      if (role === 'fee') { cols.fees.push(i); return; }
      if (cols[role] === undefined) cols[role] = i;
    });
    const body = rows.slice(from), dec = inferDecimal([].concat.apply([], body.slice(0, 200)));
    // Colonnes sans titre : devise du cours / de la valeur locale (située juste après)
    const unnamedCur = (idx) => idx !== undefined && idx + 1 < n && !roleOf(head[idx + 1]) && !String(head[idx + 1] || '').trim() && looksCurrencyCol(colVals(rows, from, idx + 1)) ? idx + 1 : undefined;
    if (cols.price !== undefined) { const c = unnamedCur(cols.price); if (c !== undefined) cols.priceCur = c; }
    if (cols.localValue !== undefined) { const c = unnamedCur(cols.localValue); if (c !== undefined) cols.localCur = c; }
    if (cols.currency !== undefined && cols.priceCur === undefined) cols.priceCur = cols.currency;
    if (cols.priceCur === undefined && cols.localCur !== undefined) cols.priceCur = cols.localCur;
    // Relevé de compte DEGIRO : « Variation » (devise) puis montant sans titre
    if (cols.change !== undefined) {
      const a = cols.change, b = a + 1;
      if (looksCurrencyCol(colVals(rows, from, a)) && b < n && looksNumberCol(colVals(rows, from, b), dec)) { cols.changeCur = a; cols.change = b; }
      else if (a > 0 && looksCurrencyCol(colVals(rows, from, a - 1)) && looksNumberCol(colVals(rows, from, a), dec)) cols.changeCur = a - 1;
    }
    // Contenu : date / ISIN si les titres manquent
    if (cols.date === undefined) for (let c = 0; c < n; c++) { const v = colVals(rows, from, c); if (v.length && v.filter((x) => parseDate(x)).length / v.length > 0.8) { cols.date = c; break; } }
    if (cols.isin === undefined) for (let c = 0; c < n; c++) { const v = colVals(rows, from, c); if (v.length && v.filter((x) => isISIN(x)).length / v.length > 0.6) { cols.isin = c; break; } }
    // Devise du compte : lue dans le titre des colonnes de montant (« Total EUR », « Valeur EUR »…)
    [cols.total, cols.valueAcct].concat(cols.fees).forEach((i) => { if (i === undefined) return; const m = String(head[i] || '').trim().match(/(?:^|\s)([A-Z]{3})$/); if (m && out.acctCur === 'EUR') out.acctCur = m[1]; });
    out.statement = cols.qty === undefined && cols.description !== undefined;
    if (cols.date === undefined) out.missing.push('date');
    if (cols.isin === undefined && cols.product === undefined) out.missing.push('produit / ISIN');
    if (!out.statement && cols.qty === undefined) out.missing.push('quantité');
    if (cols.price === undefined && cols.localValue === undefined && cols.valueAcct === undefined && cols.total === undefined && cols.change === undefined) out.missing.push('prix ou montant');
    return out;
  }

  /* ---------------------------------------------------------------
     LECTURE DES OPÉRATIONS
     --------------------------------------------------------------- */
  const TRADE_DESC = /^(achat|vente|buy|sell|bought|sold|koop|verkoop|kauf|verkauf|compra|venta|acquisto|vendita)\s+([\d.,\s]+?)\s+(.+?)\s*@\s*([\d.,\s]+?)\s+([A-Za-z]{3})(?:\s*\(([A-Z0-9]{12})\))?\s*$/i;
  const BUY_WORDS = /^(achat|buy|bought|koop|kauf|compra|acquisto|b|a|c)$/i, SELL_WORDS = /^(vente|sell|sold|verkoop|verkauf|venta|vendita|s|v)$/i;
  function otherKind(desc) {
    const d = norm(desc);
    if (/change de devise|currency (debit|credit)|conversion de devise|wisselkoers|devisen|cambio de divisa|fx (debit|credit)|operation de change/.test(d)) return 'conversion de devise';
    if (/dividend|dividende|dividendo/.test(d)) return 'dividende';
    if (/retenue|withholding|quellensteuer|impot|tax\b/.test(d)) return 'retenue';
    if (/depot|deposit|storting|einzahlung|ingreso|versement|virement|ideal|sofort|flatex/.test(d) && !/frais|fee|kosten/.test(d)) return 'dépôt / virement';
    if (/retrait|withdraw|opname|auszahlung|reembolso|retirada/.test(d)) return 'retrait';
    if (/frais|fee|kosten|gebuhr|commission|courtage|connectivity|connexion|costi/.test(d)) return 'frais';
    if (/interet|interest|rente|zins|interes/.test(d)) return 'intérêts';
    if (/fractionnement|split|regroupement|reverse split|opera?tion sur titre|corporate|spin|fusion|merger|changement de produit|product change|changement d isin|isin change|echange de titres|offre publique|radiation|delisting|conversion/.test(d)) return 'opération sur titres';
    return 'autre';
  }

  /* Hachage 32 bits (deux variantes) pour des identifiants stables et compacts. */
  function hash32(s, seed) { let h = seed >>> 0; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; } return h; }
  function fingerprint(op) {
    const k = ['dg', op.isin || norm(op.name), op.date, op.time || '', op.type, r8(op.qty), r8(op.price), op.priceCur || '', op.amt == null ? '' : r2(op.amt), op.orderId || ''].join('|');
    return hash32(k, 2166136261).toString(36) + hash32(k, 0x9e3779b1).toString(36);
  }

  function parseOps(rows, det, opt) {
    opt = opt || {};
    const out = { ops: [], bad: [], ambiguous: [], other: [], corp: [], divs: [], meta: { decimal: ',', dateOrder: 'dmy', acctCur: det.acctCur || 'EUR', rows: 0, signedQty: true } };
    if (det.headerIdx < 0 && det.cols.date === undefined) return out;
    const cols = det.cols, body = rows.slice(det.headerIdx + 1), base = det.headerIdx + 1;
    const numCols = [cols.qty, cols.price, cols.localValue, cols.valueAcct, cols.total, cols.change, cols.fx].concat(cols.fees).filter((c) => c !== undefined);
    const dec = opt.decimal || inferDecimal([].concat.apply([], body.slice(0, 400).map((r) => numCols.map((c) => r[c])))), order = opt.dateOrder || inferDateOrder(body.map((r) => r[cols.date]));
    out.meta.decimal = dec; out.meta.dateOrder = order; out.meta.rows = body.length;
    const num = (v) => parseNumber(v, dec);
    const g = (r, k) => (cols[k] !== undefined && r[cols[k]] != null ? String(r[cols[k]]).trim() : '');
    const accCur = det.acctCur || 'EUR';
    // Quantités signées ? (vente = quantité négative). Sinon on s'appuie sur le signe du total.
    const qtys = cols.qty !== undefined ? body.map((r) => num(g(r, 'qty'))).filter((x) => !isNaN(x)) : [];
    const signed = qtys.some((x) => x < 0); out.meta.signedQty = signed;

    body.forEach((r, i) => {
      if (!r || !r.some((c) => String(c == null ? '' : c).trim() !== '')) return;
      const line = base + i + 1, raw = r.map((c) => String(c == null ? '' : c).trim()).join(' ; ');
      const dateCell = g(r, 'date'), date = parseDate(dateCell, order);
      if (!date) { if (headerScore(r) >= 3) return; out.bad.push({ line, reason: 'Date illisible (« ' + dateCell + ' »)', raw }); return; }
      if (!out.meta.from || date < out.meta.from) out.meta.from = date; if (!out.meta.to || date > out.meta.to) out.meta.to = date;      // période couverte par le fichier
      let time = parseTime(g(r, 'time')) || parseTime(dateCell);
      let name = g(r, 'product'), isin = g(r, 'isin').toUpperCase();
      const warn = [];
      if (isin && !ISIN_RE.test(isin)) { warn.push('ISIN invalide (« ' + isin + ' »)'); isin = ''; }
      const desc = g(r, 'description'), typeCell = g(r, 'type');
      let kind = null, qty = NaN, price = NaN, priceCur = '', total = null, valueAcct = null, fees = null;
      const fxv = num(g(r, 'fx')), orderId = g(r, 'orderId');

      if (det.statement || (cols.qty === undefined && desc)) {
        const m = desc.match(TRADE_DESC);
        if (!m) {
          const kind0 = otherKind(desc); out.other.push({ line, kind: kind0, desc, date, raw });
          // dividendes et retenues à la source du relevé de compte du courtier : source CONFIRMÉE (montant brut, retenue, devise réels)
          if ((kind0 === 'dividende' || kind0 === 'retenue') && /dividend|dividende/.test(norm(desc))) { const a = num(g(r, 'change')), isTax = /impot|\btax\b|retenue|withholding|quellensteuer/.test(norm(desc)); if (!isNaN(a) && a !== 0 && (isin || name)) out.divs.push({ line, date: (cols.valueDate !== undefined && parseDate(g(r, 'valueDate'), order)) || date, bookedAt: date, isin, name, kind: isTax ? 'tax' : 'dividend', amount: a, cur: (cols.changeCur !== undefined ? g(r, 'changeCur') : '').replace(/\s/g, '').toUpperCase() || det.acctCur || 'EUR' }); }
          if (kind0 === 'opération sur titres') { const rm = desc.match(/(\d+(?:[.,]\d+)?)\s*(?:pour|for|:|\/|contre|voor|zu)\s*(\d+(?:[.,]\d+)?)/i); out.corp.push({ line, date, isin, name, desc, ratio: rm ? parseNumber(rm[1], dec) / parseNumber(rm[2], dec) : null, source: 'csv' }); }
          return;
        }
        kind = BUY_WORDS.test(m[1]) ? 'buy' : 'sell';
        qty = Math.abs(num(m[2])); price = Math.abs(num(m[4])); priceCur = m[5].toUpperCase() === 'GBX' ? 'GBX' : m[5].toUpperCase();
        if (!isin && m[6]) isin = m[6].toUpperCase();
        if (!name) name = m[3].trim();
        const ch = num(g(r, 'change')); if (!isNaN(ch)) total = Math.abs(ch);
      } else {
        qty = num(g(r, 'qty'));
        if (!isNaN(qty) && qty === 0) { out.other.push({ line, kind: 'ligne informative (quantité nulle)', desc: name || isin, date, raw }); return; }     // aucune quantité : pas une opération
        if (isNaN(qty)) { out.bad.push({ line, reason: 'Quantité illisible (« ' + g(r, 'qty') + ' »)', raw }); return; }
        price = Math.abs(num(g(r, 'price')));
        const lv = num(g(r, 'localValue'));
        if (isNaN(price) && !isNaN(lv)) price = Math.abs(lv) / Math.abs(qty);
        priceCur = cols.priceCur !== undefined ? g(r, 'priceCur').replace(/\s/g, '') : '';
        if (priceCur && !/^(?:[A-Za-z]{3})$/.test(priceCur)) priceCur = '';
        priceCur = priceCur === 'GBp' ? 'GBX' : priceCur.toUpperCase();
        const t = num(g(r, 'total')), v = num(g(r, 'valueAcct'));
        total = isNaN(t) ? null : Math.abs(t); valueAcct = isNaN(v) ? null : Math.abs(v);
        if (price === 0 || (total !== null && total === 0)) {
          // Mouvement de titres SANS flux d'argent (livraison gratuite, droits, échange, retrait, radiation…). La quantité est explicite : elle est reprise
          // (livraison = quantité + à coût nul ; retrait = quantité −, sans résultat réalisé), jamais comme un achat ou une vente.
          out.corp.push({ line, date, isin, name, desc: (qty < 0 ? 'Retrait de ' + Math.abs(qty) : 'Livraison de ' + qty) + ' titre(s) sans montant', ratio: null, source: 'csv', zero: true });
          if (opt.zeroMode === 'skip') { out.ambiguous.push({ line, reason: 'Mouvement de titres sans montant (livraison gratuite, droits, échange, retrait) — non importé sur votre demande', raw }); return; }
          if (!signed) { out.ambiguous.push({ line, reason: 'Mouvement de titres sans montant dont le sens est indéterminé (quantité non signée)', raw }); return; }
          out.ops.push({ line, date, time, name, isin, type: qty < 0 ? 'sell' : 'buy', qty: r8(Math.abs(qty)), price: 0, priceCur: priceCur || accCur, valueAcct: 0, acctCur: accCur, fees: 0, total: 0, amt: 0, fxRate: null, orderId: g(r, 'orderId'), venue: g(r, 'venue'), exchange: g(r, 'exchange'), zero: true, warn: [], raw, seq: out.ops.length });
          return;
        }
        if (typeCell) { if (BUY_WORDS.test(typeCell) || /achat|buy|koop|kauf|compra/i.test(typeCell)) kind = 'buy'; else if (SELL_WORDS.test(typeCell) || /vente|sell|verkoop|verkauf|venta/i.test(typeCell)) kind = 'sell'; }
        const signTotal = isNaN(t) || t === 0 ? 0 : (t < 0 ? 1 : -1);        // total négatif = argent sorti = achat
        if (!kind) {
          if (signed) kind = qty < 0 ? 'sell' : 'buy';
          else if (signTotal) kind = signTotal > 0 ? 'buy' : 'sell';
        }
        if (!kind) { out.ambiguous.push({ line, reason: 'Achat ou vente indéterminé (quantité non signée et total absent)', raw }); return; }
        // vente dont les frais dépassent le produit (fraction de titre, petite ligne) : total négatif légitime
        const feesOver = kind === 'sell' && signTotal > 0 && valueAcct !== null && cols.fees.reduce((a, c) => a + (isNaN(num(r[c])) ? 0 : Math.abs(num(r[c]))), 0) + 0.005 >= valueAcct;
        if (signed && signTotal && !feesOver && ((kind === 'buy' && signTotal < 0) || (kind === 'sell' && signTotal > 0))) { out.ambiguous.push({ line, reason: 'Signe de la quantité et du total contradictoires', raw }); return; }
      }
      qty = Math.abs(qty);
      if (isNaN(qty) || qty === 0) { out.bad.push({ line, reason: 'Quantité illisible', raw }); return; }
      if (cols.fees.length) {
        const fv = cols.fees.map((c) => num(r[c])).filter((x) => !isNaN(x));
        fees = fv.length ? fv.reduce((s, x) => s + Math.abs(x), 0) : null;
      }
      if (!name && !isin) { out.bad.push({ line, reason: 'Produit et ISIN absents', raw }); return; }
      if (isNaN(price)) { out.bad.push({ line, reason: 'Prix illisible', raw }); return; }
      if (!priceCur) { priceCur = accCur; warn.push('Devise du cours absente : devise du compte supposée'); }
      // montant en devise du compte, frais compris (achat) / net des frais (vente)
      let amt = null;
      if (total !== null) amt = total;
      else if (valueAcct !== null) amt = kind === 'buy' ? valueAcct + (fees || 0) : valueAcct - (fees || 0);
      else if (priceCur === accCur) amt = kind === 'buy' ? qty * price + (fees || 0) : qty * price - (fees || 0);
      else warn.push('Montant en devise du compte absent : prix de revient non calculable pour cette ligne');
      // contrôles de cohérence
      const tol = (x) => Math.max(0.05, Math.abs(x) * 0.005);
      if (total !== null && valueAcct !== null && fees !== null) {
        const exp = kind === 'buy' ? valueAcct + fees : valueAcct - fees;
        if (Math.abs(exp - total) > tol(total)) warn.push('Total ≠ valeur ± frais');
      }
      if (valueAcct !== null && priceCur === accCur && Math.abs(qty * price - valueAcct) > tol(valueAcct)) warn.push('Quantité × cours ≠ valeur');
      out.ops.push({ line, date, time, name, isin, type: kind, qty: r8(qty), price: price, priceCur, valueAcct, acctCur: accCur, fees, total, amt: amt === null ? null : r4(amt), fxRate: isNaN(fxv) ? null : fxv, orderId, venue: g(r, 'venue'), exchange: g(r, 'exchange'), warn, raw, seq: out.ops.length });
    });
    assignIds(out.ops);
    const oc = {}; out.other.forEach((x) => { oc[x.kind] = (oc[x.kind] || 0) + 1; });
    out.report = { divs: out.divs.length, read: out.ops.length + out.bad.length + out.ambiguous.length + out.other.length, recognized: out.ops.length, bad: out.bad.length, ambiguous: out.ambiguous.length, other: oc, corp: out.corp.length };
    return out;
  }
  /* Identifiant stable : empreinte du contenu + rang d'occurrence (deux lignes strictement identiques
     restent deux opérations distinctes, et le même fichier réimporté redonne les mêmes identifiants). */
  function assignIds(ops) {
    const seen = {};
    ops.forEach((o) => { const fp = fingerprint(o); seen[fp] = (seen[fp] || 0) + 1; o.extId = 'dg:' + fp + ':' + seen[fp]; });
    return ops;
  }

  /* ---------------------------------------------------------------
     GRAND LIVRE (coût moyen pondéré)
     entrées : { date, time, type, qty, amt, fees }
       buy     achat  : quantité +, coût + amt (frais d'achat INCLUS)
       sell    vente  : quantité −, coût − (PRU moyen × quantité vendue) ; résultat réalisé = produit net des frais − coût sorti
                        (les frais de vente restent dans le résultat réalisé, jamais retirés une seconde fois du PRU)
       split   opération sur titres explicite : quantité × ratio, coût inchangé (PRU ÷ ratio) — jamais un achat
       removal sortie hors transaction (radiation, offre, échange) : quantité et coût ramenés à zéro, sans résultat réalisé
     Une nouvelle acquisition après une vente totale ouvre un nouveau cycle (position économique distincte).
     --------------------------------------------------------------- */
  const RANK = { split: 0, buy: 1, grant: 1, sell: 2, retire: 2, removal: 3 };
  const orderKey = (a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : (a.time || '') < (b.time || '') ? -1 : (a.time || '') > (b.time || '') ? 1 : (RANK[a.type] || 0) - (RANK[b.type] || 0));
  function run(entries) {
    const sorted = entries.map((e, i) => ({ e, i })).sort((a, b) => orderKey(a.e, b.e) || a.i - b.i).map((x) => x.e);
    let qty = 0, cost = 0, realized = 0, realizedKnown = true, costUnknown = 0, negative = false, hasSell = false, cycle = 0, splits = 0, removed = 0;
    const issues = [], rows = [];
    sorted.forEach((e) => {
      const q = Number(e.qty) || 0, row = Object.assign({}, e);
      if (e.type === 'buy') {
        if (qty <= EPS) cycle++;
        qty += q;
        if (e.amt == null) { costUnknown++; row.issue = 'Montant inconnu : prix de revient non calculable'; }
        else cost += e.amt;
        row.realized = null;
      } else if (e.type === 'grant') {                    // livraison gratuite (droits, actions gratuites, échange) : quantité +, coût inchangé
        if (qty <= EPS) cycle++;
        qty += q; row.realized = null;
      } else if (e.type === 'retire') {                   // retrait de titres sans produit (radiation, offre, échange, expiration de droits) : quantité −, coût sorti, aucun résultat réalisé
        const avg = qty > EPS ? cost / qty : 0, sold = Math.min(q, Math.max(qty, 0));
        if (q - qty > EPS) { negative = true; row.issue = 'Retrait supérieur à la quantité détenue (historique incomplet ?)'; issues.push({ date: e.date, msg: row.issue }); }
        row.costOut = r2(avg * sold); cost -= avg * sold; qty -= sold; row.realized = null; if (qty < EPS) { qty = 0; cost = 0; }
      } else if (e.type === 'split') {
        const r = Number(e.ratio);
        if (!(r > 0) || r === 1) row.issue = 'Ratio de split invalide';
        else { qty *= r; splits++; row.qtyBefore = r8(qty / r); }
        row.realized = null;
      } else if (e.type === 'removal') {
        row.removedQty = r8(qty); row.costOut = r2(cost); removed++; qty = 0; cost = 0; row.realized = null;
      } else {
        hasSell = true;
        const avg = qty > EPS ? cost / qty : 0, sold = Math.min(q, Math.max(qty, 0));
        if (q - qty > EPS) { negative = true; row.issue = 'Vente supérieure à la quantité détenue (historique incomplet ?)'; issues.push({ date: e.date, msg: row.issue }); }
        const costOut = avg * sold;
        if (e.amt != null && costUnknown === 0 && sold > 0) {
          const proceeds = e.amt * (sold / q);
          row.realized = r2(proceeds - costOut); row.realizedPct = costOut > 0 ? (proceeds - costOut) / costOut : null; row.costOut = r2(costOut);
          realized += proceeds - costOut;
        } else { row.realized = null; realizedKnown = false; }
        cost -= costOut; qty -= sold;
        if (qty < EPS) { qty = 0; cost = 0; }
      }
      qty = r8(qty);
      row.cycle = cycle || 1; row.qtyAfter = qty; row.costAfter = r2(cost); row.pruAfter = qty > EPS && costUnknown === 0 ? cost / qty : null;
      rows.push(row);
    });
    return { rows, qty, cost: r2(cost), pru: qty > EPS && costUnknown === 0 ? cost / qty : null, realized: r2(realized), realizedKnown: hasSell ? realizedKnown : true, costUnknown, negative, issues, cycles: cycle, splits, removed,
      first: sorted.length ? sorted[0].date : null, last: sorted.length ? sorted[sorted.length - 1].date : null };
  }

  /* Facteur de fractionnement : produit des splits postérieurs à une date (ex. 10:1 → 10). */
  function splitFactor(splits, dateISO) { let f = 1; (splits || []).forEach((s) => { if (s && s.date > dateISO && s.ratio > 0) f *= s.ratio; }); return f; }

  /* ---------------------------------------------------------------
     INSTRUMENTS : clé, rapprochement, entrées du grand livre
     --------------------------------------------------------------- */
  const isNameKey = (k) => k.slice(0, 2) === 'N:';          // (un ISIN néerlandais commence aussi par « N »)
  function holdingIsin(h) { return String(h.isin || (isISIN(h.ticker) ? h.ticker : '') || '').toUpperCase(); }
  /* ISIN → ISIN canonique (changement d'ISIN / fusion validés par l'utilisateur). */
  function canon(alias, isin) { let k = isin, n = 0; while (alias && alias[k] && n++ < 10) k = alias[k]; return k; }
  const instKey = (o, alias) => (o.isin ? canon(alias, o.isin) : 'N:' + norm(o.name));
  function findExisting(state, key, name, account) {
    const nn = norm(name), isIsin = !isNameKey(key);
    const hit = (list, kind) => {
      const l = (list || []).filter((x) => !account || x.account === account);
      let f = isIsin ? l.find((x) => canon(state.isinAlias, holdingIsin(x)) === key) : null;
      if (!f && nn) f = l.find((x) => norm(x.name) === nn && (!isIsin || !holdingIsin(x) || canon(state.isinAlias, holdingIsin(x)) === key));
      return f ? { kind, ref: f } : null;
    };
    return hit(state.holdings, 'holding') || hit(state.archive, 'archive');
  }
  const priceClose = (a, b) => Math.abs(a - b) <= Math.max(1e-4, Math.abs(b) * 1e-4);
  const qtyEq = (a, b) => Math.abs(a - b) <= 1e-6 * Math.max(1, Math.abs(b));

  /* Montant d'une opération dans la devise du compte : montant enregistré, sinon quantité × prix ± frais ; INCONNU (null) si le prix n'a pas été saisi (jamais 0 par défaut). */
  function txAmount(t) {
    if (t.amountAcct != null && t.amountAcct !== '') return Number(t.amountAcct);
    if (t.price == null || t.price === '' || !isFinite(Number(t.price))) return null;
    return t.type === 'buy' ? Number(t.qty) * Number(t.price) + Number(t.fees || 0) : Number(t.qty) * Number(t.price) - Number(t.fees || 0);
  }
  /* Opérations sur titres validées (state.corp) d'un instrument → entrées du grand livre. */
  function corpEntries(state, isin) {
    return (state.corp || []).filter((c) => c.validated !== false && isin && c.isin === isin).map((c) => ({ date: c.date, time: '', type: c.kind, qty: 0, ratio: c.ratio, amt: null, corpId: c.id, source: c.source }));
  }
  /* Entrées du grand livre d'un actif enregistré : ses transactions + ses opérations sur titres. Montants dans UNE devise (celle de la première opération). */
  function entriesFor(state, inst) {
    const txs = (state.transactions || []).filter((t) => t.holdingId === inst.id && (t.type === 'buy' || t.type === 'sell') && t.date);
    const cc = (t) => t.acctCur || t.currency || 'EUR';
    const first = txs.slice().sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))[0], cur = first ? cc(first) : 'EUR';
    const entries = txs.map((t) => {
      const amt = cc(t) !== cur ? null : txAmount(t);
      return { id: t.id, date: t.date, time: t.time || '', type: t.corp ? (t.type === 'buy' ? 'grant' : 'retire') : t.type, qty: Number(t.qty), amt: t.corp ? 0 : amt, fees: Number(t.fees || 0), tx: t };
    }).concat(corpEntries(state, holdingIsin(inst)));
    return { entries, cur, txs };
  }

  /* Positions réelles de référence : relevé de portefeuille DEGIRO chargé (mode « file ») ou, à défaut, positions saisies / importées
     directement (non calculées par l'import d'historique) du même portefeuille (mode « app »). */
  function referenceOf(state, account, force) {
    const rf = state.reference;
    if (force === 'none') return { mode: null, map: new Map() };
    if (force !== 'app' && rf && rf.positions && rf.positions.length && (!account || !rf.account || rf.account === account)) { const map = new Map(); rf.positions.forEach((p) => map.set(p.isin, p)); return { mode: 'file', map, at: rf.at }; }
    const hs = (state.holdings || []).filter((h) => h.derived !== true && (!account || h.account === account));
    if (hs.length) { const map = new Map(); hs.forEach((h) => { const i = holdingIsin(h); if (i) map.set(canon(state.isinAlias, i), { isin: i, name: h.name, qty: Number(h.quantity) || 0 }); }); if (map.size) return { mode: 'app', map }; }
    return { mode: null, map: new Map() };
  }

  /* Verdict sur un instrument d'après son grand livre : peut-il être une position actuelle ? Jamais deviné. */
  function verdict(led, key, ref) {
    if (led.negative) return { code: 'negative', msg: 'Solde négatif : ventes supérieures aux achats connus. Causes probables : split ou regroupement absent du CSV, changement d\'ISIN, historique incomplet.' };
    if (led.qty <= EPS) return { code: 'closed' };
    if (ref && ref.map.size && !isNameKey(key)) {
      const r = ref.map.get(key);
      if (!r) return { code: 'unreferenced', msg: 'Quantité calculée ' + led.qty + ' mais cet actif ne figure pas dans vos positions réelles. Causes probables : changement d\'ISIN, fusion, radiation, vente non visible dans le CSV.' };
      if (ref.mode === 'file' && !qtyEq(r.qty, led.qty)) return { code: 'qty_mismatch', msg: 'Quantité calculée ' + led.qty + ' ≠ position réelle ' + r.qty + '. Cause probable : split ou regroupement absent du CSV.', refQty: r.qty };
    }
    return { code: 'open' };
  }

  /* ---------------------------------------------------------------
     PLAN D'IMPORT
     opt : { account, reference (référenceOf), corp (opérations sur titres en attente), alias }
     --------------------------------------------------------------- */
  function plan(state, ops, opt) {
    opt = opt || {};
    const account = opt.account, txs = state.transactions || [];
    const alias = Object.assign({}, state.isinAlias || {}, opt.alias || {}), ref = opt.reference || referenceOf(state, account);
    const st2 = Object.assign({}, state, { isinAlias: alias, corp: (state.corp || []).concat(opt.corp || []) });
    const byExt = new Set(txs.filter((t) => t.extId).map((t) => t.extId));
    const groups = {}, order = [];
    ops.forEach((o) => { const k = instKey(o, alias); if (!groups[k]) { groups[k] = []; order.push(k); } groups[k].push(o); });
    const instruments = order.map((key) => {
      const list = groups[key], last = list.slice().sort(orderKey).pop();
      const name = (list.find((o) => o.name) || {}).name || '';
      const found = findExisting(st2, key, name, account), refObj = found ? found.ref : null;
      const existing = refObj ? txs.filter((t) => t.holdingId === refObj.id && (t.type === 'buy' || t.type === 'sell')) : [];
      const used = new Set();
      const dupOps = [], newOps = [];
      list.forEach((o) => {
        if (byExt.has(o.extId)) { dupOps.push(o); return; }
        // même opération déjà saisie autrement (autre source) : comparaison un pour un, jamais « même jour = doublon »
        const j = existing.findIndex((t, idx) => !used.has(idx) && t.date === o.date && t.type === o.type && Math.abs(Number(t.qty) - o.qty) < EPS && priceClose(Number(t.price), o.price));
        if (j >= 0) { used.add(j); dupOps.push(o); } else newOps.push(o);
      });
      const fileIds = new Set(list.map((o) => o.extId)), cur0 = last.acctCur;
      // historique connu = opérations du fichier + opérations déjà enregistrées que ce fichier ne contient pas (autre source, ancien export)
      const extra = existing.filter((t, idx) => !used.has(idx) && !(t.extId && fileIds.has(t.extId))).map((t) => ({ date: t.date, time: t.time || '', type: t.corp ? (t.type === 'buy' ? 'grant' : 'retire') : t.type, qty: Number(t.qty), amt: (t.acctCur || t.currency) === cur0 ? txAmount(t) : null, fees: Number(t.fees || 0), line: 'enregistrée' }));
      const entries = list.map((o) => ({ date: o.date, time: o.time, type: o.zero ? (o.type === 'buy' ? 'grant' : 'retire') : o.type, qty: o.qty, amt: o.amt, fees: o.fees, extId: o.extId, price: o.price, priceCur: o.priceCur, line: o.line }))
        .concat(extra, corpEntries(st2, isNameKey(key) ? '' : key));
      const led = run(entries);
      const inst = { key, isin: isNameKey(key) ? '' : key, name, ops: list, newOps, dupOps, led, include: true, ref: found, currency: last.priceCur, acctCur: last.acctCur, venue: last.venue || '',
        status: 'check', reasons: [], fill: {}, divergence: null, pruDiff: null, first: led.first, last: led.last, check: null, extraKnown: extra.length };
      inst.warnCount = list.filter((o) => o.warn && o.warn.length).length;
      const v = verdict(led, key, ref); inst.verdict = v;
      if (v.code === 'negative' || v.code === 'unreferenced' || v.code === 'qty_mismatch') { inst.check = { code: v.code, msg: v.msg }; inst.reasons.push(v.msg); }
      if (!found) {
        if (v.code === 'open') { inst.status = 'create'; if (led.pru == null) inst.reasons.push('Prix de revient non calculable (montants manquants sur certaines lignes) : la position sera créée sans PRU.'); }
        else if (v.code === 'closed') inst.status = 'closed';
        else inst.status = 'check';                       // rien n'est ajouté au portefeuille actuel ; les opérations sont conservées « à vérifier »
        return inst;
      }
      if (found.kind === 'archive') { inst.status = v.code === 'open' ? 'reopen' : 'archive'; return inst; }
      // Position déjà dans l'application : jamais modifiée sans choix explicite
      const h = found.ref, hq = Number(h.quantity) || 0;
      inst.status = 'holding';
      const qtyOk = qtyEq(led.qty, hq);
      if (h.derived === true && !h.manual && v.code === 'open') {          // position calculée par l'import : recalculée depuis les transactions (jamais une position saisie ou corrigée à la main)
        inst.recompute = !qtyOk || (led.pru != null && !(Math.abs((Number(h.avgCost) || 0) - led.pru) < 1e-4));
        if (inst.recompute) inst.update = { from: hq, to: led.qty, pruFrom: Number(h.avgCost) || null, pruTo: led.pru };
      } else if (!qtyOk) inst.divergence = { app: hq, file: led.qty, diff: r8(led.qty - hq) };
      const hAvg = Number(h.avgCost) > 0 ? Number(h.avgCost) : null, hCostCur = h.costCurrency || h.currency || 'EUR';
      if (hAvg == null && led.pru != null && qtyOk && !inst.recompute) inst.fill.avgCost = { value: led.pru, cur: inst.acctCur };
      if (!inst.recompute && hAvg != null && led.pru != null && hCostCur === inst.acctCur && qtyOk && Math.abs(hAvg - led.pru) > Math.max(0.005, hAvg * 0.002)) inst.pruDiff = { app: hAvg, file: led.pru, cur: inst.acctCur };
      if (!h.isin && inst.isin) inst.fill.isin = inst.isin;
      if (!h.name && name) inst.fill.name = name;
      if (existing.length && existing.reduce((s, t) => s + (t.type === 'buy' ? 1 : -1) * Number(t.qty || 0), 0) !== hq && newOps.length) inst.reasons.push('Historique existant incomplet : les opérations manquantes seront ajoutées.');
      return inst;
    });
    const sum = (f) => instruments.reduce((s, i) => s + f(i), 0);
    const inc = instruments.filter((i) => i.include);
    const totals = {
      detected: ops.length,
      newTx: inc.reduce((s, i) => s + i.newOps.length, 0),
      dups: sum((i) => i.dupOps.length),
      newPositions: inc.filter((i) => i.status === 'create' || i.status === 'reopen').length,
      keptPositions: instruments.filter((i) => i.status === 'holding').length,
      closed: inc.filter((i) => i.status === 'closed').length,
      archived: instruments.filter((i) => i.status === 'archive').length,
      check: inc.filter((i) => i.status === 'check' || (i.status === 'archive' && i.check)).length,
      review: sum((i) => i.warnCount),
      divergences: instruments.filter((i) => i.divergence).length,
      fills: instruments.filter((i) => i.status === 'holding' && (i.fill.avgCost || i.fill.isin || i.fill.name)).length,
      recomputed: instruments.filter((i) => i.recompute).length
    };
    return { instruments, totals, reference: ref };
  }

  const newHoldingFrom = (inst, led, idv, accountId) => ({ id: idv, ticker: inst.isin || inst.name, displayTicker: (inst.isin || inst.name).toUpperCase(), isin: inst.isin, name: inst.name, type: 'stock', quantity: led.qty,
    avgCost: led.pru != null ? r4(led.pru) : null, costCurrency: inst.acctCur, currency: inst.currency === 'GBX' ? 'GBP' : (inst.currency || inst.acctCur), account: accountId, logo: null, source: 'degiro', derived: true, addedAt: led.first,
    dividend: { lastAmount: null, anchorMonth: null, frequency: 'quarterly', dateKind: 'pay', none: false } });
  const archiveFrom = (inst, led, idv, accountId, check) => ({ id: idv, ticker: inst.isin || inst.name, displayTicker: (inst.isin || inst.name).toUpperCase(), isin: inst.isin, name: inst.name, currency: inst.currency === 'GBX' ? 'GBP' : (inst.currency || inst.acctCur),
    account: accountId, source: 'degiro', closedAt: led.last, firstAt: led.first, hist: null, check: check || undefined });

  /* Applique le plan (le premier argument est modifié). choices : { fill: bool, align: { clé: true }, off: { clé: true } }. */
  function apply(state, pl, choices, deps) {
    choices = choices || {}; const uid = deps.uid;
    state.holdings = state.holdings || []; state.archive = state.archive || []; state.transactions = state.transactions || []; state.corp = state.corp || [];
    const res = { tx: 0, created: [], archived: [], checked: [], filled: 0, aligned: 0, reopened: 0, skipped: 0, recomputed: 0 };
    pl.instruments.forEach((inst) => {
      if (!inst.include || (choices.off && choices.off[inst.key])) { res.skipped++; return; }
      const led = inst.led;
      let id, label = inst.name || inst.isin, tickerLabel;
      const accountId = deps.account;
      if (inst.status === 'create') { const h = newHoldingFrom(inst, led, uid(), accountId); state.holdings.push(h); id = h.id; tickerLabel = h.displayTicker; res.created.push(h); }
      else if (inst.status === 'reopen') {
        const a = inst.ref.ref, h = newHoldingFrom(inst, led, a.id, accountId); Object.assign(h, { logo: a.logo || null, hist: a.hist, splits: a.splits, ticker: a.ticker || h.ticker, displayTicker: a.displayTicker || h.displayTicker, currency: a.currency || h.currency });
        state.archive = state.archive.filter((x) => x.id !== a.id); state.holdings.push(h); id = h.id; tickerLabel = h.displayTicker; res.created.push(h); res.reopened++;
      } else if (inst.status === 'closed' || inst.status === 'check') {
        const a = archiveFrom(inst, led, uid(), accountId, inst.check); state.archive.push(a); id = a.id; tickerLabel = a.displayTicker; (inst.status === 'check' ? res.checked : res.archived).push(a);
      } else if (inst.status === 'archive') {
        const a = inst.ref.ref; id = a.id; tickerLabel = a.displayTicker;
        if (inst.check) a.check = inst.check; else delete a.check; a.closedAt = led.last; a.firstAt = led.first;
      } else {                                                  // position existante : jamais écrasée, sauf compléments / alignement choisis
        const h = inst.ref.ref; id = h.id; tickerLabel = h.displayTicker || h.ticker;
        if (choices.fill !== false) {
          let n = 0;
          if (inst.fill.avgCost && !(Number(h.avgCost) > 0)) { h.avgCost = r4(inst.fill.avgCost.value); h.costCurrency = inst.fill.avgCost.cur; n++; }
          if (inst.fill.isin && !h.isin) { h.isin = inst.fill.isin; n++; }
          if (inst.fill.name && !h.name) { h.name = inst.fill.name; n++; }
          if (n) res.filled++;
        }
        if (inst.recompute && led.qty > EPS && !(choices.noRecompute)) { h.quantity = led.qty; if (led.pru != null) { h.avgCost = r4(led.pru); h.costCurrency = inst.acctCur; } res.recomputed = (res.recomputed || 0) + 1; }
        if (choices.align && choices.align[inst.key] && led.qty > EPS) { h.quantity = led.qty; if (led.pru != null) { h.avgCost = r4(led.pru); h.costCurrency = inst.acctCur; } h.derived = true; delete h.manual; res.aligned++; }
      }
      inst.newOps.forEach((o) => {
        state.transactions.push({ id: uid(), holdingId: id, ticker: tickerLabel, name: inst.name || label, isin: inst.isin || undefined, date: o.date, time: o.time || undefined, type: o.type, qty: o.qty, price: o.price, fees: o.fees == null ? 0 : o.fees, feesCur: o.acctCur,
          currency: o.priceCur, amountAcct: o.amt, acctCur: o.acctCur, fxRate: o.fxRate == null ? undefined : o.fxRate, orderId: o.orderId || undefined, venue: o.venue || undefined, exchange: o.exchange || undefined, corp: o.zero ? true : undefined, warn: o.warn && o.warn.length ? o.warn : undefined, source: 'degiro', extId: o.extId });
        res.tx++;
      });
    });
    // opérations sur titres validées pendant l'import
    (deps.corp || []).forEach((c) => { if (!state.corp.some((x) => x.isin === c.isin && x.date === c.date && x.kind === c.kind && x.ratio === c.ratio)) state.corp.push(Object.assign({ id: uid() }, c)); });
    return res;
  }

  /* ---------------------------------------------------------------
     RÉÉVALUATION D'UN ACTIF (après validation d'un split, fusion d'ISIN, sortie, nouvelle référence…)
     Les positions calculées par l'import (derived) sont RECALCULÉES depuis les transactions validées ; une position saisie ou modifiée à la main
     (derived absent ou manual) n'est jamais touchée. Les identifiants sont conservés : l'historique reste relié.
     --------------------------------------------------------------- */
  function reevaluate(state, id, deps) {
    const h = (state.holdings || []).find((x) => x.id === id), a = (state.archive || []).find((x) => x.id === id), inst = h || a;
    const out = { id, changed: false, to: null };
    if (!inst) return out;
    const key = holdingIsin(inst) ? canon(state.isinAlias, holdingIsin(inst)) : 'N:' + norm(inst.name);
    const { entries, cur } = entriesFor(state, inst), led = run(entries), ref = referenceOf(state, inst.account), v = verdict(led, key, ref);
    out.led = led; out.verdict = v;
    if (h) {
      if (h.derived !== true || h.manual) return out;
      if (v.code === 'open') {
        if (!qtyEq(h.quantity, led.qty) || (led.pru != null && !(Math.abs((h.avgCost || 0) - led.pru) < 1e-4))) { h.quantity = led.qty; if (led.pru != null) { h.avgCost = r4(led.pru); h.costCurrency = cur; } out.changed = true; }
      } else {
        const arch = { id: h.id, ticker: h.ticker, displayTicker: h.displayTicker, isin: h.isin, name: h.name, currency: h.currency, account: h.account, source: h.source || 'degiro', closedAt: led.last, firstAt: led.first, hist: h.hist || null, splits: h.splits, logo: h.logo || null, marketAt: h.hist ? deps.today : undefined,
          check: v.code === 'closed' ? undefined : { code: v.code, msg: v.msg } };
        state.holdings = state.holdings.filter((x) => x.id !== h.id); state.archive.push(arch); out.changed = true; out.to = 'archive';
      }
    } else {
      if (v.code === 'open') {
        const nh = newHoldingFrom({ isin: a.isin, name: a.name, acctCur: cur, currency: a.currency }, led, a.id, a.account);
        Object.assign(nh, { logo: a.logo || null, hist: a.hist, splits: a.splits, ticker: a.ticker || nh.ticker, displayTicker: a.displayTicker || nh.displayTicker, currency: a.currency || nh.currency });
        state.archive = state.archive.filter((x) => x.id !== a.id); state.holdings.push(nh); out.changed = true; out.to = 'holding';
      } else {
        const chk = v.code === 'closed' ? undefined : { code: v.code, msg: v.msg };
        if (JSON.stringify(a.check || null) !== JSON.stringify(chk || null)) { if (chk) a.check = chk; else delete a.check; out.changed = true; }
        a.closedAt = led.last; a.firstAt = led.first;
      }
    }
    return out;
  }

  /* Opération sur titres validée par l'utilisateur : enregistrée explicitement, puis l'actif est réévalué. */
  function addCorp(state, c, deps) {
    state.corp = state.corp || [];
    if (state.corp.some((x) => x.isin === c.isin && x.date === c.date && x.kind === c.kind && x.ratio === c.ratio)) return { added: false };
    state.corp.push(Object.assign({ id: deps.uid(), validated: true, at: deps.today }, c));
    const ids = (state.holdings || []).concat(state.archive || []).filter((x) => canon(state.isinAlias, holdingIsin(x)) === canon(state.isinAlias, c.isin)).map((x) => x.id);
    return { added: true, results: ids.map((id) => reevaluate(state, id, deps)) };
  }
  /* Changement d'ISIN / fusion : les transactions de « from » rejoignent « to » ; les imports futurs rattachent l'ancien ISIN au nouveau. */
  function mergeInstruments(state, fromId, toId, deps) {
    const from = (state.holdings || []).concat(state.archive || []).find((x) => x.id === fromId), to = (state.holdings || []).concat(state.archive || []).find((x) => x.id === toId);
    if (!from || !to || from.id === to.id) return { ok: false, error: 'Actifs invalides.' };
    if ((state.holdings || []).includes(from) && (from.derived !== true || from.manual)) return { ok: false, error: 'Cette position a été saisie ou modifiée à la main : elle n\'est pas fusionnée automatiquement.' };
    const fi = holdingIsin(from), ti = holdingIsin(to);
    if (!fi || !ti) return { ok: false, error: 'Les deux actifs doivent avoir un ISIN.' };
    state.isinAlias = state.isinAlias || {}; state.isinAlias[fi] = ti;
    (state.transactions || []).forEach((t) => { if (t.holdingId === from.id) { t.holdingId = to.id; t.ticker = to.displayTicker || to.ticker; t.mergedFrom = fi; } });
    (state.corp || []).forEach((c) => { if (c.isin === fi) c.isin = ti; });
    state.holdings = (state.holdings || []).filter((x) => x.id !== from.id); state.archive = (state.archive || []).filter((x) => x.id !== from.id);
    return { ok: true, result: reevaluate(state, to.id, deps) };
  }
  /* Position calculée → archive (sans rien supprimer) : uniquement pour une position issue de l'import. */
  function demote(state, id, code, msg, deps) {
    const h = (state.holdings || []).find((x) => x.id === id); if (!h) return { ok: false };
    if (h.derived !== true) return { ok: false, error: 'Cette position a été saisie à la main : elle n\'est pas archivée automatiquement.' };
    const led = run(entriesFor(state, h).entries);
    state.holdings = state.holdings.filter((x) => x.id !== h.id);
    state.archive.push({ id: h.id, ticker: h.ticker, displayTicker: h.displayTicker, isin: h.isin, name: h.name, currency: h.currency, account: h.account, source: h.source || 'degiro', closedAt: led.last, firstAt: led.first, hist: h.hist || null, splits: h.splits, logo: h.logo || null, marketAt: h.hist ? deps.today : undefined, check: code ? { code, msg } : undefined, userArchived: true });
    return { ok: true };
  }
  /* Vente (partielle) ou clôture d'une position, enregistrée par l'utilisateur : prix de vente, quantité, frais, date.
     Crée une opération de vente (le résultat réalisé, la quantité restante, l'historique de valeur et les flux du portefeuille en découlent) ; le PRU des titres restants
     ne change pas. Position saisie sans historique d'achats : une opération « d'ouverture » reprend la quantité détenue au PRU saisi (date d'achat facultative ; à défaut la
     date d'ajout dans l'application : le suivi démarre là, rien n'est inventé au-delà). Vente totale → la position quitte le portefeuille actuel (archive « clôturées »). */
  function recordSale(state, id, sale, deps) {
    const err = (error) => ({ ok: false, error });
    const h = (state.holdings || []).find((x) => x.id === id); if (!h) return err('Position introuvable.');
    const qBefore = Number(h.quantity) || 0, q = Number(sale.qty), price = Number(sale.price), fees = Number(sale.fees) || 0, tol = 1e-6 * Math.max(1, qBefore);
    if (!(q > 0)) return err('Quantité vendue invalide.'); if (q - qBefore > tol) return err('La quantité vendue (' + q + ') dépasse la quantité détenue (' + qBefore + ').');
    if (!(price > 0)) return err('Indiquez le prix de vente par titre.'); if (fees < 0) return err('Frais invalides.');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(sale.date || '')) || sale.date > deps.today) return err('Date de vente invalide (vide ou dans le futur).');
    const cur = h.currency || 'EUR', costCur = h.costCurrency || cur, warnings = [];
    const txs = (state.transactions || []).filter((t) => t.holdingId === h.id && (t.type === 'buy' || t.type === 'sell'));
    const ids = { ticker: h.displayTicker || h.ticker, name: h.name || '', isin: h.isin || '' };
    let opening = null;
    if (!txs.length) {
      const pru = Number(sale.pru != null && sale.pru !== '' ? sale.pru : h.avgCost);
      if (!(pru > 0)) return err('Prix de revient inconnu : indiquez-le pour calculer le résultat réalisé.');
      const added = h.addedAt ? String(h.addedAt).slice(0, 10) : '', od = sale.buyDate && sale.buyDate <= sale.date ? sale.buyDate : (added && added < sale.date ? added : sale.date);
      opening = Object.assign({ id: deps.uid(), holdingId: h.id, date: od, time: '', type: 'buy', qty: qBefore, price: pru, fees: 0, currency: costCur, amountAcct: r2(qBefore * pru), acctCur: costCur, source: 'manual', opening: true, approx: !sale.buyDate }, ids);
    } else {
      const led = run(entriesFor(state, h).entries);
      if (Math.abs(led.qty - qBefore) > tol) warnings.push('L\'historique d\'opérations de cette position (' + led.qty + ' titre(s)) ne correspond pas à la quantité enregistrée (' + qBefore + ') : à contrôler dans « Contrôle de l\'historique ».');
    }
    let amountAcct, acctCur;
    if (costCur === cur) { amountAcct = r2(q * price - fees); acctCur = cur; }
    else if (Number(sale.proceedsCost) > 0) { amountAcct = r2(Number(sale.proceedsCost)); acctCur = costCur; }
    else warnings.push('Le prix de vente est en ' + cur + ' et le prix de revient en ' + costCur + ' : sans le produit net en ' + costCur + ', le résultat réalisé n\'est pas calculable.');
    const sell = Object.assign({ id: deps.uid(), holdingId: h.id, date: sale.date, time: '', type: 'sell', qty: q, price, fees, currency: cur, amountAcct, acctCur, source: 'manual' }, ids);
    if (opening) state.transactions.push(opening); state.transactions.push(sell);
    const remaining = r8(qBefore - q); let closed = false, inst = h;
    if (remaining <= 1e-8) {
      closed = true; state.holdings = state.holdings.filter((x) => x.id !== h.id); state.archive = state.archive || [];
      inst = { id: h.id, ticker: h.ticker, displayTicker: h.displayTicker, isin: h.isin, name: h.name, currency: h.currency, account: h.account, source: h.source || 'manual', closedAt: sale.date, hist: h.hist || null, splits: h.splits, logo: h.logo || null, marketAt: h.hist ? deps.today : undefined, userClosed: true, exitPrice: price };
      state.archive.push(inst);
    } else h.quantity = remaining;
    const led2 = run(entriesFor(state, inst).entries), row = led2.rows.filter((r) => r.type === 'sell').pop();
    return { ok: true, closed, remaining: closed ? 0 : remaining, realized: row ? row.realized : null, realizedPct: row ? row.realizedPct : null, cur: costCur, warnings, openingAdded: !!opening };
  }

  /* ---------------------------------------------------------------
     ACHATS SAISIS À LA MAIN (plusieurs achats pour une même action : date + nombre d'actions, prix et frais facultatifs)
     Ils alimentent le grand livre : quantité détenue à chaque date (dividendes réellement éligibles), coût et performance. Ils ne modifient JAMAIS la quantité
     ni le prix de revient actuels de la position ; un écart avec la quantité détenue est signalé, pas corrigé.
     --------------------------------------------------------------- */
  function purchaseSummary(state, h) {
    const { entries, cur, txs } = entriesFor(state, h), led = run(entries), cq = Number(h.quantity) || 0;
    const rows = txs.slice().sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0)).map((t) => ({ id: t.id, date: t.date, type: t.corp ? (t.type === 'buy' ? 'grant' : 'retire') : t.type, qty: Number(t.qty), price: t.price == null || t.price === '' ? null : Number(t.price), fees: Number(t.fees || 0), source: t.source || 'manual', opening: !!t.opening, manual: (t.source || 'manual') === 'manual' || !!t.opening }));
    const buys = rows.filter((r) => r.type === 'buy'), withPrice = buys.filter((r) => r.price > 0);
    const pruCalc = withPrice.length === buys.length && buys.length ? buys.reduce((a, r) => a + r.qty * r.price + r.fees, 0) / buys.reduce((a, r) => a + r.qty, 0) : null;
    const diff = r8(cq - led.qty);
    return { rows, ledgerQty: led.qty, holdingQty: cq, diff, consistent: Math.abs(diff) <= 1e-6 * Math.max(1, cq) && !led.negative, negative: led.negative, pruCalc, costKnown: led.costUnknown === 0, cur };
  }
  function addPurchase(state, id, p, deps) {
    const err = (error) => ({ ok: false, error });
    const h = (state.holdings || []).find((x) => x.id === id); if (!h) return err('Position introuvable.');
    const qty = Number(p.qty), price = p.price == null || p.price === '' ? null : Number(p.price), fees = Number(p.fees) || 0;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(p.date || '')) || p.date > deps.today) return err('Date d\'achat invalide (vide ou dans le futur).');
    if (!(qty > 0)) return err('Indiquez le nombre d\'actions achetées.'); if (price !== null && !(price > 0)) return err('Prix par action invalide (laissez vide si inconnu).'); if (fees < 0) return err('Frais invalides.');
    const cur = h.currency || 'EUR'; const tx = { id: deps.uid(), holdingId: h.id, date: p.date, time: '', type: 'buy', qty, price, fees, currency: cur, amountAcct: price === null ? null : r2(qty * price + fees), acctCur: cur, source: 'manual', ticker: h.displayTicker || h.ticker, name: h.name || '', isin: h.isin || '' };
    state.transactions = state.transactions || []; state.transactions.push(tx); return { ok: true, id: tx.id };
  }
  function removePurchase(state, txId) {
    const i = (state.transactions || []).findIndex((t) => t.id === txId); if (i < 0) return { ok: false, error: 'Opération introuvable.' };
    const t = state.transactions[i]; if ((t.source || 'manual') !== 'manual' && !t.opening) return { ok: false, error: 'Opération importée du courtier : elle ne se supprime pas ici.' };
    state.transactions.splice(i, 1); return { ok: true };
  }

  /* Archive → position actuelle sur décision de l'utilisateur (quantité et PRU recalculés). */
  function promote(state, id, deps) {
    const a = (state.archive || []).find((x) => x.id === id); if (!a) return { ok: false };
    const { entries, cur } = entriesFor(state, a), led = run(entries);
    if (led.qty <= EPS) return { ok: false, error: 'La quantité calculée est nulle : rien à ajouter. Corrigez l\'historique d\'abord.' };
    const nh = newHoldingFrom({ isin: a.isin, name: a.name, acctCur: cur, currency: a.currency }, led, a.id, a.account);
    Object.assign(nh, { logo: a.logo || null, hist: a.hist, splits: a.splits, ticker: a.ticker || nh.ticker, displayTicker: a.displayTicker || nh.displayTicker, currency: a.currency || nh.currency, userPromoted: true });
    state.archive = state.archive.filter((x) => x.id !== a.id); state.holdings.push(nh);
    return { ok: true };
  }

  /* Relevé de portefeuille DEGIRO (positions réelles) : [{ isin, name, qty, cur }]. */
  function parsePositions(rows) {
    const h = findHeaderRow(rows); if (h < 0) return { positions: [], error: 'En-têtes non reconnus (attendus : produit, ISIN, quantité).' };
    const head = rows[h], c = {}; head.forEach((cell, i) => { const r = roleOf(cell); if (r && c[r] === undefined) c[r] = i; });
    if (c.isin === undefined || c.qty === undefined) return { positions: [], error: 'Colonnes ISIN et quantité introuvables.' };
    const body = rows.slice(h + 1), dec = inferDecimal([].concat.apply([], body.slice(0, 300).map((r) => [r[c.qty]])));
    const positions = [], skipped = [];
    body.forEach((r, i) => {
      const isin = String(r[c.isin] || '').trim().toUpperCase(), q = parseNumber(r[c.qty], dec), name = c.product !== undefined ? String(r[c.product] || '').trim() : '';
      if (!isISIN(isin)) { if (name) skipped.push(name); return; }
      if (isNaN(q)) { skipped.push(name || isin); return; }
      const ex = positions.find((p) => p.isin === isin); if (ex) ex.qty = r8(ex.qty + q); else positions.push({ isin, name, qty: r8(q), cur: c.currency !== undefined ? String(r[c.currency] || '').trim() : '' });
    });
    return { positions: positions.filter((p) => p.qty > 0), skipped };
  }

  /* ---------------------------------------------------------------
     DIAGNOSTIC : anomalies de l'historique enregistré. Chaque anomalie : actif, transactions, cause probable, action recommandée.
     Rien n'est corrigé ici : les corrections incertaines restent à la main de l'utilisateur.
     --------------------------------------------------------------- */
  function diagnose(state, o) {
    o = o || {}; const today = o.today || new Date().toISOString().slice(0, 10);
    const items = [], rows = [], alias = state.isinAlias || {};
    const insts = (state.holdings || []).map((h) => ({ h, kind: 'holding' })).concat((state.archive || []).map((h) => ({ h, kind: 'archive' })));
    const push = (it) => items.push(Object.assign({ level: 'warn', txIds: [], act: [] }, it));
    insts.forEach(({ h, kind }) => {
      const isin = holdingIsin(h), key = isin ? canon(alias, isin) : 'N:' + norm(h.name), ref = referenceOf(state, h.account);
      const { entries, cur, txs } = entriesFor(state, h);
      if (kind === 'holding' && !h.derived) {      // quantité saisie / importée à plat : une année lue comme un nombre (« 2026 ») ou un écart avec la position réelle ne se corrige jamais seul
        const q0 = Number(h.quantity) || 0, r0 = ref.mode === 'file' ? ref.map.get(key) : null, looksYear = Number.isInteger(q0) && q0 >= 1900 && q0 <= 2100;
        if (looksYear && !(r0 && qtyEq(r0.qty, q0))) push({ instId: h.id, isin, name: h.name || h.displayTicker || isin, level: 'error', code: 'qty_year', cause: 'Quantité ' + q0 + ' : ressemble à une année (une date a peut-être été lue comme un nombre lors d\'un import). Les valeurs, le poids et le rendement de cet actif sont faussés.',
          action: r0 ? 'Remplacer par la position réelle (' + r0.qty + ') ou corriger à la main.' : 'Corriger la quantité à la main (aucune position réelle de référence chargée).', act: r0 ? ['set_ref_qty', 'edit'] : ['edit'], refQty: r0 ? r0.qty : null });
        else if (r0 && ref.mode === 'file' && !txs.length && !qtyEq(r0.qty, q0)) push({ instId: h.id, isin, name: h.name || h.displayTicker || isin, level: 'warn', code: 'qty_vs_ref', cause: 'Quantité enregistrée ' + q0 + ' ≠ position réelle du relevé DEGIRO (' + r0.qty + ').',
          action: 'Remplacer par la position réelle ou corriger à la main : rien n\'est modifié sans votre accord.', act: ['set_ref_qty', 'edit'], refQty: r0.qty });
      }
      if (!txs.length && !(kind === 'holding' && h.derived)) {
        if (kind === 'holding') { const r = ref.map.get(key); rows.push({ id: h.id, isin, name: h.name || h.displayTicker, kind, app: Number(h.quantity) || 0, calc: null, ref: r ? r.qty : null, tx: 0, ok: null }); }
        return;
      }
      const led = run(entries), r = ref.map.get(key), base = { instId: h.id, isin, name: h.name || h.displayTicker || isin };
      const hq = kind === 'holding' ? Number(h.quantity) || 0 : 0;
      rows.push({ id: h.id, isin, name: base.name, kind, app: hq, calc: led.qty, ref: r ? r.qty : null, tx: txs.length, ok: led.negative ? false : (kind === 'holding' ? (qtyEq(led.qty, hq) && (!r || ref.mode !== 'file' || qtyEq(r.qty, led.qty))) : (led.qty <= EPS || !!h.check ? null : false)) });
      if (led.negative) {
        const t = txs.filter((x) => x.type === 'sell').map((x) => x.id);
        push(Object.assign({}, base, { level: 'error', code: 'negative', txIds: t, cause: 'Quantité calculée négative : les ventes dépassent les achats connus. Causes probables : split ou regroupement non présent dans le CSV, changement d\'ISIN (l\'achat est sous l\'ancien ISIN), historique incomplet.',
          action: 'Rechercher un split (Yahoo), fusionner avec l\'ancien ou le nouvel ISIN, ou marquer une sortie hors transaction.', act: ['search_split', 'manual_split', 'alias', 'removal'] }));
      }
      if (kind === 'holding') {
        if (h.derived && led.qty <= EPS && !led.negative) push(Object.assign({}, base, { code: 'zero_held', cause: 'Quantité calculée nulle (position entièrement vendue) mais l\'actif figure encore dans le portefeuille actuel.', action: 'Archiver : la position quitte le portefeuille actuel, ses opérations restent dans l\'historique.', act: ['archive'] }));
        if (ref.map.size && isin && !r && h.derived) push(Object.assign({}, base, { level: 'error', code: 'not_in_ref', cause: 'Position calculée à partir de l\'historique, absente de vos positions réelles. Causes probables : ancienne position (changement d\'ISIN, fusion, radiation), vente ou split non visibles dans le CSV.',
          action: 'Archiver cette position (rien n\'est supprimé), ou la fusionner avec l\'ISIN actuel.', act: ['archive', 'alias', 'removal'] }));
        if (r && !led.negative && led.qty > EPS && !qtyEq(led.qty, r.qty)) push(Object.assign({}, base, { level: 'error', code: 'qty_ref', txIds: txs.map((x) => x.id), cause: 'Quantité calculée ' + led.qty + ' ≠ position réelle ' + r.qty + '. Cause probable : split ou regroupement absent du CSV (ou transaction manquante).',
          action: 'Rechercher un split (Yahoo) ; sinon vérifier les transactions de cet actif.', act: ['search_split', 'manual_split'] }));
        else if (hq > 0 && led.qty > EPS && !qtyEq(led.qty, hq) && !led.negative && (!r || !qtyEq(r.qty, led.qty)) && h.derived && !h.manual) push(Object.assign({}, base, { code: 'qty_app', cause: 'Quantité enregistrée ' + hq + ' ≠ quantité recalculée ' + led.qty + '.', action: 'Recalculer la position à partir des transactions.', act: ['recompute'] }));
        const pr = Number(h.avgCost) > 0 ? Number(h.avgCost) : null;
        if (pr != null && led.pru != null && qtyEq(led.qty, hq) && (h.costCurrency || h.currency || 'EUR') === cur && Math.abs(pr - led.pru) > Math.max(0.005, pr * 0.002)) push(Object.assign({}, base, { code: 'pru_diff', cause: 'PRU enregistré ' + pr.toFixed(2) + ' ≠ PRU recalculé ' + led.pru.toFixed(2) + ' ' + cur + (h.derived ? '' : ' (PRU saisi à la main : conservé)') + '.',
          action: h.derived && !h.manual ? 'Recalculer la position à partir des transactions.' : 'Aucune : le PRU saisi est protégé ; aligner seulement si vous le souhaitez.', act: h.derived && !h.manual ? ['recompute'] : [] }));
      } else if (h.check && verdict(led, key, ref).code === 'open') {
        push(Object.assign({}, base, { level: 'info', code: 'promote_ok', txIds: [], cause: 'Quantité calculée ' + led.qty + ' confirmée par vos positions réelles : cet actif peut rejoindre le portefeuille actuel.', action: 'Ajouter au portefeuille actuel (quantité et PRU calculés).', act: ['promote'] }));
      } else if (h.check) push(Object.assign({}, base, { level: 'warn', code: 'check_' + h.check.code, cause: h.check.msg, txIds: txs.map((x) => x.id), action: h.check.code === 'unreferenced' ? 'Fusionner avec l\'ISIN actuel s\'il s\'agit d\'un changement d\'ISIN, marquer une sortie (radiation, offre, échange), ou l\'ajouter au portefeuille si c\'est bien une position réelle.' : h.check.code === 'qty_mismatch' ? 'Rechercher un split (Yahoo) ou en saisir un ; sinon vérifier les transactions manquantes.' : 'Rechercher un split (Yahoo), fusionner avec l\'ancien ou le nouvel ISIN, ou marquer une sortie hors transaction.', act: h.check.code === 'unreferenced' ? ['promote', 'alias', 'removal'] : ['search_split', 'manual_split', 'alias', 'removal', 'promote'] }));
      // splits connus du marché, jamais appliqués sans validation
      const first = led.first;
      const zeroMoves = txs.filter((t) => t.corp).map((t) => t.date);
      const cands = (h.splits || []).filter((s) => first && s.date >= first && s.date <= today && !zeroMoves.some((d0) => Math.abs(Date.parse(d0) - Date.parse(s.date)) < 10 * 86400000) && !(state.corp || []).some((c) => c.isin === key && c.kind === 'split' && Math.abs(Date.parse(c.date) - Date.parse(s.date)) < 5 * 86400000));
      if (cands.length && (led.negative || (r && led.qty > EPS && !qtyEq(led.qty, r.qty)) || (kind === 'archive' && h.check))) {
        const sim = run(entries.concat(cands.map((s) => ({ date: s.date, time: '', type: 'split', qty: 0, ratio: s.ratio, amt: null }))));
        const coherent = !sim.negative && (r ? qtyEq(sim.qty, r.qty) : true);
        push(Object.assign({}, base, { level: coherent ? 'info' : 'warn', code: 'split_candidate', cause: 'Split(s) trouvé(s) dans les données de marché : ' + cands.map((s) => s.ratio + ' pour 1 le ' + s.date).join(' ; ') + '. Avec ce split la quantité calculée serait ' + sim.qty + (r ? ' (position réelle : ' + r.qty + ')' : '') + (coherent ? ' : cohérent.' : ' : toujours incohérent.'),
          action: coherent ? 'Valider le split pour recalculer la quantité et le PRU (le coût total reste inchangé).' : 'Vérifier avant d\'appliquer : le split seul ne suffit pas.', act: coherent ? ['apply_split'] : ['manual_split'], splits: cands, coherent }));
      }
      const bad = txs.filter((t) => !t.date || t.amountAcct == null || (t.source === 'degiro' && !t.isin && !isin));
      if (bad.length) push(Object.assign({}, base, { code: 'tx_incomplete', txIds: bad.map((x) => x.id), cause: bad.length + ' transaction(s) sans date, sans montant ou sans ISIN : le PRU et la valorisation ne peuvent pas être calculés avec certitude.', action: 'Compléter ou supprimer ces transactions dans Historique → Opérations.' }));
      const wn = txs.filter((t) => t.warn && t.warn.length);
      if (wn.length) push(Object.assign({}, base, { level: 'info', code: 'tx_warn', txIds: wn.map((x) => x.id), cause: wn.length + ' transaction(s) importée(s) avec alerte : ' + Array.from(new Set([].concat.apply([], wn.map((x) => x.warn)))).slice(0, 3).join(' ; ') + '.', action: 'Contrôler ces lignes dans le CSV d\'origine.' }));
      if (led.cycles > 1) push(Object.assign({}, base, { level: 'info', code: 'cycles', cause: 'Position clôturée puis rachetée : ' + led.cycles + ' cycles distincts, le PRU actuel ne reprend que le dernier cycle.', action: 'Aucune.' }));
    });
    // opérations sur titres repérées dans le CSV (jamais appliquées sans validation)
    const impo = (state.imports || []).slice(-1)[0];
    ((impo && impo.report && impo.report.corp) || []).forEach((c) => {
      if (Array.isArray(c) || typeof c !== 'object' || (c.zero && (state.transactions || []).some((t) => t.corp && t.date === c.date))) return;
      const key = c.isin ? canon(alias, c.isin) : null, inst = key ? insts.find(({ h }) => canon(alias, holdingIsin(h)) === key) : null;
      if ((state.corp || []).some((x) => x.isin === key && Math.abs(Date.parse(x.date) - Date.parse(c.date)) < 5 * 86400000)) return;
      push({ level: 'warn', code: 'csv_corp', instId: inst ? inst.h.id : null, isin: c.isin || '', name: c.name || (inst && inst.h.name) || c.isin || '—', cause: 'Opération sur titres détectée dans le CSV le ' + c.date + ' : ' + c.desc + '. Elle n\'a pas été importée comme achat ou vente.',
        action: c.ratio && c.isin ? 'Valider le split ×' + c.ratio + ' si c\'en est un ; sinon saisir la nature de l\'opération.' : 'Déterminer la nature de l\'opération (split, échange, livraison gratuite) et la saisir.', act: inst ? (c.ratio && c.isin ? ['apply_split', 'manual_split'] : ['manual_split', 'alias', 'removal']) : [], splits: c.ratio && c.isin ? [{ date: c.date, ratio: c.ratio }] : undefined });
    });
    // positions réelles absentes de l'application
    const refs = referenceOf(state, o.account);
    if (refs.mode === 'file') refs.map.forEach((p, isin) => { if (!insts.some(({ h }) => canon(alias, holdingIsin(h)) === isin && (h.kind !== 'archive'))) push({ level: 'warn', code: 'ref_missing', isin, name: p.name, instId: null, cause: 'Position réelle (' + p.qty + ') absente de l\'application.', action: 'Importer l\'historique ou ajouter la position (Mon portefeuille → Importer un relevé).' }); });
    const order = { error: 0, warn: 1, info: 2 };
    items.sort((a, b) => order[a.level] - order[b.level] || String(a.name).localeCompare(String(b.name)));
    // anomalies ignorées par l'utilisateur : signature = code + actif + empreinte de la cause (si les chiffres changent, l'anomalie réapparaît)
    const hash = (str) => { let h = 5381; for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) | 0; return (h >>> 0).toString(36); };
    items.forEach((it) => { it.sig = it.code + '|' + (it.isin || it.instId || norm(it.name)) + '|' + hash(String(it.cause || '')); });
    const ign = state.ignored || {}, ignored = items.filter((it) => ign[it.sig]).map((it) => Object.assign({}, it, { ignoredAt: ign[it.sig].at || null })), kept = items.filter((it) => !ign[it.sig]);
    items.length = 0; kept.forEach((it) => items.push(it));
    const imp = (state.imports || []).slice(-1)[0] || null;
    return { items, ignored, rows, reference: { mode: refs.mode, count: refs.map.size, at: refs.at || null }, lastImport: imp ? { at: imp.at, name: imp.name, report: imp.report } : null,
      counts: { error: items.filter((i) => i.level === 'error').length, warn: items.filter((i) => i.level === 'warn').length, info: items.filter((i) => i.level === 'info').length,
        negative: rows.filter((r) => r.calc !== null && r.calc < -EPS).length, zeroHeld: items.filter((i) => i.code === 'zero_held').length } };
  }

  /* Dividendes du relevé de compte → versements : brut (ligne « Dividende »), retenue (ligne « Impôt sur dividende » du même titre et du même jour), net = brut − retenue.
     Aucune retenue n'est inventée : sans ligne d'impôt, le net reste inconnu (null). */
  function groupDividends(divs) {
    const m = new Map();
    (divs || []).forEach((d) => {
      const k = (d.isin || norm(d.name)) + '|' + d.date + '|' + d.cur;
      const g = m.get(k) || { isin: d.isin, name: d.name, date: d.date, cur: d.cur, gross: 0, tax: 0, hasTax: false, lines: [] };
      if (d.kind === 'dividend') g.gross += d.amount; else { g.tax += Math.abs(d.amount); g.hasTax = true; }
      g.lines.push(d.line); m.set(k, g);
    });
    return Array.from(m.values()).filter((g) => g.gross > 0).map((g) => ({ isin: g.isin, name: g.name, date: g.date, cur: g.cur, gross: r2(g.gross), tax: g.hasTax ? r2(g.tax) : null, net: g.hasTax ? r2(g.gross - g.tax) : null, lines: g.lines }));
  }

  /* Versements issus du relevé du courtier (source CONFIRMÉE) : rattachés aux positions (détenues ou clôturées) par ISIN, sans doublon (même versement déjà enregistré).
     - une estimation de marché (« market-history ») ou un brouillon « à vérifier » du même versement est REMPLACÉ par le montant réel (1re passe : date et montant cohérents ; 2e passe : date de paiement seule, sans date de détachement ni contrôle du montant ; une estimation ne sert qu'une fois) ;
     - un titre absent de l'application (société que vous ne détenez plus) : une position archivée « relevé seul » est créée (opt.createMissing) pour y rattacher ses dividendes ;
     - estimations de la période couverte par le fichier SANS versement correspondant : listées (« non confirmées »), jamais supprimées.
     Pure : rien n'est modifié ; l'appelant applique (add, replace, stubs). opt : { createMissing, coverage: { from, to }, account } */
  function brokerDividendPayments(state, groups, uid, opt) {
    opt = opt || {};
    const add = [], dups = [], unmatched = [], replace = [], stubs = [], claimed = new Set(); const alias = state.isinAlias || {};
    const insts = (state.holdings || []).concat(state.archive || []), stubBy = new Map();
    const dayN = (d) => Date.parse(d) / 86400000;
    const sorted = (groups || []).slice().sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    const pend = [];
    sorted.forEach((g) => {
      const key = g.isin ? canon(alias, g.isin) : null, nk = norm(g.name);
      let h = insts.find((x) => (key && canon(alias, holdingIsin(x)) === key) || (!key && g.name && norm(x.name) === nk)) || stubBy.get(key || nk);
      if (!h) {
        if (!opt.createMissing || !(g.isin || g.name)) { unmatched.push(g); return; }
        h = { id: uid(), isin: g.isin || '', ticker: g.isin || '', displayTicker: '', name: g.name || g.isin, currency: g.cur, account: opt.account || null, source: 'degiro', closedAt: g.date, userClosed: true, statementOnly: true, hist: null };
        stubs.push(h); stubBy.set(key || nk, h);
      }
      const mine = (state.payments || []).filter((p) => p.holdingId === h.id);
      const extId = 'dgd:' + hash32([h.id, g.date, g.cur, g.gross].join('|'), 2166136261).toString(36);
      const same = mine.find((p) => p.extId === extId || (!p.estimated && p.source !== 'auto' && (p.payDate || p.exDate) && Math.abs(dayN(p.payDate || p.exDate) - dayN(g.date)) <= 4 && p.currency === g.cur && Math.abs(Number(p.gross) - g.gross) <= Math.max(0.05, 0.02 * g.gross)));
      if (same) { dups.push(g); return; }
      pend.push({ g, h, mine, extId, best: null });
    });
    const candidates = (x) => x.mine.filter((p) => !claimed.has(p.id) && ((p.estimated && p.source === 'market-history') || (p.source === 'auto' && p.verified === false)));
    const claim = (x, p) => { x.best = p; claimed.add(p.id); replace.push(p.id); };
    // passe 1 : détachement ≤ date de paiement ≤ détachement + 75 j ; même devise → montant à ±35 %
    pend.forEach((x) => {
      let best = null, bs = 1e9;
      candidates(x).forEach((p) => {
        const base = p.exDate || p.payDate; if (!base) return; const lag = dayN(x.g.date) - dayN(base); if (lag < -3 || lag > 75) return;
        let sc = lag / 100; if (p.currency === x.g.cur) { const rel = Math.abs(Number(p.gross) - x.g.gross) / x.g.gross; if (rel > 0.35) return; sc += rel; } else sc += 1;
        if (sc < bs) { bs = sc; best = p; }
      });
      if (best) claim(x, best);
    });
    // passe 2 : par la seule date de paiement, SANS détachement ni contrôle du montant (montant estimé faussé par un split, un acompte, une devise…) : le relevé fait foi
    pend.filter((x) => !x.best).forEach((x) => {
      let best = null, bs = 1e9;
      candidates(x).forEach((p) => {
        const lag = p.exDate ? dayN(x.g.date) - dayN(p.exDate) : (p.payDate ? Math.abs(dayN(x.g.date) - dayN(p.payDate)) : null);
        if (lag === null || lag < -5 || lag > (p.exDate ? 45 : 20)) return;
        if (Math.abs(lag) < bs) { bs = Math.abs(lag); best = p; }
      });
      if (best) claim(x, best);
    });
    pend.forEach((x) => { const g = x.g, h = x.h, best = x.best;
      add.push({ id: uid(), holdingId: h.id, ticker: h.displayTicker || h.ticker, name: h.name || g.name || '', payDate: g.date, exDate: best ? best.exDate || null : null, qty: best ? best.qty : null, perShare: null, gross: g.gross, tax: g.tax, net: g.net, fees: null, currency: g.cur, source: 'degiro', verified: true, extId: x.extId });
    });
    const unconfirmed = [];
    if (opt.coverage && opt.coverage.from && opt.coverage.to) {
      const last = dayN(opt.coverage.to) - 75, first = dayN(opt.coverage.from);
      (state.payments || []).forEach((p) => { if (claimed.has(p.id) || !p.estimated || p.source !== 'market-history' || p.verified === false) return; const base = p.exDate || p.payDate; if (base && dayN(base) >= first && dayN(base) <= last) unconfirmed.push(p.id); });
    }
    return { add, dups, unmatched, replace, stubs, unconfirmed };
  }

  root.Ledger = { norm, isISIN, inferDecimal, parseNumber, parseDate, parseTime, inferDateOrder, roleOf, detect, parseOps, assignIds, fingerprint, run, splitFactor, plan, apply, orderKey, otherKind, qtyEq,
    purchaseSummary, addPurchase, removePurchase, txAmount, recordSale, groupDividends, brokerDividendPayments, holdingIsin, canon, entriesFor, corpEntries, referenceOf, verdict, reevaluate, addCorp, mergeInstruments, demote, promote, parsePositions, diagnose };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.Ledger;
})(typeof self !== 'undefined' ? self : this);
