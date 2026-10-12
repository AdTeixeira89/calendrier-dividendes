/* ==================================================================
   ui.js — composants d'interface partagés : formats, icônes, fenêtres,
   notifications, menus, tableau configurable, graphiques SVG.
   ================================================================== */
const $ = (s, r) => (r || document).querySelector(s);
const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function uid() { return Math.random().toString(36).slice(2, 10) + Date.now().toString(36); }
function pad2(n) { return String(n).padStart(2, '0'); }
function todayISO() { return Engine.toISO(new Date()); }

const MOIS = ['Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'];
const MOIS_C = ['Jan', 'Fév', 'Mar', 'Avr', 'Mai', 'Juin', 'Juil', 'Août', 'Sep', 'Oct', 'Nov', 'Déc'];
const JOURS = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];
const CURRENCIES = ['EUR', 'USD', 'GBP', 'CHF', 'CAD', 'SEK', 'DKK', 'NOK', 'JPY', 'AUD'];

/* ---------- formats ---------- */
const _nf = {};
function fmtMoney(n, cur, o) {
  o = o || {};
  if (n === null || n === undefined || !isFinite(n)) return '—';
  const d = o.d === undefined ? 2 : o.d;
  const key = (cur || '') + d;
  try {
    if (!_nf[key]) _nf[key] = new Intl.NumberFormat('fr-FR', cur ? { style: 'currency', currency: cur, currencyDisplay: 'narrowSymbol', minimumFractionDigits: d, maximumFractionDigits: d } : { minimumFractionDigits: d, maximumFractionDigits: d });
    return _nf[key].format(n);
  } catch (e) { return n.toFixed(d).replace('.', ',') + ' ' + (cur || ''); }
}
function fmtNum(n, d) {
  if (n === null || n === undefined || !isFinite(n)) return '—';
  return new Intl.NumberFormat('fr-FR', { maximumFractionDigits: d === undefined ? 4 : d }).format(n);
}
function fmtPct(x, d, sign) {
  if (x === null || x === undefined || !isFinite(x)) return '—';
  return new Intl.NumberFormat('fr-FR', { style: 'percent', minimumFractionDigits: d === undefined ? 2 : d, maximumFractionDigits: d === undefined ? 2 : d, signDisplay: sign ? 'exceptZero' : 'auto' }).format(x);
}
function fmtDate(iso, o) {
  if (!iso) return '—';
  const a = iso.split('-').map(Number);
  return new Intl.DateTimeFormat('fr-FR', o || { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(a[0], a[1] - 1, a[2]));
}
function fmtDateTime(ms) {
  if (!ms) return '—';
  return new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(ms));
}
function relDays(iso) {
  const a = iso.split('-').map(Number), d = new Date(a[0], a[1] - 1, a[2]), t = new Date(); t.setHours(0, 0, 0, 0);
  const n = Math.round((d - t) / 86400000);
  if (n === 0) return "aujourd'hui"; if (n === 1) return 'demain'; if (n === -1) return 'hier';
  return n > 0 ? 'dans ' + n + ' j' : 'il y a ' + (-n) + ' j';
}

/* ---------- icônes ---------- */
const ICONS = {
  home: '<path d="M4 11.5 12 5l8 6.5V19a1 1 0 0 1-1 1h-4v-5H9v5H5a1 1 0 0 1-1-1z"/>',
  wallet: '<rect x="3.5" y="7" width="17" height="12.5" rx="2.5"/><path d="M9 7V5.5A1.5 1.5 0 0 1 10.5 4h3A1.5 1.5 0 0 1 15 5.5V7M3.5 12.5h17"/>',
  calendar: '<rect x="3.5" y="5" width="17" height="15" rx="2.5"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
  history: '<path d="M3.5 12a8.5 8.5 0 1 0 2.6-6.1L3.5 8.5"/><path d="M3.5 4v4.5H8M12 8v4.5l3 2"/>',
  stats: '<path d="M5 20V11M12 20V5M19 20v-7"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  plus: '<path d="M12 5v14M5 12h14"/>', trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3"/>',
  download: '<path d="M12 4v11m0 0-4-4m4 4 4-4M5 20h14"/>', upload: '<path d="M12 16V5m0 0-4 4m4-4 4 4M5 20h14"/>',
  refresh: '<path d="M20 12a8 8 0 1 1-2.3-5.7M20 4v5h-5"/>', columns: '<rect x="3.5" y="4.5" width="17" height="15" rx="2"/><path d="M9.5 4.5v15M15 4.5v15"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>', check: '<path d="M5 12.5 10 17.5 19 7"/>', user: '<circle cx="12" cy="8" r="3.6"/><path d="M4.5 20a7.5 7.5 0 0 1 15 0"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4"/>', filter: '<path d="M4 6h16M7 12h10M10 18h4"/>'
};
function icon(n) { return '<svg viewBox="0 0 24 24" aria-hidden="true">' + (ICONS[n] || '') + '</svg>'; }

/* ---------- pastille d'actif ---------- */
const AV_COLORS = ['#177a50', '#3b8fc4', '#7a64c8', '#c9792b', '#a24c7a', '#2f9d9d', '#6b7f3a', '#8a5a44'];
function initials(t) { return (t || '?').replace(/\..*/, '').slice(0, 2).toUpperCase(); }
function colorFor(t) { let h = 0; for (const c of (t || '')) h = (h * 31 + c.charCodeAt(0)) % AV_COLORS.length; return AV_COLORS[Math.abs(h)]; }
function avatar(ticker, logo, cls) {
  const bg = colorFor(ticker);
  if (logo) return '<span class="avatar ' + (cls || '') + '" style="background:' + bg + '">' + esc(initials(ticker)) + '<img src="' + esc(logo) + '" alt="" loading="lazy" onerror="this.remove()"></span>';
  return '<span class="avatar ' + (cls || '') + '" style="background:' + bg + '">' + esc(initials(ticker)) + '</span>';
}

/* ---------- statuts ---------- */
const STATUS_LABEL = { received: 'Reçu', confirmed: 'Confirmé', forecast: 'Estimé', unrecorded: 'Non enregistré' };
function statusBadge(s, unverified) {
  if (s === 'received' && unverified) return '<span class="badge warn" title="Généré d\'après les dates passées : à vérifier">À vérifier</span>';
  return '<span class="badge ' + s + '">' + (STATUS_LABEL[s] || s) + '</span>';
}
function kindLabel(kind, status) {
  const base = kind === 'ex' ? 'Détachement' : 'Paiement';
  return status === 'forecast' ? base + ' estimé' : base;
}
const DIV_STATUS_LABEL = { payer: 'Verse un dividende', none: 'Sans dividende', accumulating: 'Capitalisant', missing: 'Données manquantes', irregular: 'Irrégulier' };
function divStatusBadge(s) {
  const cls = { payer: 'received', none: '', accumulating: 'confirmed', missing: 'unrecorded', irregular: 'forecast' }[s] || '';
  return '<span class="badge ' + cls + '">' + (DIV_STATUS_LABEL[s] || s) + '</span>';
}

/* ---------- notifications ---------- */
function toast(msg, o) {
  o = o || {};
  const root = $('#toastRoot'); if (!root) return;
  const el = document.createElement('div');
  el.className = 'toast' + (o.error ? ' err' : '');
  el.setAttribute('role', o.error ? 'alert' : 'status');
  el.innerHTML = '<span>' + esc(msg) + '</span>' + (o.action ? '<button type="button">' + esc(o.action.label) + '</button>' : '');
  root.appendChild(el);
  const kill = () => el.remove();
  if (o.action) el.querySelector('button').onclick = () => { o.action.fn(); kill(); };
  setTimeout(kill, o.ms || (o.action ? 9000 : o.error ? 6000 : 3200));
}

/* ---------- fenêtres ---------- */
let _modalClose = null;
function openModal(html, o) {
  o = o || {};
  closeModal();
  const root = $('#modalRoot');
  root.innerHTML = '<div class="overlay" id="ovl"><div class="modal' + (o.wide ? ' wide' : '') + '" role="dialog" aria-modal="true">' +
    '<button class="modal-x" type="button" data-close aria-label="Fermer">×</button>' + html + '</div></div>';
  _modalClose = o.onClose || null;
  const ovl = $('#ovl');
  ovl.addEventListener('mousedown', (e) => { if (e.target === ovl && !o.sticky) closeModal(); });
  $$('[data-close]', ovl).forEach((b) => b.addEventListener('click', () => closeModal()));
  const first = $('input:not([type=checkbox]),select', ovl); if (first && window.innerWidth > 700) first.focus();
  return $('.modal', ovl);
}
function closeModal() {
  const root = $('#modalRoot'); if (!root) return;
  const cb = _modalClose; _modalClose = null;
  root.innerHTML = '';
  if (cb) cb();
}
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { closeModal(); closeMenus(); } });

/* Confirmation : renvoie { ok, checked }. */
function confirmDialog(o) {
  return new Promise((resolve) => {
    let done = false;
    const m = openModal('<h2>' + esc(o.title) + '</h2><div class="sub">' + (o.body || '') + '</div>' +
      (o.checkbox ? '<label class="chk"><input type="checkbox" id="cdChk" ' + (o.checkbox.checked ? 'checked' : '') + '> <span>' + esc(o.checkbox.label) + '</span></label>' : '') +
      '<div class="modal-actions"><button class="btn" type="button" id="cdNo">' + esc(o.cancelLabel || 'Annuler') + '</button>' +
      '<button class="btn ' + (o.danger ? 'danger' : 'primary') + '" type="button" id="cdYes">' + esc(o.confirmLabel || 'Confirmer') + '</button></div>',
      { onClose: () => { if (!done) { done = true; resolve({ ok: false, checked: false }); } } });
    $('#cdNo', m).onclick = () => closeModal();
    $('#cdYes', m).onclick = () => { done = true; const c = $('#cdChk', m); const checked = c ? c.checked : false; closeModal(); resolve({ ok: true, checked }); };
  });
}

/* ---------- menus déroulants (ex. « Colonnes à afficher ») ---------- */
function closeMenus(except) { $$('.dd-panel').forEach((p) => { if (p !== except) p.classList.add('hide'); }); }
document.addEventListener('click', (e) => {
  const t = e.target.closest('[data-dd]');
  if (t) {
    const panel = t.parentElement.querySelector('.dd-panel');
    closeMenus(panel); panel.classList.toggle('hide'); return;
  }
  if (!e.target.closest('.dd-panel')) closeMenus();
});

/* ---------- tableau configurable ---------------------------------------
   cfg : { id, columns:[{key,label,essential,align,group,sort,html,total}], rows, getId,
           selectable, sortKey, sortDir, pageSize, empty, onOpen, onSelection }
   Préférences de colonnes dans state.settings.columns[id] (synchronisées avec le compte).
   Masquer une colonne ne supprime jamais de donnée. */
const Tbl = {
  inst: {},
  st(id) { view.tables = view.tables || {}; return (view.tables[id] = view.tables[id] || { sel: new Set(), sortKey: null, sortDir: 1, shown: 0 }); },
  visibleKeys(cfg) {
    const prefs = (state.settings.columns || {})[cfg.id];
    const known = new Set(cfg.columns.map((c) => c.key));
    if (Array.isArray(prefs)) return prefs.filter((k) => known.has(k));
    return cfg.columns.filter((c) => c.essential).map((c) => c.key);
  },
  menuHtml(cfg) {
    const vis = new Set(Tbl.visibleKeys(cfg));
    let h = '<div class="dd"><button class="btn" type="button" data-dd aria-haspopup="true">' + icon('columns') + 'Colonnes à afficher</button><div class="dd-panel hide" data-cols="' + esc(cfg.id) + '">';
    let grp = null;
    cfg.columns.forEach((c) => {
      const g = c.essential ? 'Essentielles' : 'Facultatives';
      if (g !== grp) { h += '<div class="grp">' + g + '</div>'; grp = g; }
      h += '<label class="chk"><input type="checkbox" data-col="' + esc(c.key) + '" ' + (vis.has(c.key) ? 'checked' : '') + '><span>' + esc(c.label) + '</span></label>';
    });
    h += '<div class="dd-foot"><button class="link-btn" type="button" data-cols-reset="' + esc(cfg.id) + '">Par défaut</button><button class="link-btn" type="button" data-cols-all="' + esc(cfg.id) + '">Tout afficher</button></div></div></div>';
    return h;
  },
  setColumns(id, keys) {
    state.settings.columns = state.settings.columns || {};
    if (keys === null) delete state.settings.columns[id]; else state.settings.columns[id] = keys;
    saveState();
    const i = Tbl.inst[id]; if (i) Tbl.render(i.host, i.cfg);
  },
  selected(id) { return Array.from(Tbl.st(id).sel); },
  clearSel(id) { Tbl.st(id).sel.clear(); const i = Tbl.inst[id]; if (i) Tbl.render(i.host, i.cfg); },

  render(host, cfg) {
    Tbl.inst[cfg.id] = { host, cfg };
    const st = Tbl.st(cfg.id);
    const vis = Tbl.visibleKeys(cfg);
    const cols = cfg.columns.filter((c) => vis.indexOf(c.key) >= 0);
    const ids = new Set(cfg.rows.map(cfg.getId));
    st.sel.forEach((x) => { if (!ids.has(x)) st.sel.delete(x); });
    if (!st.sortKey) { st.sortKey = cfg.sortKey || null; st.sortDir = cfg.sortDir || 1; }
    let rows = cfg.rows.slice();
    const sc = cfg.columns.find((c) => c.key === st.sortKey);
    if (sc && sc.sort) {
      rows.sort((a, b) => {
        const x = sc.sort(a), y = sc.sort(b);
        if (x === y) return 0;
        if (x === null || x === undefined || x === '') return 1;
        if (y === null || y === undefined || y === '') return -1;
        return (x < y ? -1 : 1) * st.sortDir;
      });
    }
    const page = cfg.pageSize || 100;
    if (!st.shown || st.shown < page) st.shown = page;
    const shownRows = rows.slice(0, st.shown);
    const allSel = rows.length > 0 && rows.every((r) => st.sel.has(cfg.getId(r)));

    if (!rows.length) { host.innerHTML = cfg.empty || '<div class="card empty">Aucune donnée.</div>'; return; }

    let h = '';
    if (cfg.selectable) {
      h += '<div class="selbar ' + (st.sel.size ? '' : 'hide') + '" id="selbar-' + cfg.id + '"><label class="chk"><input type="checkbox" data-selall ' + (allSel ? 'checked' : '') + '><span>Tout sélectionner (' + rows.length + ')</span></label>' +
        '<span><b>' + st.sel.size + '</b> sélectionné' + (st.sel.size > 1 ? 's' : '') + '</span><span class="grow" style="flex:1"></span>' +
        '<button class="btn sm" type="button" data-selclear>Annuler la sélection</button>' +
        '<button class="btn sm danger" type="button" data-seldel>' + icon('trash') + (cfg.deleteLabel || 'Supprimer la sélection') + '</button></div>';
    }
    h += '<div class="tbl-wrap"><table class="tbl"><thead><tr>';
    if (cfg.selectable) h += '<th class="chk-col"><input type="checkbox" data-selall aria-label="Tout sélectionner" ' + (allSel ? 'checked' : '') + '></th>';
    cols.forEach((c, i) => {
      h += '<th class="' + (c.align === 'r' ? 'r ' : '') + (c.sort ? 'sortable ' : '') + (i === 0 ? 'first' : '') + '" ' + (c.sort ? 'data-sort="' + c.key + '"' : '') + '>' + esc(c.label) +
        (st.sortKey === c.key ? '<span class="arr">' + (st.sortDir > 0 ? '▲' : '▼') + '</span>' : '') + '</th>';
    });
    h += '</tr></thead><tbody>';
    shownRows.forEach((r) => {
      const id = cfg.getId(r);
      h += '<tr data-id="' + esc(id) + '" class="' + (st.sel.has(id) ? 'sel' : '') + '">';
      if (cfg.selectable) h += '<td class="chk-col"><input type="checkbox" data-selrow="' + esc(id) + '" aria-label="Sélectionner" ' + (st.sel.has(id) ? 'checked' : '') + '></td>';
      cols.forEach((c, i) => { h += '<td class="' + (c.align === 'r' ? 'r' : '') + (c.align === 'c' ? 'c' : '') + (i === 0 ? ' first' : '') + '">' + c.html(r) + '</td>'; });
      h += '</tr>';
    });
    h += '</tbody>';
    if (cfg.footer) {
      const f = cfg.footer(rows, cols);
      if (f) h += '<tfoot><tr>' + (cfg.selectable ? '<td></td>' : '') + cols.map((c, i) => '<td class="' + (c.align === 'r' ? 'r' : '') + '">' + (f[c.key] !== undefined ? f[c.key] : (i === 0 ? 'Total' : '')) + '</td>').join('') + '</tr></tfoot>';
    }
    h += '</table></div>';
    if (rows.length > shownRows.length) h += '<div class="more-row"><button class="btn" type="button" data-more>Afficher plus (' + (rows.length - shownRows.length) + ' restants)</button></div>';
    host.innerHTML = h;

    const rerender = () => Tbl.render(host, cfg);
    host.onclick = (e) => {
      const t = e.target;
      const sortTh = t.closest('[data-sort]');
      if (sortTh) { const k = sortTh.dataset.sort; if (st.sortKey === k) st.sortDir = -st.sortDir; else { st.sortKey = k; st.sortDir = 1; } rerender(); return; }
      if (t.closest('[data-more]')) { st.shown += page; rerender(); return; }
      if (t.closest('[data-selclear]')) { st.sel.clear(); rerender(); if (cfg.onSelection) cfg.onSelection(); return; }
      if (t.closest('[data-seldel]')) { if (cfg.onBulkDelete) cfg.onBulkDelete(Array.from(st.sel)); return; }
      const open = t.closest('[data-open]');
      if (open && cfg.onOpen) { cfg.onOpen(open.dataset.open); return; }
      const act = t.closest('[data-act]');
      if (act && cfg.onAction) { cfg.onAction(act.dataset.act, act.closest('tr').dataset.id); }
    };
    host.onchange = (e) => {
      const t = e.target;
      if (t.matches('[data-selall]')) { if (t.checked) rows.forEach((r) => st.sel.add(cfg.getId(r))); else st.sel.clear(); rerender(); if (cfg.onSelection) cfg.onSelection(); return; }
      if (t.matches('[data-selrow]')) { if (t.checked) st.sel.add(t.dataset.selrow); else st.sel.delete(t.dataset.selrow); rerender(); if (cfg.onSelection) cfg.onSelection(); }
    };
  }
};
document.addEventListener('change', (e) => {
  const t = e.target;
  if (t.matches && t.matches('[data-cols] [data-col]')) {
    const id = t.closest('[data-cols]').dataset.cols, inst = Tbl.inst[id]; if (!inst) return;
    const keys = $$('[data-cols="' + id + '"] [data-col]').filter((c) => c.checked).map((c) => c.dataset.col);
    Tbl.setColumns(id, keys);
  }
});
document.addEventListener('click', (e) => {
  const r = e.target.closest('[data-cols-reset]'), a = e.target.closest('[data-cols-all]');
  if (r) { Tbl.setColumns(r.dataset.colsReset, null); if (typeof renderPage === 'function') renderPage(); }
  if (a) { const i = Tbl.inst[a.dataset.colsAll]; if (i) { Tbl.setColumns(i.cfg.id, i.cfg.columns.map((c) => c.key)); if (typeof renderPage === 'function') renderPage(); } }
});

/* ---------- graphiques SVG ---------- */
function niceMax(v) {
  if (v <= 0) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(v))), n = v / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p;
}
function axisFmt(v, cur) {
  if (v >= 1000) return fmtNum(v / 1000, 1) + ' k';
  return fmtNum(v, 0);
}

/* Barres empilées. layers : [{ name, color, values[], dashed? }] */
function stackedBars(o) {
  const W = 640, H = 230, L = 44, R = 8, T = 10, B = 26;
  const n = o.labels.length;
  const totals = o.labels.map((_, i) => o.layers.reduce((s, l) => s + (l.values[i] || 0), 0));
  const max = niceMax(Math.max.apply(null, totals.concat([0.01])));
  const bw = (W - L - R) / n, bar = Math.min(34, bw * 0.62);
  let svg = '<svg class="chart" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' + esc(o.title || 'Graphique') + '">';
  for (let g = 0; g <= 4; g++) {
    const y = T + (H - T - B) * (1 - g / 4);
    svg += '<line class="grid-l" x1="' + L + '" x2="' + (W - R) + '" y1="' + y + '" y2="' + y + '"/><text x="' + (L - 6) + '" y="' + (y + 4) + '" text-anchor="end">' + axisFmt(max * g / 4) + '</text>';
  }
  o.labels.forEach((lab, i) => {
    const cx = L + bw * i + bw / 2; let acc = 0;
    o.layers.forEach((l) => {
      const v = l.values[i] || 0; if (v <= 0) return;
      const h = (H - T - B) * v / max, y = T + (H - T - B) - (H - T - B) * (acc + v) / max; acc += v;
      svg += '<rect x="' + (cx - bar / 2) + '" y="' + y + '" width="' + bar + '" height="' + Math.max(h, 1) + '" rx="3" fill="' + (l.dashed ? 'none' : l.color) + '" ' +
        (l.dashed ? 'stroke="' + l.color + '" stroke-dasharray="4 3" stroke-width="1.5"' : (l.faded ? 'fill-opacity=".45"' : '')) + '><title>' + esc(lab + ' — ' + l.name + ' : ' + fmtMoney(v, o.cur)) + '</title></rect>';
    });
    svg += '<text x="' + cx + '" y="' + (H - 8) + '" text-anchor="middle">' + esc(lab) + '</text>';
  });
  svg += '</svg>';
  const legend = '<div class="legend">' + o.layers.filter((l) => l.values.some((v) => v > 0)).map((l) => '<span><i style="background:' + (l.dashed ? 'transparent;border:1.5px dashed ' + l.color : l.color) + (l.faded ? ';opacity:.45' : '') + '"></i>' + esc(l.name) + '</span>').join('') + '</div>';
  return svg + legend;
}

function donut(items, cur) {
  const total = items.reduce((s, x) => s + x.value, 0);
  if (!total) return '';
  const R = 62, r = 40, C = 80; let a0 = -Math.PI / 2, svg = '<svg class="chart" viewBox="0 0 160 160" style="width:160px;flex:none" role="img" aria-label="Répartition">';
  items.forEach((x, i) => {
    const frac = x.value / total, a1 = a0 + frac * Math.PI * 2, large = frac > 0.5 ? 1 : 0;
    const col = 'var(--chart-' + (i + 1 > 9 ? 9 : i + 1) + ')';
    if (frac >= 0.9999) svg += '<circle cx="' + C + '" cy="' + C + '" r="' + ((R + r) / 2) + '" fill="none" stroke="' + col + '" stroke-width="' + (R - r) + '"/>';
    else {
      const p = (a, rad) => (C + rad * Math.cos(a)).toFixed(2) + ' ' + (C + rad * Math.sin(a)).toFixed(2);
      svg += '<path d="M' + p(a0, R) + ' A' + R + ' ' + R + ' 0 ' + large + ' 1 ' + p(a1, R) + ' L' + p(a1, r) + ' A' + r + ' ' + r + ' 0 ' + large + ' 0 ' + p(a0, r) + ' Z" fill="' + col + '"><title>' + esc(x.ticker + ' — ' + fmtMoney(x.value, cur) + ' (' + fmtPct(frac, 1) + ')') + '</title></path>';
    }
    a0 = a1;
  });
  svg += '</svg>';
  const leg = items.map((x, i) => '<div><i style="background:var(--chart-' + (i + 1 > 9 ? 9 : i + 1) + ')"></i><span>' + esc(x.ticker) + '</span><span class="v">' + fmtPct(x.value / total, 1) + '</span></div>').join('');
  return '<div class="donut-wrap">' + svg + '<div class="donut-leg">' + leg + '</div></div>';
}

function simpleBars(items, cur, label) {
  return stackedBars({ labels: items.map((x) => String(x.year)), layers: [{ name: label || 'Dividendes reçus', color: 'var(--chart-1)', values: items.map((x) => x.total) }], cur, title: label });
}
