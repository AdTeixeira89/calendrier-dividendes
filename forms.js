/* ==================================================================
   forms.js — fenêtres de saisie : actif, versement, comptes, suppressions,
   imports (positions CSV/Excel, transactions Trade Republic / autres),
   pré-remplissage de l'historique.
   ================================================================== */

const fld = (label, input, hint, id) => '<div class="field"><label' + (id ? ' for="' + id + '"' : '') + '>' + label + '</label>' + input + (hint ? '<span class="hint">' + hint + '</span>' : '') + '</div>';
const opt = (v, t, sel) => '<option value="' + esc(v) + '"' + (sel ? ' selected' : '') + '>' + esc(t) + '</option>';
const numOrNull = (v) => { if (v === '' || v === null || v === undefined) return null; const n = parseNum(v); return isNaN(n) ? null : n; };

/* Nombre « à la française ou anglaise » : 1 234,56 / 1,234.56 / 12.5 */
function parseNum(raw) {
  if (raw === undefined || raw === null) return NaN;
  let s = String(raw).trim().replace(/\s/g, '').replace(/[€$£]/g, '').replace(/^\u2212/, '-').replace(/^\((.*)\)$/, '-$1');
  if (!s) return NaN;
  const c = s.includes(','), d = s.includes('.');
  if (c && d) s = s.lastIndexOf(',') > s.lastIndexOf('.') ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  else if (c) s = s.replace(',', '.');
  // lecture stricte : une date (« 15/03/2026 », « 2026-03-15 ») ou un texte ne doit jamais être lu comme un nombre (« 15 » ou « 2026 »)
  return /^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(s) ? parseFloat(s) : NaN;
}
function parseDateLoose(raw) {
  const s = String(raw || '').trim(); if (!s) return null;
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/); if (m) return m[1] + '-' + m[2] + '-' + m[3];
  m = s.match(/^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{4})/); if (m) return m[3] + '-' + pad2(m[2]) + '-' + pad2(m[1]);
  m = s.match(/^(\d{4})\/(\d{2})\/(\d{2})/); if (m) return m[1] + '-' + m[2] + '-' + m[3];
  return null;
}

/* ===============================================================
   ACTIF (ajout / modification)
   =============================================================== */
let hDraft = null;
function openHoldingModal(id) {
  const ex = id ? holdingById(id) : null;
  hDraft = ex ? clone(ex) : { id: uid(), ticker: '', displayTicker: '', isin: '', name: '', type: 'stock', quantity: 1, avgCost: null, currency: baseCur(), logo: null, source: 'manual', addedAt: todayISO(),
    account: view.account !== 'all' ? view.account : state.accounts[0].id, dividend: { lastAmount: null, anchorMonth: null, frequency: 'quarterly', dateKind: 'pay', none: false } };
  const d = hDraft, dv = d.dividend || {};
  const payer = !dv.none;
  const m = openModal('<h2>' + (ex ? 'Modifier' : 'Ajouter') + ' un actif</h2><div class="sub">Action ou ETF. Seuls le ticker (ou ISIN) et la quantité sont indispensables.</div>' +
    '<div style="position:relative">' + fld('Nom, ticker ou ISIN', '<input type="text" id="hTicker" value="' + esc(d.ticker) + '" placeholder="ex : Air Liquide, AAPL, AI.PA, FR0000120073" autocomplete="off">',
      'Tapez un nom pour rechercher (Yahoo Finance), ou un ticker : Paris .PA · Amsterdam .AS · Allemagne .DE · Londres .L', 'hTicker') + '<div id="hSuggest" class="dd-panel hide" style="left:0;right:0"></div></div>' +
    '<div class="row2">' + fld('Quantité détenue', '<input type="number" id="hQty" min="0" step="any" inputmode="decimal" value="' + esc(d.quantity) + '">', '', 'hQty') +
    fld('Prix de revient unitaire (PRU)', '<input type="number" id="hCost" min="0" step="any" inputmode="decimal" value="' + esc(d.avgCost === null ? '' : d.avgCost) + '" placeholder="facultatif">', 'Ce que vous avez payé par titre — sert au rendement sur coût et à la plus-value', 'hCost') + '</div>' +
    '<div class="row2">' + fld('Devise du PRU', '<select id="hCostCur">' + (CURRENCIES.indexOf(d.costCurrency || d.currency) < 0 ? [d.costCurrency || d.currency] : []).concat(CURRENCIES).map((c) => opt(c, c, c === (d.costCurrency || d.currency))).join('') + '</select>', 'Souvent l\'euro, même pour une action cotée en dollars', 'hCostCur') + fld('Cours actuel', '<input type="number" id="hPrice" min="0" step="any" inputmode="decimal" value="' + esc(d.price > 0 ? d.price : '') + '" placeholder="automatique">', d.priceAt ? 'Mis à jour automatiquement (cours du ' + esc(fmtDate(d.priceAt.slice(0, 10))) + ')' : 'Mis à jour par « Actualiser » ; saisie manuelle possible', 'hPrice') + '</div>' +
    '<div class="row2">' + fld('Nom', '<input type="text" id="hName" value="' + esc(d.name) + '">', '', 'hName') + fld('Compte', '<select id="hAcc">' + state.accounts.map((a) => opt(a.id, a.name, a.id === d.account)).join('') + '</select>', '', 'hAcc') + '</div>' +
    '<div class="row2">' + fld('Catégorie', '<select id="hType">' + (ex && Engine.category(d) === 'unknown' ? '<option value="" selected>À classer (à confirmer)</option>' : '') + Object.keys(Engine.TYPES).map((k) => opt(k, Engine.TYPES[k], !(ex && Engine.category(d) === 'unknown') && d.type === k)).join('') + '</select>', 'ETF ou action : un choix manuel est enregistré et jamais écrasé par un import ou une actualisation. Un ETF capitalisant ne verse aucun dividende.', 'hType') +
    fld('Devise', '<select id="hCur">' + (CURRENCIES.indexOf(d.currency) < 0 ? [d.currency] : []).concat(CURRENCIES).map((c) => opt(c, c, c === d.currency)).join('') + '</select>', '', 'hCur') + '</div>' +
    '<div class="row2">' + fld('Secteur', '<select id="hSector"><option value="">Automatique (données de marché)</option>' + Object.keys(SECTOR_FR).map((k) => opt(k, SECTOR_FR[k], d.sector === k)).join('') + (d.sector && !SECTOR_FR[d.sector] ? opt(d.sector, d.sector, true) : '') + '</select>', d.geoLocked ? 'Saisi par vous : jamais écrasé' : 'Récupéré automatiquement, modifiable', 'hSector') +
    fld('Pays', '<input type="text" id="hCountry" list="countryList" value="' + esc(d.country || '') + '" placeholder="automatique"><datalist id="countryList">' + Array.from(new Set(Object.values(Market.COUNTRY_NAME).concat(['ETF multi-pays']))).sort().map((c) => '<option value="' + esc(c) + '">').join('') + '</datalist>', 'Pays de l\'émetteur (d\'après l\'ISIN)', 'hCountry') + '</div>' +
    '<div id="hDivBox"><div class="sec">Dividende</div>' +
    '<div class="btn-row" style="margin-bottom:10px"><button class="btn sm" type="button" id="hFetch">' + icon('refresh') + 'Récupérer automatiquement</button><span class="hint" id="hFetchMsg"></span></div>' +
    fld('Distribution', '<select id="hPays"><option value="1"' + (payer ? ' selected' : '') + '>Verse un dividende</option><option value="0"' + (!payer ? ' selected' : '') + '>Ne verse pas de dividende</option></select>', 'Aucun dividende n\'est jamais inventé : sans données, l\'actif reste « données manquantes ».', 'hPays') +
    '<div id="hDivFields"><div class="row2">' + fld('Dividende par titre (dernier)', '<input type="number" id="hDiv" step="any" inputmode="decimal" value="' + esc(dv.lastAmount === null || dv.lastAmount === undefined ? '' : dv.lastAmount) + '">', '', 'hDiv') +
    fld('Fréquence', '<select id="hFreq">' + ['monthly', 'quarterly', 'semiannual', 'annual'].map((f) => opt(f, FREQ_LABEL[f], dv.frequency === f)).join('') + '</select>', '', 'hFreq') + '</div>' +
    '<div class="row2">' + fld('Mois d\'un versement', '<select id="hMonth"><option value="">—</option>' + MOIS.map((mm, i) => opt(i + 1, mm, Number(dv.anchorMonth) === i + 1)).join('') + '</select>', 'Les autres mois sont déduits de la fréquence.', 'hMonth') +
    fld('Ce mois correspond à…', '<select id="hKind">' + opt('pay', 'la date de paiement', (dv.dateKind || 'pay') === 'pay') + opt('ex', 'la date de détachement', dv.dateKind === 'ex') + '</select>', 'Les données de marché donnent le détachement.', 'hKind') + '</div>' +
    '<div class="row2">' + fld('Jour de paiement (facultatif)', '<select id="hDay"><option value="">Inconnu</option>' + Array.from({ length: 31 }, (_, i) => opt(i + 1, i + 1, Number(dv.payDay) === i + 1)).join('') + '</select>', '', 'hDay') +
    fld('Retenue à la source (%)', '<input type="number" id="hTax" min="0" max="100" step="any" inputmode="decimal" value="' + esc(dv.taxRate === null || dv.taxRate === undefined ? '' : dv.taxRate) + '" placeholder="facultatif">', 'Permet d\'estimer le net.', 'hTax') + '</div></div></div>' +
    '<div class="modal-actions"><div class="btn-row">' + (ex ? '<button class="btn danger" type="button" id="hDel">' + icon('trash') + 'Supprimer</button>' : '') + (ex ? '<button class="btn" type="button" id="hBuys">Achats…</button>' : '') + (ex && Number(ex.quantity) > 0 ? '<button class="btn" type="button" id="hSell">Vendre / clôturer…</button>' : '') + '</div><div class="btn-row"><button class="btn" type="button" data-close>Annuler</button><button class="btn primary" type="button" id="hSave">Enregistrer</button></div></div>', { wide: true });
  const sync = () => {
    const acc = $('#hType', m).value === 'etf_acc', none = $('#hPays', m).value === '0';
    $('#hDivBox', m).classList.toggle('hide', false);
    $('#hPays', m).disabled = acc; if (acc) $('#hPays', m).value = '0';
    $('#hDivFields', m).classList.toggle('hide', acc || $('#hPays', m).value === '0');
    $('#hFetch', m).disabled = !state.settings.relayUrl;
    $('#hFetchMsg', m).textContent = state.settings.relayUrl ? '' : 'Relais de données non configuré (Paramètres).';
  };
  $('#hType', m).onchange = sync; $('#hPays', m).onchange = sync; sync();
  $('#hFetch', m).onclick = () => fetchIntoHoldingForm(m);
  wireTickerSearch(m);
  if (ex) $('#hDel', m).onclick = () => { closeModal(); confirmDeleteHoldings([ex.id]); };
  if (ex && $('#hBuys', m)) $('#hBuys', m).onclick = () => { closeModal(); openBuysModal(ex.id); };
  if (ex && $('#hSell', m)) $('#hSell', m).onclick = () => { closeModal(); openSellModal(ex.id); };
  $('#hSave', m).onclick = () => saveHoldingForm(m, ex);
}

function wireTickerSearch(m) {
  const input = $('#hTicker', m), list = $('#hSuggest', m); let t;
  input.addEventListener('input', () => {
    clearTimeout(t); const q = input.value.trim();
    if (q.length < 2 || !state.settings.relayUrl || Market.isISIN(q)) { list.classList.add('hide'); return; }
    t = setTimeout(async () => {
      try {
        const res = (await market.search(q)).filter((x) => !x.quoteType || ['EQUITY', 'ETF'].indexOf(x.quoteType) >= 0).slice(0, 7);
        if (!res.length) { list.classList.add('hide'); return; }
        list.innerHTML = res.map((r) => '<button type="button" class="nav-link" data-sym="' + esc(r.symbol) + '" data-nm="' + esc(r.longname || r.shortname || '') + '" data-ty="' + esc(r.quoteType || '') + '"><span><b>' + esc(r.symbol) + '</b> <span class="muted">' + esc(r.shortname || r.longname || '') + ' · ' + esc(r.exchDisp || r.exchange || '') + '</span></span></button>').join('');
        list.classList.remove('hide');
        $$('[data-sym]', list).forEach((b) => b.onclick = () => { input.value = b.dataset.sym; if (!$('#hName', m).value) $('#hName', m).value = b.dataset.nm; if (b.dataset.ty === 'ETF') $('#hType', m).value = 'etf_dist'; list.classList.add('hide'); $('#hType', m).dispatchEvent(new Event('change')); fetchIntoHoldingForm(m); });
      } catch (e) { list.classList.add('hide'); }
    }, 300);
  });
  input.addEventListener('blur', () => setTimeout(() => list.classList.add('hide'), 200));
}
async function fetchIntoHoldingForm(m) {
  const msg = $('#hFetchMsg', m), t = $('#hTicker', m).value.trim();
  if (!t) { msg.textContent = 'Renseignez d\'abord un ticker.'; return; }
  msg.textContent = 'Récupération…';
  try {
    const a = await market.fetchAsset(t, $('#hName', m).value);
    const tmp = { dividend: {}, type: $('#hType', m).value, ticker: t };
    Market.applyToHolding(tmp, a, todayISO());
    $('#hTicker', m).value = a.symbol;
    if (a.name && !$('#hName', m).value) $('#hName', m).value = a.name;
    if (a.currency) { $('#hCur', m).value = a.currency; if (!$('#hCost', m).value) $('#hCostCur', m).value = a.currency; }
    if (a.price > 0) { $('#hPrice', m).value = a.price; hDraft.priceAt = a.priceAt; }
    if ($('#hType', m).value !== tmp.type && !hDraft.typeLocked) $('#hType', m).value = tmp.type;
    const d = tmp.dividend;
    $('#hPays', m).value = d.none ? '0' : '1';
    if (!d.none) { $('#hDiv', m).value = d.lastAmount; $('#hFreq', m).value = d.frequency === 'irregular' ? 'quarterly' : d.frequency; $('#hMonth', m).value = d.anchorMonth; $('#hKind', m).value = 'ex'; }
    hDraft.dividend.history = d.history; hDraft.dividend.updatedAt = d.updatedAt;
    $('#hType', m).dispatchEvent(new Event('change'));
    msg.textContent = d.none ? 'Aucun dividende récent trouvé : actif marqué « sans dividende ».' : '✓ Données récupérées (détachement estimé d\'après l\'historique) : vérifiez et complétez.';
  } catch (e) { msg.textContent = '✗ ' + e.message; }
}
function saveHoldingForm(m, ex) {
  const t = $('#hTicker', m).value.trim();
  if (!t) { toast('Renseignez un ticker ou un ISIN.', { error: true }); return; }
  const d = hDraft, q = numOrNull($('#hQty', m).value);
  if (q === null || q < 0) { toast('Quantité invalide.', { error: true }); return; }
  const prevType = ex ? ex.type : null;
  d.ticker = t; d.displayTicker = t.toUpperCase(); d.quantity = q; d.avgCost = numOrNull($('#hCost', m).value);
  d.price = numOrNull($('#hPrice', m).value); if (!(d.price > 0)) { d.price = null; d.priceAt = null; } else if (!ex || ex.price !== d.price) d.priceAt = todayISO();
  d.name = $('#hName', m).value.trim(); d.account = $('#hAcc', m).value; d.currency = $('#hCur', m).value; const cc = $('#hCostCur', m).value; d.costCurrency = cc === d.currency ? null : cc;
  const tv = $('#hType', m).value;
  if (tv) { const wasUnknown = ex && Engine.category(ex) === 'unknown'; d.type = tv; if (wasUnknown || (prevType !== null && prevType !== tv)) { d.typeLocked = true; d.typeSource = 'user'; } }
  if (ex && (Number(ex.quantity) !== d.quantity || (Number(ex.avgCost) || null) !== (Number(d.avgCost) || null))) d.manual = true;       // correction manuelle : protégée du recalcul par l'import d'historique
  if (Market.isISIN(t)) d.isin = t.toUpperCase();
  // secteur / pays : une saisie manuelle est protégée des actualisations ; vide = retour à l'automatique
  const secV = $('#hSector', m).value, ctyV = $('#hCountry', m).value.trim();
  if (secV || ctyV) { d.sector = secV || d.sector || null; d.country = ctyV || d.country || null; d.geoLocked = true; }
  else { if (d.geoLocked) { d.sector = null; d.country = null; } d.geoLocked = false; }
  const dv = d.dividend = d.dividend || {};
  const dvBefore = ex ? JSON.stringify([ex.dividend && ex.dividend.lastAmount, ex.dividend && ex.dividend.frequency, ex.dividend && ex.dividend.anchorMonth]) : null;
  const none = d.type === 'etf_acc' || $('#hPays', m).value === '0';
  dv.none = none;
  if (none) { dv.lastAmount = null; dv.anchorMonth = null; dv.frequency = 'none'; }
  else {
    dv.lastAmount = numOrNull($('#hDiv', m).value); dv.frequency = $('#hFreq', m).value;
    const mo = $('#hMonth', m).value; dv.anchorMonth = mo ? Number(mo) : null; dv.dateKind = $('#hKind', m).value;
    const day = $('#hDay', m).value; dv.payDay = day ? Number(day) : null; dv.taxRate = numOrNull($('#hTax', m).value);
  }
  if (none) dv.taxRate = numOrNull($('#hTax', m).value);
  // une saisie manuelle du dividende prime sur les créneaux automatiques (recalculés à la prochaine actualisation)
  if (dvBefore !== JSON.stringify([dv.lastAmount, dv.frequency, dv.anchorMonth])) dv.slots = null;
  const i = state.holdings.findIndex((h) => h.id === d.id);
  if (i >= 0) state.holdings[i] = d; else state.holdings.push(d);
  saveState(); closeModal(); toast('Actif enregistré.'); renderPage();
}

/* ===============================================================
   SUPPRESSIONS (position ≠ historique ≠ compte utilisateur)
   =============================================================== */
/* ---------------------------------------------------------------
   ACHATS D'UNE POSITION (plusieurs achats : date + nombre d'actions ; prix et frais facultatifs)
   Alimente le calcul des dividendes réellement éligibles et de la performance. La quantité et le PRU actuels de la position ne sont jamais modifiés.
   --------------------------------------------------------------- */
function openBuysModal(id) {
  const h = holdingById(id); if (!h) return;
  const cur = h.currency || 'EUR', sm = Ledger.purchaseSummary(state, h), lbl = { buy: 'Achat', sell: 'Vente', grant: 'Livraison gratuite', retire: 'Retrait' };
  const rows = sm.rows.map((r) => '<tr><td>' + esc(fmtDate(r.date)) + '</td><td>' + (r.opening ? '<span class="badge info" title="Quantité détenue au prix de revient saisi">Ouverture</span>' : esc(lbl[r.type] || r.type)) + '</td><td class="r">' + fmtNum(r.qty) + '</td><td class="r">' + (r.price == null ? '<span class="muted" title="Prix non saisi">—</span>' : fmtMoney(r.price, cur, { d: 4 })) + '</td><td class="muted">' + esc({ degiro: 'DEGIRO', csv: 'Import CSV', manual: 'Saisie' }[r.source] || r.source) + '</td><td class="r">' + (r.manual && (r.type === 'buy') ? '<button class="btn sm ghost" type="button" data-rm="' + esc(r.id) + '" aria-label="Supprimer cet achat">' + icon('trash') + '</button>' : '') + '</td></tr>').join('');
  const status = sm.negative ? '<div class="notice warn"><span>Les ventes dépassent les achats connus : historique incomplet.</span></div>'
    : sm.consistent ? '<div class="notice info"><span>✓ <b>' + fmtNum(sm.ledgerQty) + '</b> titre(s) d\'après les achats : cohérent avec la quantité détenue.' + (sm.pruCalc != null ? ' Prix de revient d\'après ces achats : <b>' + fmtMoney(sm.pruCalc, cur) + '</b>' + (Number(h.avgCost) > 0 ? ' (saisi : ' + fmtMoney(h.avgCost, h.costCurrency || cur) + ' — non modifié)' : '') + '.' : ' Au moins un prix manque : le coût et la performance de ce titre ne sont pas calculés précisément.') + '</span></div>'
    : '<div class="notice warn"><span>Achats saisis : <b>' + fmtNum(sm.ledgerQty) + '</b> sur <b>' + fmtNum(sm.holdingQty) + '</b> titre(s) détenu(s) — ' + (sm.diff > 0 ? '<b>il manque ' + fmtNum(sm.diff) + ' titre(s)</b> (achat manquant ?)' : 'les achats dépassent de ' + fmtNum(-sm.diff) + ' (vente manquante ?)') + '. Tant que ce n\'est pas cohérent, les dividendes et la performance ne sont pas calculés d\'après ces achats.</span></div>';
  const m = openModal('<h2>Achats de ' + esc(h.name || h.displayTicker || h.ticker) + '</h2><div class="sub">Ajoutez chaque achat (date + nombre d\'actions) : ils servent à calculer les <b>dividendes réellement éligibles</b> à chaque détachement et la <b>performance</b>. Votre quantité actuelle (' + fmtNum(h.quantity) + ') et votre prix de revient ne sont <b>pas modifiés</b>.</div>' + status +
    (rows ? '<div class="tbl-wrap" style="max-height:220px;margin-top:8px"><table class="tbl"><thead><tr><th>Date</th><th>Opération</th><th class="r">Quantité</th><th class="r">Prix</th><th>Source</th><th></th></tr></thead><tbody>' + rows + '</tbody></table></div>' : '<div class="muted" style="margin:8px 0">Aucun achat enregistré pour cette position.</div>') +
    '<div class="sec">Ajouter un achat</div><div class="row2">' + fld('Date d\'achat', '<input type="date" id="byDate" max="' + todayISO() + '">', '', 'byDate') + fld('Nombre d\'actions', '<input type="text" inputmode="decimal" id="byQty" placeholder="ex : 5"' + (sm.diff > 0 ? ' value="' + sm.diff + '"' : '') + ' autocomplete="off">', sm.diff > 0 ? 'prérempli avec les titres manquants' : '', 'byQty') + '</div>' +
    '<div class="row2">' + fld('Prix par action (' + cur + ', facultatif)', '<input type="text" inputmode="decimal" id="byPrice" placeholder="si connu" autocomplete="off">', 'sans prix, le titre reste valorisé sans coût inventé', 'byPrice') + fld('Frais (facultatif)', '<input type="text" inputmode="decimal" id="byFees" placeholder="0">', '', 'byFees') + '</div>' +
    '<div id="byErr" class="notice err hide"></div><div class="modal-actions"><span></span><div class="btn-row"><button class="btn" type="button" id="byAdd">' + icon('plus') + 'Ajouter cet achat</button><button class="btn primary" type="button" data-close>Terminé</button></div></div>', { wide: true, onClose: () => renderPageSoft() });
  $$('[data-rm]', m).forEach((b) => b.onclick = () => { const r = Ledger.removePurchase(state, b.dataset.rm); if (r.ok) { saveState(); openBuysModal(id); } });
  $('#byAdd', m).onclick = () => {
    const x = { date: $('#byDate', m).value, qty: numOrNull($('#byQty', m).value), price: numOrNull($('#byPrice', m).value), fees: numOrNull($('#byFees', m).value) || 0 };
    const r = Ledger.addPurchase(state, id, x, { uid, today: todayISO() });
    if (!r.ok) { const e = $('#byErr', m); e.textContent = r.error; e.classList.remove('hide'); return; }
    saveState(); openBuysModal(id); toast('Achat ajouté.', { ms: 2000 });
  };
  setTimeout(() => $('#byDate', m).focus(), 50);
}

/* ---------------------------------------------------------------
   VENDRE / CLÔTURER UNE POSITION (prix de sortie, vente partielle) : le calcul du portefeuille est ajusté
   --------------------------------------------------------------- */
function openSellModal(id, mode) {
  const h = holdingById(id); if (!h) return;
  const qty0 = Number(h.quantity) || 0, cur = h.currency || 'EUR', costCur = h.costCurrency || cur, hasTx = state.transactions.some((t) => t.holdingId === h.id && (t.type === 'buy' || t.type === 'sell'));
  const need = { pru: !hasTx && !(Number(h.avgCost) > 0), fx: costCur !== cur };
  const m = openModal('<h2>Vendre ou clôturer</h2><div class="sub"><b>' + esc(h.name || h.displayTicker || h.ticker) + '</b> · ' + fmtNum(qty0) + ' titre(s)' + (Number(h.avgCost) > 0 ? ' · prix de revient ' + fmtMoney(h.avgCost, costCur) : '') + '. Enregistrez la vente pour que le portefeuille soit ajusté : quantité restante, résultat réalisé, valeur et rendement.</div>' +
    '<div class="seg" id="slMode" role="group" aria-label="Type de vente" style="margin-bottom:10px"><button type="button" data-m="all" class="' + (mode === 'part' ? '' : 'on') + '">Clôturer toute la position</button><button type="button" data-m="part" class="' + (mode === 'part' ? 'on' : '') + '">J\'en ai vendu une partie</button></div>' +
    '<div class="row2">' + fld('Quantité vendue', '<input type="text" inputmode="decimal" id="slQty" value="' + (mode === 'part' ? '' : String(qty0)) + '"' + (mode === 'part' ? '' : ' readonly') + '>', 'sur ' + fmtNum(qty0) + ' détenu(s)', 'slQty') +
    fld('Prix de vente par titre (' + cur + ')', '<input type="text" inputmode="decimal" id="slPrice" placeholder="ex : 123,45" autocomplete="off">', 'prix auquel la vente a été exécutée', 'slPrice') + '</div>' +
    '<div class="row2">' + fld('Date de la vente', '<input type="date" id="slDate" value="' + todayISO() + '" max="' + todayISO() + '">', '', 'slDate') + fld('Frais de vente (' + cur + ', facultatif)', '<input type="text" inputmode="decimal" id="slFees" placeholder="0">', 'courtage, taxes sur la vente', 'slFees') + '</div>' +
    (need.fx ? fld('Produit net reçu en ' + costCur + ' (après frais)', '<input type="text" inputmode="decimal" id="slProceeds" placeholder="montant crédité">', 'le prix de vente est en ' + cur + ' et le prix de revient en ' + costCur + ' : sans ce montant, le résultat réalisé n\'est pas calculable', 'slProceeds') : '') +
    (!hasTx ? '<div class="notice info" style="margin:6px 0"><span>Cette position n\'a pas d\'historique d\'achats : le <b>prix de revient saisi</b> sert de coût de départ.' + (need.pru ? ' Indiquez-le ci-dessous.' : '') + ' Sans date d\'achat, le suivi de la position démarre à sa date d\'ajout dans l\'application (' + esc(fmtDate(String(h.addedAt || todayISO()).slice(0, 10))) + ').</span></div>' +
      '<div class="row2">' + fld('Date d\'achat (facultatif)', '<input type="date" id="slBuy" max="' + todayISO() + '">', 'améliore le suivi dans le temps', 'slBuy') + (need.pru ? fld('Prix de revient par titre (' + costCur + ')', '<input type="text" inputmode="decimal" id="slPru" placeholder="requis">', 'nécessaire au calcul du résultat', 'slPru') : '<div></div>') + '</div>' : '') +
    '<div id="slPrev" class="dg-summary" style="margin-top:8px"></div><div id="slErr" class="notice err hide" style="margin-top:8px"></div>' +
    '<div class="modal-actions"><span></span><div class="btn-row"><button class="btn" type="button" data-close>Annuler</button><button class="btn primary" type="button" id="slGo">Enregistrer la vente</button></div></div>', {});
  let md = mode === 'part' ? 'part' : 'all';
  const val = (i) => { const e = $('#' + i, m); return e ? numOrNull(e.value) : null; };
  const read = () => ({ qty: md === 'all' ? qty0 : val('slQty'), price: val('slPrice'), fees: val('slFees') || 0, date: $('#slDate', m).value, buyDate: $('#slBuy', m) ? $('#slBuy', m).value || null : null, pru: val('slPru'), proceedsCost: val('slProceeds') });
  const prev = () => {
    const x = read(), box = $('#slPrev', m), go = $('#slGo', m); go.textContent = md === 'all' ? 'Clôturer la position' : 'Enregistrer la vente';
    if (!(x.qty > 0) || !(x.price > 0)) { box.innerHTML = '<span class="muted">Indiquez la quantité et le prix de vente pour voir le résultat.</span>'; return; }
    const net = x.qty * x.price - (x.fees || 0), pru = Number(h.avgCost) > 0 ? Number(h.avgCost) : x.pru, left = Math.max(0, qty0 - x.qty);
    box.innerHTML = '<ul><li>Produit de la vente : <b>' + fmtMoney(net, cur) + '</b>' + (x.fees ? ' (frais ' + fmtMoney(x.fees, cur) + ' déduits)' : '') + '</li>' + (pru > 0 && !need.fx ? '<li>Résultat réalisé : <b class="' + (net - x.qty * pru >= 0 ? 'pos' : 'neg') + '">' + (net - x.qty * pru >= 0 ? '+' : '') + fmtMoney(net - x.qty * pru, costCur) + '</b> (' + fmtPct((net - x.qty * pru) / (x.qty * pru), 1, true) + ' sur le coût)</li>' : '') +
      '<li>' + (left > 1e-8 ? 'Reste en portefeuille : <b>' + fmtNum(left) + '</b> titre(s), prix de revient inchangé' : 'La position quitte le portefeuille actuel (conservée dans « Clôturées » avec son résultat)') + '</li></ul>';
  };
  $$('#slMode [data-m]', m).forEach((b) => b.onclick = () => { md = b.dataset.m; $$('#slMode [data-m]', m).forEach((c) => c.classList.toggle('on', c === b)); const q = $('#slQty', m); q.readOnly = md === 'all'; if (md === 'all') q.value = String(qty0); else { q.value = ''; q.focus(); } prev(); });
  m.addEventListener('input', prev); prev(); setTimeout(() => $('#slPrice', m).focus(), 50);
  $('#slGo', m).onclick = () => {
    const x = read(), e = $('#slErr', m); e.classList.add('hide');
    const prevUndo = state.undo; snapshotForUndo('vente de ' + (h.name || h.ticker));
    const r = Ledger.recordSale(state, h.id, x, { uid, today: todayISO() });
    if (!r.ok) { if (prevUndo) state.undo = prevUndo; else delete state.undo; e.textContent = r.error; e.classList.remove('hide'); return; }
    saveState(); closeModal(); renderPage();
    const res = r.realized == null ? '' : ' · résultat réalisé ' + (r.realized >= 0 ? '+' : '') + fmtMoney(r.realized, r.cur);
    toast((r.closed ? 'Position clôturée' : 'Vente partielle enregistrée (reste ' + fmtNum(r.remaining) + ')') + res + (r.warnings.length ? ' · ' + r.warnings[0] : '') + '.', { ms: 12000, action: { label: 'Annuler', fn: undoLastImport } });
  };
}

/* Avant de supprimer UNE position détenue : la position a-t-elle été vendue ? (prix de sortie, vente partielle) → le portefeuille est alors ajusté au lieu de simplement effacer. */
function askClosingReason(h) {
  return new Promise((resolve) => {
    let done = false;
    const m = openModal('<h2>Que s\'est-il passé ?</h2><div class="sub"><b>' + esc(h.name || h.displayTicker || h.ticker) + '</b> · ' + fmtNum(h.quantity) + ' titre(s). Si la position a été vendue, enregistrez le prix de vente : le résultat réalisé et le calcul du portefeuille seront ajustés.</div>' +
      '<div class="choice-list"><button class="btn" type="button" data-c="all">Je l\'ai vendue en totalité (clôturer) — indiquer le prix</button><button class="btn" type="button" data-c="part">J\'en ai vendu une partie seulement — indiquer la quantité et le prix</button><button class="btn danger" type="button" data-c="delete">Je l\'ai ajoutée par erreur : supprimer sans enregistrer de vente</button></div>' +
      '<div class="modal-actions"><span></span><button class="btn" type="button" data-close>Annuler</button></div>', { onClose: () => { if (!done) { done = true; resolve(null); } } });
    $$('[data-c]', m).forEach((b) => b.onclick = () => { done = true; closeModal(); resolve(b.dataset.c); });
  });
}

async function confirmDeleteHoldings(ids) {
  const hs = ids.map(holdingById).filter(Boolean); if (!hs.length) return;
  if (hs.length === 1 && Number(hs[0].quantity) > 0) { const why = await askClosingReason(hs[0]); if (!why) return; if (why !== 'delete') { openSellModal(hs[0].id, why); return; } }
  const idset = new Set(ids);
  const nPay = state.payments.filter((p) => idset.has(p.holdingId)).length, nTx = state.transactions.filter((t) => idset.has(t.holdingId)).length;
  const c = await confirmDialog({
    title: 'Supprimer ' + hs.length + ' position' + (hs.length > 1 ? 's' : '') + ' ?',
    body: '<b>' + hs.slice(0, 6).map((h) => esc(h.name || h.displayTicker || h.ticker)).join(', ') + (hs.length > 6 ? '…' : '') + '</b><br><br>' +
      'Seules les <b>positions</b> du portefeuille sont supprimées. ' + (nPay + nTx ? 'Les <b>' + nPay + '</b> versement(s) et <b>' + nTx + '</b> opération(s) associés restent dans l\'Historique, sauf si vous cochez ci-dessous.' : 'Aucun versement ni opération n\'est associé.') + '<br>Votre compte utilisateur n\'est pas concerné.',
    checkbox: nPay + nTx ? { label: 'Supprimer aussi leur historique (versements et opérations)', checked: false } : null,
    confirmLabel: 'Supprimer ' + hs.length + ' position' + (hs.length > 1 ? 's' : ''), danger: true
  });
  if (!c.ok) return;
  const snap = { holdings: clone(state.holdings), payments: clone(state.payments), transactions: clone(state.transactions) };
  state.holdings = state.holdings.filter((h) => !idset.has(h.id));
  if (c.checked) { state.payments = state.payments.filter((p) => !idset.has(p.holdingId)); state.transactions = state.transactions.filter((t) => !idset.has(t.holdingId)); }
  Object.keys(view.tables || {}).forEach((k) => { if (k.indexOf('portfolio') === 0) hs.forEach((h) => view.tables[k].sel.delete(h.id)); });
  saveState(); renderPage();
  toast(hs.length + ' position' + (hs.length > 1 ? 's supprimées' : ' supprimée') + '.', { action: { label: 'Annuler', fn: () => { state.holdings = snap.holdings; state.payments = snap.payments; state.transactions = snap.transactions; saveState(); renderPage(); toast('Suppression annulée.'); } } });
}
async function confirmDeletePayments(ids) {
  const c = await confirmDialog({ title: 'Supprimer ' + ids.length + ' versement' + (ids.length > 1 ? 's' : '') + ' ?', body: 'Ces versements disparaîtront de l\'historique et des totaux « reçus ». Vos positions ne sont pas modifiées.', confirmLabel: 'Supprimer', danger: true });
  if (!c.ok) return;
  const snap = clone(state.payments), set = new Set(ids);
  state.payments = state.payments.filter((p) => !set.has(p.id)); if (view.tables.history) view.tables.history.sel.clear();
  saveState(); renderPage();
  toast(ids.length + ' versement(s) supprimé(s).', { action: { label: 'Annuler', fn: () => { state.payments = snap; saveState(); renderPage(); } } });
}
async function confirmDeleteTransactions(ids) {
  const c = await confirmDialog({ title: 'Supprimer ' + ids.length + ' opération' + (ids.length > 1 ? 's' : '') + ' ?', body: 'Les quantités et prix de revient de vos positions ne sont <b>pas</b> recalculés automatiquement.', confirmLabel: 'Supprimer', danger: true });
  if (!c.ok) return;
  const snap = clone(state.transactions), set = new Set(ids);
  state.transactions = state.transactions.filter((t) => !set.has(t.id)); if (view.tables.transactions) view.tables.transactions.sel.clear();
  saveState(); renderPage();
  toast(ids.length + ' opération(s) supprimée(s).', { action: { label: 'Annuler', fn: () => { state.transactions = snap; saveState(); renderPage(); } } });
}

/* ===============================================================
   VERSEMENT (saisie / modification)
   =============================================================== */
function openPaymentModal(id, preset) {
  const ex = id ? state.payments.find((p) => p.id === id) : null;
  const p = ex ? clone(ex) : Object.assign({ id: uid(), holdingId: (view.account !== 'all' ? (visibleHoldings()[0] || {}).id : (state.holdings[0] || {}).id) || '', exDate: '', payDate: todayISO(), qty: null, perShare: null, gross: null, tax: null, fees: null, net: null, currency: 'EUR', source: 'manual', verified: true }, preset || {});
  if (!state.holdings.length && !ex) { toast("Ajoutez d'abord un actif.", { error: true }); return; }
  const hs = state.holdings.slice().sort((a, b) => (a.name || a.ticker).localeCompare(b.name || b.ticker));
  const m = openModal('<h2>' + (ex ? 'Modifier' : 'Ajouter') + ' un versement</h2><div class="sub">Dividende effectivement reçu. Le net est calculé : brut − retenue − frais.</div>' +
    fld('Actif', '<select id="pH">' + hs.map((h) => opt(h.id, (h.name || h.displayTicker || h.ticker) + ' (' + (h.displayTicker || h.ticker) + ')', h.id === p.holdingId)).join('') + (ex && !holdingById(p.holdingId) ? opt(p.holdingId, (p.name || p.ticker) + ' (position supprimée)', true) : '') + '</select>', '', 'pH') +
    '<div class="row2">' + fld('Date de paiement', '<input type="date" id="pPay" value="' + esc(p.payDate || '') + '">', '', 'pPay') + fld('Date de détachement (facultatif)', '<input type="date" id="pEx" value="' + esc(p.exDate || '') + '">', '', 'pEx') + '</div>' +
    '<div class="row2">' + fld('Quantité détenue', '<input type="number" id="pQty" step="any" inputmode="decimal" value="' + esc(p.qty === null ? '' : p.qty) + '">', 'Par défaut : quantité à la date', 'pQty') + fld('Montant par titre', '<input type="number" id="pPer" step="any" inputmode="decimal" value="' + esc(p.perShare === null || p.perShare === undefined ? '' : p.perShare) + '">', '', 'pPer') + '</div>' +
    '<div class="row2">' + fld('Montant brut', '<input type="number" id="pGross" step="any" inputmode="decimal" value="' + esc(p.gross === null ? '' : p.gross) + '">', '', 'pGross') + fld('Retenue à la source / impôt', '<input type="number" id="pTax" step="any" inputmode="decimal" value="' + esc(p.tax === null || p.tax === undefined ? '' : Math.abs(p.tax)) + '">', '', 'pTax') + '</div>' +
    '<div class="row2">' + fld('Frais', '<input type="number" id="pFees" step="any" inputmode="decimal" value="' + esc(p.fees === null || p.fees === undefined ? '' : p.fees) + '">', '', 'pFees') + fld('Net reçu', '<input type="number" id="pNet" step="any" inputmode="decimal" value="' + esc(p.net === null || p.net === undefined ? '' : p.net) + '">', 'Laissez vide si inconnu', 'pNet') + '</div>' +
    fld('Devise', '<select id="pCur">' + (CURRENCIES.indexOf(p.currency) < 0 ? [p.currency] : []).concat(CURRENCIES).map((c) => opt(c, c, c === p.currency)).join('') + '</select>', '', 'pCur') +
    '<div class="modal-actions"><div>' + (ex ? '<button class="btn danger" type="button" id="pDel">' + icon('trash') + 'Supprimer</button>' : '') + '</div><div class="btn-row"><button class="btn" type="button" data-close>Annuler</button><button class="btn primary" type="button" id="pSave">Enregistrer</button></div></div>');
  const g = (i) => numOrNull($('#' + i, m).value);
  let netTouched = !!(ex && ex.net != null);
  const recalc = () => {
    const q = g('pQty'), per = g('pPer');
    if (g('pGross') === null && q && per) $('#pGross', m).value = Math.round(q * per * 100) / 100;
    if (!netTouched) { const gr = g('pGross'), tx = g('pTax'), fe = g('pFees'); $('#pNet', m).value = gr !== null && (tx !== null || fe !== null) ? Math.round((gr - (tx || 0) - (fe || 0)) * 100) / 100 : ''; }
  };
  ['pQty', 'pPer', 'pGross', 'pTax', 'pFees'].forEach((i) => $('#' + i, m).addEventListener('input', recalc));
  $('#pNet', m).addEventListener('input', () => { netTouched = $('#pNet', m).value !== ''; });
  const fillFromHolding = () => {
    const h = holdingById($('#pH', m).value); if (!h) return;
    $('#pCur', m).value = h.currency;
    if (!$('#pQty', m).value) $('#pQty', m).value = Engine.quantityAt(state, h, $('#pPay', m).value || $('#pEx', m).value || todayISO());
    if (!$('#pPer', m).value && h.dividend && h.dividend.lastAmount && !ex) $('#pPer', m).value = h.dividend.lastAmount;
    if (h.dividend && h.dividend.taxRate != null && !$('#pTax', m).value && !ex) { /* proposé seulement après saisie du brut */ }
    recalc();
  };
  $('#pH', m).onchange = () => { $('#pQty', m).value = ''; fillFromHolding(); };
  if (!ex && !p.qty) fillFromHolding();
  if (ex) $('#pDel', m).onclick = () => { closeModal(); confirmDeletePayments([ex.id]); };
  $('#pSave', m).onclick = () => {
    const h = holdingById($('#pH', m).value), gross = g('pGross');
    const payDate = $('#pPay', m).value || null, exDate = $('#pEx', m).value || null;
    if (!payDate && !exDate) { toast('Indiquez au moins une date.', { error: true }); return; }
    if (gross === null || gross < 0) { toast('Indiquez le montant brut.', { error: true }); return; }
    const tax = g('pTax'), fees = g('pFees'); let net = g('pNet');
    if (net === null && (tax !== null || fees !== null)) net = Math.round((gross - (tax || 0) - (fees || 0)) * 100) / 100;
    const np = Object.assign({}, p, { holdingId: $('#pH', m).value, ticker: h ? (h.displayTicker || h.ticker) : p.ticker, name: h ? h.name : p.name, payDate, exDate, qty: g('pQty') || 0, perShare: g('pPer'),
      gross, tax: tax === null ? null : Math.abs(tax), fees, net, currency: $('#pCur', m).value, verified: true, source: ex ? ex.source : 'manual' });
    const dup = state.payments.find((x) => x.id !== np.id && Engine.paymentKey(x) === Engine.paymentKey(np));
    if (dup) { toast('Ce versement existe déjà (même actif, même date, même montant).', { error: true }); return; }
    const i = state.payments.findIndex((x) => x.id === np.id);
    if (i >= 0) state.payments[i] = np; else state.payments.push(np);
    saveState(); closeModal(); toast('Versement enregistré.'); renderPage();
  };
}

/* Valide d'un coup les versements générés d'après l'historique de marché (ils deviennent des versements « reçus »). */
async function runValidateAll() {
  const n = state.payments.filter((p) => p.verified === false).length; if (!n) return;
  const c = await confirmDialog({ title: 'Valider ' + n + ' versement(s) ?', body: 'Ces versements ont été générés d\'après les dates de détachement passées, avec votre quantité actuelle et le montant brut théorique (sans retenue ni frais réels). Une fois validés, ils comptent comme <b>dividendes reçus</b>.', confirmLabel: 'Tout valider' });
  if (!c.ok) return;
  state.payments.forEach((p) => { if (p.verified === false) p.verified = true; });
  saveState(); renderPage(); toast(n + ' versement(s) validé(s).');
}

/* Pré-remplissage d'après les dates de détachement passées (« à vérifier ») */
async function runPrefill() {
  const since = (new Date().getFullYear() - 1) + '-01-01';
  const gen = Engine.prefillPayments(state, state.holdings, uid, since);
  if (!gen.length) { toast(state.holdings.some((h) => (h.dividend || {}).history && h.dividend.history.length) ? 'Rien de nouveau à ajouter.' : "Aucun historique de marché : actualisez d'abord les données (Portefeuille → Actualiser).", { ms: 5000 }); return; }
  const c = await confirmDialog({ title: 'Pré-remplir l\'historique ?', body: '<b>' + gen.length + '</b> versement(s) seront créés d\'après les dates de détachement passées depuis le 1er janvier ' + (new Date().getFullYear() - 1) + ', en supposant votre quantité actuelle.<br><br>Ils sont marqués <b>« À vérifier »</b> (montant brut théorique, sans retenue ni frais réels). Vous pourrez les corriger ou les supprimer.', confirmLabel: 'Créer ' + gen.length + ' versement(s)' });
  if (!c.ok) return;
  state.payments.push.apply(state.payments, gen); saveState(); renderPage(); toast(gen.length + ' versement(s) créés, à vérifier.');
}

/* ===============================================================
   HISTORIQUE DES DIVIDENDES REÇUS (reconstitué : opérations importées × dividendes passés des données de marché)
   Rien n'est enregistré avant validation ; aucun versement existant n'est modifié ni supprimé ; aucune retenue ni frais inventé.
   =============================================================== */
async function runDividendHistory() {
  if (!state.settings.relayUrl) { toast('Renseignez d\'abord le relais de données (Paramètres) : l\'historique des dividendes vient des données de marché.', { error: true }); return; }
  const hs = visibleHoldings().filter((h) => !Engine.isAccumulating(h) && h.ticker);
  if (!hs.length) { toast('Aucune action ou ETF distribuant à analyser.', { ms: 5000 }); return; }
  let cancelled = false;
  const m = openModal('<h2>Recherche des dividendes passés</h2><div class="sub">Analyse de vos positions, de vos opérations importées et de l\'historique des dividendes (données de marché Yahoo). Rien n\'est enregistré avant votre validation.</div><div class="progress"><i id="dhBar" style="width:0%"></i></div><div id="dhMsg" class="hint" style="margin-top:8px">Préparation…</div><div class="modal-actions"><span></span><button class="btn" type="button" data-close>Annuler</button></div>', { onClose: () => { cancelled = true; } });
  const errors = []; let done = 0; const weekAgo = Date.now() - 7 * 86400000;
  for (const h of hs) {
    if (cancelled) return;
    const msg = $('#dhMsg', m); if (msg) msg.textContent = 'Dividendes de ' + (h.name || h.displayTicker || h.ticker) + ' (' + (done + 1) + ' / ' + hs.length + ')…';
    if (!h.divHist || !h.divHist.at || Date.parse(h.divHist.at) < weekAgo) {
      try { const r = await market.fetchDividends(h.ticker, h.name); h.divHist = { at: new Date().toISOString(), symbol: r.symbol, items: r.items }; }
      catch (e) { errors.push((h.name || h.ticker) + ' : ' + e.message); if (e.rate || e.fatal) { done = hs.length; break; } }
      await new Promise((r) => setTimeout(r, 250));
    }
    done++; const bar = $('#dhBar', m); if (bar) bar.style.width = Math.round(100 * done / hs.length) + '%';
  }
  if (cancelled) return;
  saveState(); closeModal();
  openDividendReview(Engine.dividendProposals(state, new Date(), uid, { ids: new Set(visibleHoldings().map((h) => h.id)) }), errors);
}

function openDividendReview(res, errors) {
  const rows = res.proposals, cur = (r) => r.currency || 'EUR';
  const skipped = res.unverifiable.length + res.noData.length + res.accumulating.length + res.notFetched.length + (errors ? errors.length : 0);
  const chip = (n, label, cls) => '<div class="card stat-chip"><span>' + label + '</span><b class="' + (n ? cls : '') + '">' + n + '</b></div>';
  const body = rows.length ? '<div class="tbl-wrap" style="max-height:340px"><table class="tbl"><thead><tr><th class="chk-col"><input type="checkbox" id="dhAll" checked aria-label="Tout sélectionner"></th><th>Titre</th><th>Détachement</th><th class="r">Qté éligible</th><th class="r">Par titre</th><th class="r">Brut</th><th class="r">Retenue</th><th class="r">Net</th><th>Fiabilité</th></tr></thead><tbody>' + rows.map((r, i) =>
    '<tr><td class="chk-col"><input type="checkbox" data-dh="' + i + '" checked aria-label="Ajouter"></td><td><b>' + esc(r.name) + '</b><div class="dg-note">' + esc(r.ticker) + '</div></td><td>' + esc(fmtDate(r.exDate)) + '<div class="dg-note">paiement : date non fournie</div></td>' +
    '<td class="r">' + fmtNum(r.qty) + '</td><td class="r">' + fmtMoney(r.perShare, cur(r), { d: 4 }) + '</td><td class="r">' + fmtMoney(r.gross, cur(r)) + '</td><td class="r">' + (r.tax == null ? '<span class="muted" title="Retenue non renseignée : non inventée">—</span>' : fmtMoney(r.tax, cur(r))) + '</td>' +
    '<td class="r">' + (r.net == null ? '<span class="muted" title="Net inconnu : compté en brut">—</span>' : fmtMoney(r.net, cur(r))) + '</td><td><span class="badge warn">Estimé</span><div class="dg-note">données de marché' + (r.net == null ? ' · net inconnu' : '') + '</div></td></tr>').join('') + '</tbody></table></div>'
    : '<div class="notice info">Aucun dividende nouveau à ajouter : ' + (res.already.length ? 'tout ce qui était éligible est déjà enregistré.' : 'aucun versement éligible trouvé pour vos positions d\'après vos opérations importées.') + '</div>';
  const skipTxt = [].concat(res.unverifiable.map((x) => '<li><b>' + esc(x.name) + '</b> — ' + esc(x.reason) + ' <button class="btn sm" type="button" data-buys="' + esc(x.id) + '">Saisir les achats</button></li>'), res.noData.map((n) => '<li><b>' + esc(n) + '</b> — aucun dividende trouvé dans les données de marché</li>'),
    res.accumulating.map((n) => '<li><b>' + esc(n) + '</b> — ETF capitalisant : aucun dividende perçu</li>'), res.notFetched.map((n) => '<li><b>' + esc(n) + '</b> — données de dividendes non récupérées</li>'), (errors || []).map((e) => '<li>' + esc(e) + '</li>')).join('');
  const m = openModal('<h2>Dividendes passés à vérifier</h2><div class="sub">D\'après vos opérations importées (quantité détenue la veille de chaque détachement) et l\'historique des dividendes en espèces des données de marché. Ces montants sont des <b>estimations</b> : la date de paiement et les retenues réelles ne sont pas connues. Cochez ceux à comptabiliser.</div>' +
    '<div class="chips-row">' + chip(rows.length, 'À valider', 'pos') + chip(res.already.length, 'Déjà enregistrés (ignorés)', '') + chip(res.notEligible, 'Non éligibles (non détenus)', '') + chip(skipped, 'Titres non calculables', 'warn-t') + '</div>' + body +
    '<div id="dhTotal" class="hint" style="margin-top:8px"></div>' + (skipTxt ? '<details class="dg-cols" open><summary>Titres non calculables ou ignorés (' + skipped + ')</summary><ul style="margin:8px 0 0 18px;max-height:150px;overflow:auto">' + skipTxt + '</ul><div class="hint">Importez l\'historique de transactions DEGIRO pour qu\'un titre sans opérations devienne calculable : sa date d\'achat n\'est jamais supposée.</div></details>' : '') +
    '<div class="modal-actions"><span class="hint">Les versements existants ne sont ni modifiés ni supprimés.</span><div class="btn-row"><button class="btn" type="button" data-close>Fermer</button>' + (rows.length ? '<button class="btn primary" type="button" id="dhGo">Ajouter la sélection</button>' : '') + '</div></div>', { wide: true });
  $$('[data-buys]', m).forEach((b) => b.onclick = () => { closeModal(); openBuysModal(b.dataset.buys); });
  if (!rows.length) return;
  const sel = () => $$('[data-dh]', m).filter((c) => c.checked).map((c) => rows[Number(c.dataset.dh)]);
  const upd = () => { const ch = sel(), tot = ch.reduce((s, r) => { const v = convert(r.gross, cur(r)); return v === null ? s : s + v; }, 0); $('#dhTotal', m).innerHTML = '<b>' + ch.length + '</b> versement(s) sélectionné(s) · brut estimé <b>' + money(tot) + '</b> (convertis dans la devise d\'affichage)'; $('#dhGo', m).disabled = !ch.length; $('#dhGo', m).textContent = 'Ajouter la sélection (' + ch.length + ')'; };
  m.addEventListener('change', (e) => { if (e.target.id === 'dhAll') $$('[data-dh]', m).forEach((c) => { c.checked = e.target.checked; }); if (e.target.matches('[data-dh],#dhAll')) upd(); });
  $('#dhGo', m).onclick = () => {
    const ch = sel(); if (!ch.length) return;
    snapshotForUndo('ajout de dividendes historiques');
    // dernier garde-fou anti-doublon : on recalcule contre l'état actuel juste avant d'écrire
    const keep = ch.filter((r) => !state.payments.some((p) => p.holdingId === r.holdingId && p.exDate === r.exDate));
    state.payments.push.apply(state.payments, keep.map((r) => Object.assign({}, r, { id: uid() }))); saveState(); closeModal(); renderPage();
    toast(keep.length + ' dividende(s) historique(s) ajouté(s) (estimés).', { ms: 12000, action: { label: 'Annuler', fn: undoLastImport } });
  };
  upd();
}

/* ===============================================================
   PORTEFEUILLES / COMPTES
   =============================================================== */
/* Création rapide d'un autre portefeuille (compte-titres) ; il devient le portefeuille affiché. */
function openNewAccountModal(onDone) {
  const m = openModal('<h2>Nouveau portefeuille</h2><div class="sub">Par exemple un deuxième compte-titres, un PEA ou le compte d\'un proche. Les actifs et l\'historique s\'y rattachent à l\'ajout ou à l\'import.</div>' +
    fld('Nom du portefeuille', '<input type="text" id="naName" placeholder="ex : PEA, DEGIRO, Trade Republic" maxlength="40" autocomplete="off">', '', 'naName') +
    '<div class="modal-actions"><span></span><div class="btn-row"><button class="btn" type="button" data-close>Annuler</button><button class="btn primary" type="button" id="naGo">Créer</button></div></div>', {});
  const go = () => {
    const v = $('#naName', m).value.trim(); if (!v) { $('#naName', m).focus(); return; }
    if (state.accounts.some((a) => a.name.toLowerCase() === v.toLowerCase())) { toast('Un portefeuille « ' + v + ' » existe déjà.', { error: true }); return; }
    const a = { id: uid(), name: v }; state.accounts.push(a); view.account = a.id; saveState(); closeModal(); renderPage(); toast('Portefeuille « ' + v + ' » créé.'); if (onDone) onDone(a);
  };
  $('#naGo', m).onclick = go; $('#naName', m).onkeydown = (e) => { if (e.key === 'Enter') go(); }; setTimeout(() => $('#naName', m).focus(), 50);
}
function openAccountsModal() {
  const rows = state.accounts.map((a) => '<div class="list-row" data-id="' + esc(a.id) + '"><input type="text" value="' + esc(a.name) + '" data-rename="' + esc(a.id) + '" aria-label="Nom"><span class="muted" style="white-space:nowrap">' + state.holdings.filter((h) => h.account === a.id).length + ' actif(s)</span><button class="btn sm icon ghost" type="button" data-del="' + esc(a.id) + '" aria-label="Supprimer" ' + (state.accounts.length <= 1 ? 'disabled' : '') + '>' + icon('trash') + '</button></div>').join('');
  const m = openModal('<h2>Portefeuilles / comptes-titres</h2><div class="sub">Séparez par exemple votre CTO et votre PEA. Chaque actif est rattaché à un portefeuille.</div>' + rows +
    '<div class="list-row"><input type="text" id="newAcc" placeholder="Nom du nouveau portefeuille"><button class="btn primary sm" type="button" id="addAcc">Ajouter</button></div><div class="modal-actions"><span></span><button class="btn" type="button" data-close>Fermer</button></div>');
  $$('[data-rename]', m).forEach((i) => i.onchange = () => { const a = state.accounts.find((x) => x.id === i.dataset.rename); if (a && i.value.trim()) { a.name = i.value.trim(); saveState(); renderPage(); } });
  $$('[data-del]', m).forEach((b) => b.onclick = async () => {
    const id = b.dataset.del, n = state.holdings.filter((h) => h.account === id).length, fb = state.accounts.find((a) => a.id !== id);
    const c = await confirmDialog({ title: 'Supprimer ce portefeuille ?', body: n ? n + ' actif(s) seront déplacés vers « ' + esc(fb.name) + ' » (aucun actif n\'est supprimé).' : 'Ce portefeuille est vide.', confirmLabel: 'Supprimer', danger: true });
    if (!c.ok) { openAccountsModal(); return; }
    state.holdings.forEach((h) => { if (h.account === id) h.account = fb.id; }); (state.archive || []).forEach((h) => { if (h.account === id) h.account = fb.id; });
    state.accounts = state.accounts.filter((a) => a.id !== id); if (view.account === id) view.account = 'all';
    saveState(); renderPage(); openAccountsModal();
  });
  $('#addAcc', m).onclick = () => { const v = $('#newAcc', m).value.trim(); if (!v) return; state.accounts.push({ id: uid(), name: v }); saveState(); renderPage(); openAccountsModal(); };
}

/* ===============================================================
   LECTURE DE FICHIERS (CSV / Excel)
   =============================================================== */
function readFileRows(file) {
  return new Promise((resolve, reject) => {
    const name = file.name.toLowerCase(), r = new FileReader();
    if (name.endsWith('.csv') || name.endsWith('.txt')) {
      r.onload = () => {
        if (typeof Papa === 'undefined') return reject(new Error('Bibliothèque CSV indisponible (hors-ligne ?).'));
        let text = r.result; if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
        resolve(Papa.parse(text, { header: false, skipEmptyLines: true }).data);
      };
      r.readAsText(file, 'UTF-8');
    } else if (name.endsWith('.xlsx') || name.endsWith('.xls')) {
      r.onload = () => {
        if (typeof XLSX === 'undefined') return reject(new Error('Bibliothèque Excel indisponible (hors-ligne ?).'));
        const wb = XLSX.read(new Uint8Array(r.result), { type: 'array' });
        resolve(XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: false, defval: '', dateNF: 'yyyy-mm-dd' }));
      };
      r.readAsArrayBuffer(file);
    } else reject(new Error('Format non pris en charge : utilisez un fichier .csv ou .xlsx.'));
    r.onerror = () => reject(new Error('Lecture du fichier impossible.'));
  });
}
function pickFile(accept) {
  return new Promise((resolve) => {
    const i = document.createElement('input'); i.type = 'file'; i.accept = accept; i.style.display = 'none';
    i.onchange = () => { resolve(i.files[0] || null); i.remove(); };
    document.body.appendChild(i); i.click();
  });
}
const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
function guessHeaderRow(rows, kws) {
  for (let i = 0; i < Math.min(10, rows.length); i++) { const c = (rows[i] || []).map(norm); if (kws.every((k) => c.some((x) => k.some((w) => x.includes(w))))) return i; }
  return 0;
}
function colSelect(id, headerRow, sel, allowNone) {
  let o = allowNone === false ? '' : '<option value="-1">— Ignorer —</option>';
  headerRow.forEach((h, i) => { o += '<option value="' + i + '"' + (i === sel ? ' selected' : '') + '>' + esc(h || ('Colonne ' + (i + 1))) + '</option>'; });
  return '<select id="' + id + '">' + o + '</select>';
}
function guessCol(headerRow, kws, exclude) { const hs = headerRow.map(norm); for (let i = 0; i < hs.length; i++) { if (exclude && exclude.some((x) => hs[i] === x)) continue; if (kws.some((k) => hs[i] === k)) return i; } for (let i = 0; i < hs.length; i++) { if (kws.some((k) => hs[i].includes(k))) return i; } return -1; }
function previewTable(rows, headerIdx, n) {
  return '<div class="tbl-wrap" style="max-height:200px"><table class="tbl"><tbody>' + rows.slice(0, n || 8).map((r, i) => '<tr style="' + (i === headerIdx ? 'font-weight:700;background:var(--accent-soft)' : '') + '"><td class="muted">' + (i + 1) + '</td>' + r.map((c) => '<td>' + esc(c) + '</td>').join('') + '</tr>').join('') + '</tbody></table></div>';
}

/* ===============================================================
   IMPORT DES POSITIONS (relevé de portefeuille : DEGIRO, Trade Republic…)
   =============================================================== */
async function openImportPositions() { return routeImport('positions'); }
function renderPositionsMapping(rows, hIdx) {
  const head = rows[hIdx] || [], n = Math.max.apply(null, rows.map((r) => r.length));
  while (head.length < n) head.push('');
  const T = guessCol(head, ['symbole/isin', 'symbole', 'symbol', 'ticker', 'isin', 'code']), Q = guessCol(head, ['quantite', 'quantity', 'nombre', 'qte', 'qty', 'position', 'en portefeuille']), N = guessCol(head, ['produit', 'nom', 'name', 'societe', 'company', 'libelle']);
  const C = guessCol(head, ['prix de revient', 'pru', 'cout moyen', 'average cost', 'prix moyen', 'average price']), U = guessCol(head, ['devise locale', 'devise', 'currency']);
  const m = openModal('<h2>Importer un relevé de portefeuille</h2><div class="sub">Choisissez les colonnes. La ligne surlignée dans l\'aperçu est l\'en-tête.</div>' +
    fld('Ligne d\'en-tête', '<select id="mH">' + rows.slice(0, 10).map((r, i) => opt(i, 'Ligne ' + (i + 1) + ' — ' + r.slice(0, 3).join(' / '), i === hIdx)).join('') + '</select>', '', 'mH') +
    '<div class="row2">' + fld('Ticker ou ISIN', colSelect('mT', head, T, false), '', 'mT') + fld('Quantité', colSelect('mQ', head, Q, false), '', 'mQ') + '</div>' +
    '<div class="row2">' + fld('Nom (facultatif)', colSelect('mN', head, N), '', 'mN') + fld('Prix de revient unitaire (facultatif)', colSelect('mC', head, C), 'Ne choisissez pas « Clôture » : ce n\'est pas votre prix d\'achat.', 'mC') + '</div>' +
    '<div class="row2">' + fld('Devise (facultatif)', colSelect('mU', head, U), '', 'mU') + fld('Portefeuille de destination', '<select id="mA">' + state.accounts.map((a) => opt(a.id, a.name, (view.account !== 'all' ? view.account : state.accounts[0].id) === a.id)).join('') + '</select>', '', 'mA') + '</div>' +
    '<div id="mSummary" class="notice info" style="margin-top:6px"></div><span class="hint">Les actifs déjà présents (même ISIN, ticker ou nom) sont <b>conservés tels quels</b> : quantité, PRU et toutes leurs données restent inchangés. Seuls les nouveaux actifs sont ajoutés, puis leurs données de marché sont récupérées automatiquement.</span><div class="sec">Aperçu</div>' + previewTable(rows, hIdx) +
    '<div class="modal-actions"><span></span><div class="btn-row"><button class="btn" type="button" data-close>Annuler</button><button class="btn primary" type="button" id="mGo">Importer</button></div></div>', { wide: true });
  $('#mH', m).onchange = (e) => renderPositionsMapping(rows, Number(e.target.value));
  const cols = () => ({ t: Number($('#mT', m).value), q: Number($('#mQ', m).value), nm: Number($('#mN', m).value), cc: Number($('#mC', m).value), cu: Number($('#mU', m).value), acc: $('#mA', m).value });
  const refresh = () => {
    const c = cols(); const sm = $('#mSummary', m);
    if (c.t < 0 || c.q < 0) { sm.innerHTML = '<span>Choisissez les colonnes ticker / ISIN et quantité.</span>'; return null; }
    const r = classifyPositions(rows, hIdx, c);
    sm.innerHTML = '<span><b>' + r.fresh.length + '</b> nouvel(s) actif(s) à ajouter · <b>' + r.dups.length + '</b> déjà présent(s) <b>conservé(s) sans modification</b>' + (r.bad ? ' · ' + r.bad + ' ligne(s) ignorée(s)' : '') + '</span>' +
      (r.dateLike ? '<div class="warn-t" style="margin-top:4px">⚠ ' + r.dateLike + ' valeur(s) de la colonne Quantité ressemblent à des <b>dates</b> : mauvaise colonne choisie ? (ces lignes sont ignorées, jamais lues comme des nombres).</div>' : '') +
      (r.yearLike ? '<div class="warn-t" style="margin-top:4px">⚠ ' + r.yearLike + ' quantité(s) comprise(s) entre 1900 et 2100 : vérifiez qu\'il ne s\'agit pas d\'années.</div>' : '');
    return r;
  };
  $$('select', m).forEach((x) => x.addEventListener('change', (e) => { if (e.target.id !== 'mH') refresh(); }));
  refresh();
  $('#mGo', m).onclick = async () => {
    const c = cols(); if (c.t < 0 || c.q < 0) { toast('Sélectionnez au minimum les colonnes ticker et quantité.', { error: true }); return; }
    const r = classifyPositions(rows, hIdx, c), added = r.fresh;
    if (!added.length) { closeModal(); toast('Aucun nouvel actif : ' + r.dups.length + ' déjà présent(s), conservé(s) tel(s) quel(s)' + (r.bad ? ' · ' + r.bad + ' ligne(s) invalide(s) (colonnes mal choisies ?)' : '') + '.', { ms: 6000 }); return; }
    // Les actifs existants ne sont JAMAIS modifiés : on n'ajoute que les nouveaux.
    state.holdings.push.apply(state.holdings, added); saveState(); closeModal(); renderPage();
    toast(added.length + ' nouvel(s) actif(s) ajouté(s) · ' + r.dups.length + ' déjà présent(s) conservé(s) sans modification' + (r.bad ? ' · ' + r.bad + ' ligne(s) ignorée(s)' : '') + '.', { ms: 6000 });
    if (state.settings.relayUrl) await refreshMarket(added);
  };
}

/* Sépare les lignes d'un relevé en NOUVEAUX actifs et actifs DÉJÀ PRÉSENTS (même portefeuille).
   Un actif est « déjà présent » s'il porte le même ISIN, le même ticker ou, à défaut, le même nom
   (cas d'un ancien actif dont l'ISIN n'a pas été conservé). */
function classifyPositions(rows, hIdx, c) {
  const inAcc = state.holdings.filter((h) => h.account === c.acc);
  const keys = new Set(), names = new Set();
  inAcc.forEach((h) => { [h.ticker, h.displayTicker, h.isin].forEach((k) => { if (k) keys.add(String(k).trim().toUpperCase()); }); if (h.name) names.add(norm(h.name)); });
  const fresh = [], dups = []; let bad = 0, dateLike = 0, yearLike = 0;
  rows.slice(hIdx + 1).forEach((r) => {
    const tk = String(r[c.t] || '').trim(), qty = parseNum(r[c.q]);
    if (parseDateLoose(r[c.q])) dateLike++;
    if (!tk || !qty || qty <= 0 || isNaN(qty)) { bad++; return; }
    if (Number.isInteger(qty) && qty >= 1900 && qty <= 2100) yearLike++;
    const name = c.nm >= 0 ? String(r[c.nm] || '').trim() : '';
    if (keys.has(tk.toUpperCase()) || (name && names.has(norm(name)))) { dups.push(tk); return; }
    keys.add(tk.toUpperCase()); if (name) names.add(norm(name));
    const cur = c.cu >= 0 ? String(r[c.cu] || '').trim().toUpperCase() : '';
    fresh.push({ id: uid(), ticker: tk, displayTicker: tk.toUpperCase(), isin: Market.isISIN(tk) ? tk.toUpperCase() : '', name, type: 'stock', quantity: qty,
      avgCost: c.cc >= 0 && !isNaN(parseNum(r[c.cc])) ? parseNum(r[c.cc]) : null, currency: /^[A-Z]{3}$/.test(cur) ? cur : baseCur(), account: c.acc, logo: null, source: 'import', addedAt: todayISO(),
      dividend: { lastAmount: null, anchorMonth: null, frequency: 'quarterly', dateKind: 'pay', none: false } });
  });
  return { fresh, dups, bad, dateLike, yearLike };
}

/* ===============================================================
   IMPORT DES TRANSACTIONS (Trade Republic, DEGIRO, générique)
   Colonnes reconnues automatiquement par leur nom d'en-tête ; l'utilisateur
   vérifie le résultat dans l'aperçu avant l'import.
   =============================================================== */
function classifyTx(typeStr, catStr) {
  const t = norm(typeStr) + ' ' + norm(catStr);
  if (/dividend|dividende|coupon|distribution|ausschuttung/.test(t)) return 'dividend';
  if (/\b(sell|vente|verkauf|cession)\b/.test(t)) return 'sell';
  if (/\b(buy|achat|kauf|purchase|acquisition|saveback|savings plan|plan d.epargne|sparplan|round up|stock perk)\b/.test(t)) return 'buy';
  return 'other';
}
async function openImportTransactions() { return routeImport('generic'); }
function txFromRows(rows, hIdx, cols, opts) {
  const out = { buys: [], sells: [], dividends: [], skipped: 0, bad: 0 };
  const g = (r, k) => cols[k] >= 0 ? r[cols[k]] : '';
  rows.slice(hIdx + 1).forEach((r) => {
    const kind = classifyTx(g(r, 'type'), g(r, 'cat'));
    if (kind === 'other') { out.skipped++; return; }
    const date = parseDateLoose(g(r, 'date')); const sym = String(g(r, 'sym') || '').trim();
    const name = String(g(r, 'name') || '').trim(); const cur = String(g(r, 'cur') || '').trim().toUpperCase();
    const amount = Math.abs(parseNum(g(r, 'amount'))), shares = Math.abs(parseNum(g(r, 'shares'))), price = Math.abs(parseNum(g(r, 'price')));
    const fee = Math.abs(parseNum(g(r, 'fee'))) || 0, tax = cols.tax >= 0 && String(g(r, 'tax')).trim() !== '' ? Math.abs(parseNum(g(r, 'tax'))) : null;
    const ext = String(g(r, 'id') || '').trim();
    if (!date || (!sym && !name)) { out.bad++; return; }
    const base = { date, sym, name, currency: /^[A-Z]{3}$/.test(cur) ? cur : null, ext };
    if (kind === 'dividend') {
      if (isNaN(amount) || !amount) { out.bad++; return; }
      let gross, net, taxv = tax && !isNaN(tax) ? tax : null;
      if (opts.divMode === 'gross') { gross = amount; net = taxv !== null ? Math.round((gross - taxv) * 100) / 100 : null; }
      else { net = amount; gross = Math.round((net + (taxv || 0)) * 100) / 100; }
      out.dividends.push(Object.assign(base, { gross, net, tax: taxv, shares: isNaN(shares) ? null : shares }));
    } else {
      let qty = isNaN(shares) ? NaN : shares, pr = isNaN(price) ? NaN : price;
      if ((isNaN(qty) || !qty) && !isNaN(amount) && pr) qty = amount / pr;
      if ((isNaN(pr) || !pr) && qty && !isNaN(amount)) pr = amount / qty;
      if (!qty || isNaN(qty) || isNaN(pr)) { out.bad++; return; }
      (kind === 'buy' ? out.buys : out.sells).push(Object.assign(base, { qty, price: pr, fees: fee }));
    }
  });
  return out;
}
function renderTxMapping(rows, hIdx, prev) {
  const head = rows[hIdx] || [], n = Math.max.apply(null, rows.map((r) => r.length)); while (head.length < n) head.push('');
  const G = (k, kws) => prev[k] !== undefined ? prev[k] : guessCol(head, kws);
  const sel = { date: G('date', ['datetime', 'date', 'time']), type: G('type', ['type', 'operation', 'transaction', 'description']), cat: G('cat', ['category', 'categorie']), sym: G('sym', ['symbol', 'symbole', 'isin', 'ticker']), name: G('name', ['name', 'nom', 'produit', 'libelle']),
    shares: G('shares', ['shares', 'quantite', 'quantity', 'nombre', 'qty']), price: G('price', ['price', 'prix', 'cours']), amount: G('amount', ['amount', 'montant', 'total', 'valeur']), fee: G('fee', ['fee', 'frais', 'commission']), tax: G('tax', ['tax', 'impot', 'retenue', 'taxe']),
    cur: G('cur', ['currency', 'devise']), id: G('id', ['transaction id', 'transaction_id', 'id']) };
  const isTR = head.map(norm).includes('transaction_id') || head.map(norm).includes('asset_class');
  const divMode = prev.divMode || 'net';
  const m = openModal('<h2>Importer des transactions</h2><div class="sub">' + (isTR ? 'Format <b>Trade Republic</b> reconnu. ' : '') + 'Vérifiez les colonnes, puis contrôlez le résultat avant d\'importer.</div>' +
    fld('Ligne d\'en-tête', '<select id="xH">' + rows.slice(0, 10).map((r, i) => opt(i, 'Ligne ' + (i + 1) + ' — ' + r.slice(0, 3).join(' / '), i === hIdx)).join('') + '</select>', '', 'xH') +
    '<div class="row2">' + fld('Date', colSelect('xdate', head, sel.date, false), '', 'xdate') + fld('Type d\'opération', colSelect('xtype', head, sel.type, false), 'Achat, vente, dividende…', 'xtype') + '</div>' +
    '<div class="row2">' + fld('Catégorie (facultatif)', colSelect('xcat', head, sel.cat), '', 'xcat') + fld('ISIN / symbole', colSelect('xsym', head, sel.sym), '', 'xsym') + '</div>' +
    '<div class="row2">' + fld('Nom de l\'actif', colSelect('xname', head, sel.name), '', 'xname') + fld('Quantité', colSelect('xshares', head, sel.shares), '', 'xshares') + '</div>' +
    '<div class="row2">' + fld('Prix unitaire', colSelect('xprice', head, sel.price), '', 'xprice') + fld('Montant', colSelect('xamount', head, sel.amount), '', 'xamount') + '</div>' +
    '<div class="row2">' + fld('Frais', colSelect('xfee', head, sel.fee), '', 'xfee') + fld('Retenue / impôt', colSelect('xtax', head, sel.tax), '', 'xtax') + '</div>' +
    '<div class="row2">' + fld('Devise', colSelect('xcur', head, sel.cur), '', 'xcur') + fld('Identifiant de transaction (anti-doublon)', colSelect('xid', head, sel.id), '', 'xid') + '</div>' +
    fld('Le montant d\'un dividende est…', '<select id="xmode">' + opt('net', 'le net reçu (après retenue) — cas Trade Republic', divMode === 'net') + opt('gross', 'le brut (avant retenue)', divMode === 'gross') + '</select>', 'Détermine le calcul du brut et du net enregistrés.', 'xmode') +
    fld('Portefeuille pour les nouveaux actifs', '<select id="xacc">' + state.accounts.map((a) => opt(a.id, a.name, (view.account !== 'all' ? view.account : state.accounts[0].id) === a.id)).join('') + '</select>', '', 'xacc') +
    '<div id="xSummary" class="notice info" style="margin-top:6px"></div><div id="xPrev"></div>' +
    '<label class="chk"><input type="checkbox" id="xNew" checked><span>Créer les actifs qui ne sont pas encore dans le portefeuille (quantité et prix de revient calculés)</span></label>' +
    '<label class="chk"><input type="checkbox" id="xUpd"><span>Mettre aussi à jour la quantité et le prix de revient des actifs existants (seulement si le fichier couvre tout l\'historique)</span></label>' +
    '<div class="modal-actions"><span></span><div class="btn-row"><button class="btn" type="button" data-close>Annuler</button><button class="btn primary" type="button" id="xGo">Importer</button></div></div>', { wide: true });
  const cols = () => { const c = {}; ['date', 'type', 'cat', 'sym', 'name', 'shares', 'price', 'amount', 'fee', 'tax', 'cur', 'id'].forEach((k) => { c[k] = Number($('#x' + k, m).value); }); return c; };
  const refresh = () => {
    const parsed = txFromRows(rows, hIdx, cols(), { divMode: $('#xmode', m).value });
    $('#xSummary', m).innerHTML = '<span><b>' + parsed.buys.length + '</b> achat(s) · <b>' + parsed.sells.length + '</b> vente(s) · <b>' + parsed.dividends.length + '</b> dividende(s) détecté(s)' + (parsed.skipped ? ' · ' + parsed.skipped + ' autre(s) opération(s) ignorée(s) (dépôts, intérêts, cartes…)' : '') + (parsed.bad ? ' · ' + parsed.bad + ' ligne(s) illisible(s)' : '') + '</span>';
    const sample = parsed.dividends.slice(0, 4).map((d) => '<tr><td>' + esc(d.date) + '</td><td>' + esc(d.name || d.sym) + '</td><td class="r">' + fmtMoney(d.gross, d.currency || 'EUR') + '</td><td class="r">' + (d.tax === null ? '—' : fmtMoney(d.tax, d.currency || 'EUR')) + '</td><td class="r">' + (d.net === null ? '—' : fmtMoney(d.net, d.currency || 'EUR')) + '</td></tr>').join('');
    $('#xPrev', m).innerHTML = sample ? '<div class="sec">Dividendes — aperçu (brut / retenue / net)</div><div class="tbl-wrap"><table class="tbl"><tbody>' + sample + '</tbody></table></div>' : '';
    return parsed;
  };
  $$('select', m).forEach((s) => s.addEventListener('change', (e) => { if (e.target.id === 'xH') renderTxMapping(rows, Number(e.target.value), {}); else refresh(); }));
  refresh();
  $('#xGo', m).onclick = () => { const parsed = refresh(); commitTransactions(parsed, { acc: $('#xacc', m).value, createNew: $('#xNew', m).checked, updateExisting: $('#xUpd', m).checked }); };
}
function commitTransactions(p, o) {
  if (!p.buys.length && !p.sells.length && !p.dividends.length) { toast('Aucune opération exploitable : vérifiez les colonnes choisies.', { error: true }); return; }
  const findHolding = (r) => {
    const s = r.sym.toUpperCase(), nmn = norm(r.name);
    return state.holdings.find((h) => (s && (String(h.isin || '').toUpperCase() === s || String(h.ticker).toUpperCase() === s)) || (nmn && norm(h.name) === nmn && h.account === o.acc));
  };
  const created = [], touched = new Set(); let dupTx = 0, dupPay = 0, noHolding = 0;
  const all = p.buys.map((x) => Object.assign(x, { kind: 'buy' })).concat(p.sells.map((x) => Object.assign(x, { kind: 'sell' })), p.dividends.map((x) => Object.assign(x, { kind: 'dividend' })));
  const resolve = (r) => {
    let h = findHolding(r) || created.find((c) => (r.sym && (c.isin === r.sym.toUpperCase() || c.ticker.toUpperCase() === r.sym.toUpperCase())) || (r.name && norm(c.name) === norm(r.name)));
    if (!h && o.createNew) {
      const sym = r.sym || r.name;
      h = { id: uid(), ticker: sym, displayTicker: sym.toUpperCase(), isin: Market.isISIN(sym) ? sym.toUpperCase() : '', name: r.name || '', type: 'stock', quantity: 0, avgCost: null, currency: r.currency || baseCur(), account: o.acc, logo: null, source: 'import-tx', addedAt: r.date,
        dividend: { lastAmount: null, anchorMonth: null, frequency: 'quarterly', dateKind: 'pay', none: false } };
      created.push(h);
    }
    return h;
  };
  const txKeys = new Set(state.transactions.map((t) => t.extId || [t.type, t.date, t.holdingId, t.qty, t.price].join('|')));
  const payKeys = new Set(state.payments.map((x) => x.extId || Engine.paymentKey(x)));
  const newTx = [], newPay = [];
  all.forEach((r) => {
    const h = resolve(r); if (!h) { noHolding++; return; }
    touched.add(h);
    if (r.kind === 'dividend') {
      const pay = { id: uid(), holdingId: h.id, ticker: h.displayTicker || h.ticker, name: h.name || r.name, exDate: null, payDate: r.date, qty: r.shares || Engine.quantityAt(state, h, r.date) || h.quantity, perShare: r.shares ? Math.round(r.gross / r.shares * 10000) / 10000 : null,
        gross: r.gross, tax: r.tax, fees: null, net: r.net, currency: r.currency || h.currency, source: 'csv', verified: true, extId: r.ext || undefined };
      const key = r.ext || Engine.paymentKey(pay);
      if (payKeys.has(key) || payKeys.has(Engine.paymentKey(pay))) { dupPay++; return; }
      payKeys.add(key); newPay.push(pay);
    } else {
      const tx = { id: uid(), holdingId: h.id, ticker: h.displayTicker || h.ticker, name: h.name || r.name, date: r.date, type: r.kind, qty: r.qty, price: r.price, fees: r.fees || 0, currency: r.currency || h.currency, source: 'csv', extId: r.ext || undefined };
      const key = r.ext || [tx.type, tx.date, tx.holdingId, tx.qty, tx.price].join('|');
      if (txKeys.has(key)) { dupTx++; return; }
      txKeys.add(key); newTx.push(tx);
    }
  });
  created.forEach((h) => state.holdings.push(h));
  state.transactions.push.apply(state.transactions, newTx); state.payments.push.apply(state.payments, newPay);
  // quantité et prix de revient : actifs créés (toujours) ; existants (si demandé)
  touched.forEach((h) => {
    if (!(created.indexOf(h) >= 0 || o.updateExisting)) return;
    const pos = Engine.positionFromTransactions(state.transactions.filter((t) => t.holdingId === h.id));
    h.quantity = pos.quantity; h.avgCost = pos.avgCost;
  });
  saveState(); closeModal(); renderPage();
  const msg = [newTx.length + ' opération(s)', newPay.length + ' dividende(s)'];
  if (created.length) msg.push(created.length + ' actif(s) créé(s)');
  const ign = dupTx + dupPay; if (ign) msg.push(ign + ' doublon(s) ignoré(s)'); if (noHolding) msg.push(noHolding + ' sans actif correspondant');
  toast('Import : ' + msg.join(' · ') + '.', { ms: 7000 });
  if (created.length && state.settings.relayUrl) refreshMarket(created);
}
