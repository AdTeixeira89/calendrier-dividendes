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
    ['valueDate', /\b(date de valeur|value date|valutadatum|fecha valor|data valuta|valutadatum)\b/],
    ['date', /^(date|datum|fecha|data|trade date|transaction date|date de transaction|date d execution|date operation|datum transactie)$/],
    ['time', /^(heure|time|uhrzeit|hora|tijd|ora|heure d execution)$/],
    ['isin', /\bisin\b/],
    ['fx', /(taux de change|exchange rate|wisselkoers|wechselkurs|tipo de cambio|tasso di cambio|fx rate|koers wissel)/],
    ['localValue', /((valeur|value|waarde|wert|valor|valore) (locale|local|lokale|lokaler))|local value|valeur locale|lokale waarde/],
    ['orderId', /(id ordre|id de l ordre|order id|orderid|order nr|ordernummer|auftrags|id commande|order reference|ordre id)/],
    ['fee', /(frais|fees?\b|kosten|gebuhr|gebuehr|comision|commission|courtage|brokerage|autofx|costi|spese|transaction costs)/],
    ['total', /^(total|totaal|gesamt|totale|total eur|montant total|totaal eur)( [a-z]{3})?$/],
    ['valueAcct', /^(valeur|value|waarde|wert|valor|valore|montant|amount|bedrag)( [a-z]{3})?$/],
    ['qty', /^(quantite|quantity|aantal|anzahl|cantidad|quantita|nombre|number|shares|stuks|qty|nb|nombre de titres|nbre)$/],
    ['price', /^(cours|price|koers|kurs|prix|precio|prezzo|cotation|prix unitaire|unit price)( [a-z]{3})?$/],
    ['balance', /^(solde|saldo|balance|rekeningsaldo)$/],
    ['change', /^(variation|mutatie|veranderung|cambio|movimiento|movement)$/],
    ['type', /^(type|sens|side|buy sell|achat vente|b s|type d operation|operation type|transaction type|soort)$/],
    ['description', /^(description|omschrijving|beschreibung|descripcion|descrizione|operation|libelle)$/],
    ['currency', /^(devise|currency|munt|wahrung|waehrung|moneda|valuta|divisa)( .*)?$/],
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
    if (/dividend|dividende|dividendo/.test(d)) return 'dividende';
    if (/retenue|withholding|quellensteuer|impot|tax\b/.test(d)) return 'retenue';
    if (/depot|deposit|storting|einzahlung|ingreso|versement|virement|ideal|sofort|flatex/.test(d) && !/frais|fee|kosten/.test(d)) return 'dépôt / virement';
    if (/retrait|withdraw|opname|auszahlung|reembolso|retirada/.test(d)) return 'retrait';
    if (/frais|fee|kosten|gebuhr|commission|courtage|connectivity|connexion|costi/.test(d)) return 'frais';
    if (/interet|interest|rente|zins|interes/.test(d)) return 'intérêts';
    if (/fractionnement|split|regroupement|opera?tion sur titre|corporate|spin|fusion|merger|changement de produit|product change|isin/.test(d)) return 'opération sur titres';
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
    const out = { ops: [], bad: [], ambiguous: [], other: [], meta: { decimal: ',', dateOrder: 'dmy', acctCur: det.acctCur || 'EUR', rows: 0, signedQty: true } };
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
      let time = parseTime(g(r, 'time')) || parseTime(dateCell);
      let name = g(r, 'product'), isin = g(r, 'isin').toUpperCase();
      const warn = [];
      if (isin && !ISIN_RE.test(isin)) { warn.push('ISIN invalide (« ' + isin + ' »)'); isin = ''; }
      const desc = g(r, 'description'), typeCell = g(r, 'type');
      let kind = null, qty = NaN, price = NaN, priceCur = '', total = null, valueAcct = null, fees = null;
      const fxv = num(g(r, 'fx')), orderId = g(r, 'orderId');

      if (det.statement || (cols.qty === undefined && desc)) {
        const m = desc.match(TRADE_DESC);
        if (!m) { out.other.push({ line, kind: otherKind(desc), desc, date, raw }); return; }
        kind = BUY_WORDS.test(m[1]) ? 'buy' : 'sell';
        qty = Math.abs(num(m[2])); price = Math.abs(num(m[4])); priceCur = m[5].toUpperCase() === 'GBX' ? 'GBX' : m[5].toUpperCase();
        if (!isin && m[6]) isin = m[6].toUpperCase();
        if (!name) name = m[3].trim();
        const ch = num(g(r, 'change')); if (!isNaN(ch)) total = Math.abs(ch);
      } else {
        qty = num(g(r, 'qty'));
        if (isNaN(qty) || qty === 0) { out.bad.push({ line, reason: 'Quantité illisible ou nulle (« ' + g(r, 'qty') + ' »)', raw }); return; }
        price = Math.abs(num(g(r, 'price')));
        const lv = num(g(r, 'localValue'));
        if (isNaN(price) && !isNaN(lv)) price = Math.abs(lv) / Math.abs(qty);
        priceCur = cols.priceCur !== undefined ? g(r, 'priceCur').replace(/\s/g, '') : '';
        if (priceCur && !/^(?:[A-Za-z]{3})$/.test(priceCur)) priceCur = '';
        priceCur = priceCur === 'GBp' ? 'GBX' : priceCur.toUpperCase();
        const t = num(g(r, 'total')), v = num(g(r, 'valueAcct'));
        total = isNaN(t) ? null : Math.abs(t); valueAcct = isNaN(v) ? null : Math.abs(v);
        if (typeCell) { if (BUY_WORDS.test(typeCell) || /achat|buy|koop|kauf|compra/i.test(typeCell)) kind = 'buy'; else if (SELL_WORDS.test(typeCell) || /vente|sell|verkoop|verkauf|venta/i.test(typeCell)) kind = 'sell'; }
        const signTotal = isNaN(t) || t === 0 ? 0 : (t < 0 ? 1 : -1);        // total négatif = argent sorti = achat
        if (!kind) {
          if (signed) kind = qty < 0 ? 'sell' : 'buy';
          else if (signTotal) kind = signTotal > 0 ? 'buy' : 'sell';
        }
        if (!kind) { out.ambiguous.push({ line, reason: 'Achat ou vente indéterminé (quantité non signée et total absent)', raw }); return; }
        if (signed && signTotal && ((kind === 'buy' && signTotal < 0) || (kind === 'sell' && signTotal > 0))) { out.ambiguous.push({ line, reason: 'Signe de la quantité et du total contradictoires', raw }); return; }
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
      out.ops.push({ line, date, time, name, isin, type: kind, qty: r8(qty), price: price, priceCur, valueAcct, acctCur: accCur, fees, total, amt: amt === null ? null : r4(amt), fxRate: isNaN(fxv) ? null : fxv, orderId, warn, raw, seq: out.ops.length });
    });
    assignIds(out.ops);
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
     entrées : { date, time, type 'buy'|'sell', qty, amt (coût frais compris / produit net), fees }
     --------------------------------------------------------------- */
  const orderKey = (a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : (a.time || '') < (b.time || '') ? -1 : (a.time || '') > (b.time || '') ? 1 : (a.type === b.type ? 0 : a.type === 'buy' ? -1 : 1));
  function run(entries) {
    const sorted = entries.map((e, i) => ({ e, i })).sort((a, b) => orderKey(a.e, b.e) || a.i - b.i).map((x) => x.e);
    let qty = 0, cost = 0, realized = 0, realizedKnown = true, costUnknown = 0, negative = false, hasSell = false;
    const issues = [], rows = [];
    sorted.forEach((e) => {
      const q = Number(e.qty) || 0, row = Object.assign({}, e);
      if (e.type === 'buy') {
        qty += q;
        if (e.amt == null) { costUnknown++; row.issue = 'Montant inconnu : prix de revient non calculable'; }
        else cost += e.amt;
        row.realized = null;
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
      row.qtyAfter = qty; row.costAfter = r2(cost); row.pruAfter = qty > EPS && costUnknown === 0 ? cost / qty : null;
      rows.push(row);
    });
    return { rows, qty, cost: r2(cost), pru: qty > EPS && costUnknown === 0 ? cost / qty : null, realized: r2(realized), realizedKnown: hasSell ? realizedKnown : true, costUnknown, negative, issues, first: sorted.length ? sorted[0].date : null, last: sorted.length ? sorted[sorted.length - 1].date : null };
  }

  /* Facteur de fractionnement : produit des splits postérieurs à une date (ex. 10:1 → 10). */
  function splitFactor(splits, dateISO) { let f = 1; (splits || []).forEach((s) => { if (s && s.date > dateISO && s.ratio > 0) f *= s.ratio; }); return f; }

  /* ---------------------------------------------------------------
     PLAN D'IMPORT
     --------------------------------------------------------------- */
  const instKey = (o) => (o.isin ? o.isin : 'N:' + norm(o.name));
  const isNameKey = (k) => k.slice(0, 2) === 'N:';          // (un ISIN néerlandais commence aussi par « N »)
  function holdingIsin(h) { return String(h.isin || (isISIN(h.ticker) ? h.ticker : '') || '').toUpperCase(); }
  function findExisting(state, key, name, account) {
    const nn = norm(name), isIsin = !isNameKey(key);
    const hit = (list, kind) => {
      const l = (list || []).filter((x) => !account || x.account === account || kind === 'archive' && !x.account);
      let f = isIsin ? l.find((x) => holdingIsin(x) === key) : null;
      if (!f && nn) f = l.find((x) => norm(x.name) === nn && (!isIsin || !holdingIsin(x) || holdingIsin(x) === key));
      return f ? { kind, ref: f } : null;
    };
    return hit(state.holdings, 'holding') || hit(state.archive, 'archive');
  }
  const priceClose = (a, b) => Math.abs(a - b) <= Math.max(1e-4, Math.abs(b) * 1e-4);

  function plan(state, ops, opt) {
    opt = opt || {};
    const account = opt.account, txs = state.transactions || [];
    const byExt = new Set(txs.filter((t) => t.extId).map((t) => t.extId));
    const groups = {}, order = [];
    ops.forEach((o) => { const k = instKey(o); if (!groups[k]) { groups[k] = []; order.push(k); } groups[k].push(o); });
    const instruments = order.map((key) => {
      const list = groups[key], last = list.slice().sort(orderKey).pop();
      const name = (list.find((o) => o.name) || {}).name || '';
      const found = findExisting(state, key, name, account), ref = found ? found.ref : null;
      const existing = ref ? txs.filter((t) => t.holdingId === ref.id) : [];
      const used = new Set();
      const dupOps = [], newOps = [];
      list.forEach((o) => {
        if (byExt.has(o.extId)) { dupOps.push(o); return; }
        // même opération déjà saisie autrement (autre source) : comparaison un pour un, jamais « même jour = doublon »
        const j = existing.findIndex((t, idx) => !used.has(idx) && t.date === o.date && t.type === o.type && Math.abs(Number(t.qty) - o.qty) < EPS && priceClose(Number(t.price), o.price));
        if (j >= 0) { used.add(j); dupOps.push(o); } else newOps.push(o);
      });
      const entries = list.map((o) => ({ date: o.date, time: o.time, type: o.type, qty: o.qty, amt: o.amt, fees: o.fees, extId: o.extId, price: o.price, priceCur: o.priceCur, line: o.line }));
      const led = run(entries);
      const inst = { key, isin: isNameKey(key) ? '' : key, name, ops: list, newOps, dupOps, led, include: true, ref: found, currency: last.priceCur, acctCur: last.acctCur,
        status: 'review', reasons: [], fill: {}, divergence: null, pruDiff: null, first: led.first, last: led.last };
      const warnOps = list.filter((o) => o.warn && o.warn.length);
      inst.warnCount = warnOps.length;
      // 1. Historique incohérent : on ne devine pas
      if (led.negative) { inst.status = 'review'; inst.include = false; inst.reasons.push('Solde négatif reconstitué : l\'historique commence après vos premiers achats (ou une opération sur titres manque).'); return inst; }
      const fileQty = led.qty;
      if (!found) {
        if (fileQty > EPS) { inst.status = 'create'; if (led.pru == null) inst.reasons.push('Prix de revient non calculable (montants manquants sur certaines lignes) : la position sera créée sans PRU.'); }
        else { inst.status = 'closed'; }
        return inst;
      }
      if (found.kind === 'archive') {
        if (fileQty > EPS) { inst.status = 'reopen'; } else inst.status = 'archive';
        return inst;
      }
      // Position déjà dans l'application : jamais modifiée sans choix explicite
      const h = found.ref, hq = Number(h.quantity) || 0;
      inst.status = 'holding';
      const qtyOk = Math.abs(fileQty - hq) <= EPS * Math.max(1, hq);
      if (!qtyOk) inst.divergence = { app: hq, file: fileQty, diff: r8(fileQty - hq) };
      const hAvg = Number(h.avgCost) > 0 ? Number(h.avgCost) : null, hCostCur = h.costCurrency || h.currency || 'EUR';
      if (hAvg == null && led.pru != null && qtyOk) inst.fill.avgCost = { value: led.pru, cur: inst.acctCur };
      if (hAvg != null && led.pru != null && hCostCur === inst.acctCur && qtyOk && Math.abs(hAvg - led.pru) > Math.max(0.005, hAvg * 0.002)) inst.pruDiff = { app: hAvg, file: led.pru, cur: inst.acctCur };
      if (!h.isin && inst.isin) inst.fill.isin = inst.isin;
      if (!h.name && name) inst.fill.name = name;
      if (existing.length && existing.reduce((s, t) => s + (t.type === 'buy' ? 1 : -1) * Number(t.qty || 0), 0) !== hq && newOps.length) inst.reasons.push('Historique existant incomplet : les opérations manquantes seront ajoutées.');
      return inst;
    });
    const sum = (f) => instruments.reduce((s, i) => s + f(i), 0);
    const inc = instruments.filter((i) => i.include && i.status !== 'review');
    const totals = {
      detected: ops.length,
      newTx: inc.reduce((s, i) => s + i.newOps.length, 0),
      dups: sum((i) => i.dupOps.length),
      newPositions: inc.filter((i) => i.status === 'create' || i.status === 'reopen').length,
      keptPositions: instruments.filter((i) => i.status === 'holding').length,
      closed: inc.filter((i) => i.status === 'closed').length,
      archived: instruments.filter((i) => i.status === 'archive').length,
      review: sum((i) => (i.status === 'review' ? i.ops.length : i.warnCount)),
      reviewInstruments: instruments.filter((i) => i.status === 'review').length,
      divergences: instruments.filter((i) => i.divergence).length,
      fills: instruments.filter((i) => i.status === 'holding' && (i.fill.avgCost || i.fill.isin || i.fill.name)).length
    };
    return { instruments, totals };
  }

  /* Applique le plan (le premier argument est modifié). choices : { fill: bool, align: { clé: true }, off: { clé: true } }. */
  function apply(state, pl, choices, deps) {
    choices = choices || {}; const uid = deps.uid;
    state.holdings = state.holdings || []; state.archive = state.archive || []; state.transactions = state.transactions || [];
    const res = { tx: 0, created: [], archived: [], filled: 0, aligned: 0, reopened: 0, skipped: 0 };
    pl.instruments.forEach((inst) => {
      if (inst.status === 'review' || !inst.include || (choices.off && choices.off[inst.key])) { res.skipped++; return; }
      const led = inst.led, last = inst.ops.slice().sort(orderKey).pop();
      let id, label = inst.name || inst.isin, tickerLabel;
      const accountId = deps.account;
      const newHolding = (idv) => ({ id: idv, ticker: inst.isin || inst.name, displayTicker: (inst.isin || inst.name).toUpperCase(), isin: inst.isin, name: inst.name, type: 'stock', quantity: led.qty,
        avgCost: led.pru != null ? r4(led.pru) : null, costCurrency: inst.acctCur, currency: inst.currency === 'GBX' ? 'GBP' : (inst.currency || inst.acctCur), account: accountId, logo: null, source: 'degiro', addedAt: led.first,
        dividend: { lastAmount: null, anchorMonth: null, frequency: 'quarterly', dateKind: 'pay', none: false } });
      if (inst.status === 'create') { const h = newHolding(uid()); state.holdings.push(h); id = h.id; tickerLabel = h.displayTicker; res.created.push(h); }
      else if (inst.status === 'reopen') {
        const a = inst.ref.ref, h = newHolding(a.id); Object.assign(h, { logo: a.logo || null, hist: a.hist, splits: a.splits, ticker: a.ticker || h.ticker, displayTicker: a.displayTicker || h.displayTicker, currency: a.currency || h.currency });
        state.archive = state.archive.filter((x) => x.id !== a.id); state.holdings.push(h); id = h.id; tickerLabel = h.displayTicker; res.created.push(h); res.reopened++;
      } else if (inst.status === 'closed') {
        const a = { id: uid(), ticker: inst.isin || inst.name, displayTicker: (inst.isin || inst.name).toUpperCase(), isin: inst.isin, name: inst.name, currency: inst.currency === 'GBX' ? 'GBP' : (inst.currency || inst.acctCur), account: accountId, source: 'degiro', closedAt: led.last, firstAt: led.first, hist: null };
        state.archive.push(a); id = a.id; tickerLabel = a.displayTicker; res.archived.push(a);
      } else if (inst.status === 'archive') { id = inst.ref.ref.id; tickerLabel = inst.ref.ref.displayTicker; }
      else {                                                  // position existante : jamais écrasée, sauf compléments / alignement choisis
        const h = inst.ref.ref; id = h.id; tickerLabel = h.displayTicker || h.ticker;
        if (choices.fill !== false) {
          let n = 0;
          if (inst.fill.avgCost && !(Number(h.avgCost) > 0)) { h.avgCost = r4(inst.fill.avgCost.value); h.costCurrency = inst.fill.avgCost.cur; n++; }
          if (inst.fill.isin && !h.isin) { h.isin = inst.fill.isin; n++; }
          if (inst.fill.name && !h.name) { h.name = inst.fill.name; n++; }
          if (n) res.filled++;
        }
        if (choices.align && choices.align[inst.key] && led.qty > EPS) { h.quantity = led.qty; if (led.pru != null) { h.avgCost = r4(led.pru); h.costCurrency = inst.acctCur; } res.aligned++; }
      }
      inst.newOps.forEach((o) => {
        state.transactions.push({ id: uid(), holdingId: id, ticker: tickerLabel, name: inst.name || label, isin: inst.isin || undefined, date: o.date, time: o.time || undefined, type: o.type, qty: o.qty, price: o.price, fees: o.fees == null ? 0 : o.fees, feesCur: o.acctCur,
          currency: o.priceCur, amountAcct: o.amt, acctCur: o.acctCur, fxRate: o.fxRate == null ? undefined : o.fxRate, orderId: o.orderId || undefined, source: 'degiro', extId: o.extId });
        res.tx++;
      });
    });
    return res;
  }

  root.Ledger = { norm, isISIN, inferDecimal, parseNumber, parseDate, parseTime, inferDateOrder, roleOf, detect, parseOps, assignIds, fingerprint, run, splitFactor, plan, apply, orderKey, otherKind };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.Ledger;
})(typeof self !== 'undefined' ? self : this);
