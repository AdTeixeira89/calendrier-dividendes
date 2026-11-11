/* ==================================================================
   sync.js — FUSION AUTOMATIQUE entre appareils (module PUR, testé sous Node ; aucune fenêtre de choix).
   Principe : fusion « à trois voies » élément par élément, à partir de la dernière version synchronisée (base) :
     - ce qui a été AJOUTÉ sur un appareil arrive sur l'autre ;
     - ce qui a été SUPPRIMÉ sur un appareil est supprimé sur l'autre (si l'autre ne l'a pas modifié entre-temps) ;
     - ce qui a été MODIFIÉ sur un appareil est repris, champ par champ (deux appareils qui modifient des champs différents d'un même
       élément : les deux modifications sont conservées) ;
     - modification contre suppression : la modification est conservée (rien n'est perdu) ;
     - même champ modifié des deux côtés : la modification la plus récente l'emporte.
   Les données de MARCHÉ (cours, historiques, dividendes de marché…) ne sont pas synchronisées : chaque appareil les actualise lui-même.
   ================================================================== */
(function (root) {
  'use strict';
  const MARKET = ['hist', 'divHist', 'splits', 'price', 'priceAt', 'prevClose', 'prevCloseAt', 'marketAt', 'marketError', 'quickAt', 'fullAt', 'listingSuspect'];
  const DIV_MARKET = ['history', 'slots'];
  const LOCAL_ONLY = { meta: 1, undo: 1 };
  const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
  const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
  const st = (v) => {                                    // sérialisation stable (clés triées)
    if (v === undefined) return 'u';
    if (v === null || typeof v !== 'object') return JSON.stringify(v);
    if (Array.isArray(v)) return '[' + v.map(st).join(',') + ']';
    return '{' + Object.keys(v).sort().filter((k) => v[k] !== undefined).map((k) => JSON.stringify(k) + ':' + st(v[k])).join(',') + '}';
  };
  const eq = (a, b) => st(a) === st(b);
  const isList = (a) => Array.isArray(a) && a.every((x) => isObj(x));

  /* Version à synchroniser : sans données de marché, sans annulation, sans fichiers bruts. */
  function slim(state) {
    const s = {}; Object.keys(state || {}).forEach((k) => { if (k !== 'undo') s[k] = state[k]; });
    const strip = (h) => { const x = {}; Object.keys(h).forEach((k) => { if (MARKET.indexOf(k) < 0) x[k] = h[k]; });
      if (isObj(x.dividend)) { const d = {}; Object.keys(x.dividend).forEach((k) => { if (DIV_MARKET.indexOf(k) < 0) d[k] = x.dividend[k]; }); x.dividend = d; } return x; };
    s.holdings = (state.holdings || []).map(strip); s.archive = (state.archive || []).map(strip);
    if (Array.isArray(s.imports)) s.imports = s.imports.map((x) => { const y = Object.assign({}, x); delete y.raw; return y; });
    return clone(s);
  }

  const idOf = (x) => (typeof x.id === 'string' ? 'i:' + x.id : 's:' + st(x));
  function mergeList(b, l, r, pl) {
    const mb = new Map(b.map((x) => [idOf(x), x])), ml = new Map(l.map((x) => [idOf(x), x])), mr = new Map(r.map((x) => [idOf(x), x]));
    const out = [], seen = new Set();
    const one = (k) => {
      if (seen.has(k)) return; seen.add(k);
      const bE = mb.get(k), lE = ml.get(k), rE = mr.get(k);
      if (lE && rE) out.push(mergeVal(bE, lE, rE, pl));
      else if (lE) { if (!bE || !eq(lE, bE)) out.push(lE); }              // absent à distance : supprimé là-bas, sauf si modifié ici depuis
      else if (rE) { if (!bE || !eq(rE, bE)) out.push(rE); }
    };
    l.forEach((x) => one(idOf(x))); r.forEach((x) => one(idOf(x)));
    return out;
  }
  /* b = base, l = local, r = distant, pl = « le local est le plus récent ». */
  function mergeVal(b, l, r, pl) {
    if (eq(l, r)) return l;
    if (b !== undefined && eq(l, b)) return r;
    if (b !== undefined && eq(r, b)) return l;
    if (l === undefined) return r;                       // supprimé d'un côté, modifié de l'autre : la modification est conservée
    if (r === undefined) return l;
    if (isObj(l) && isObj(r)) {
      const bb = isObj(b) ? b : {}, out = {}, keys = {}; Object.keys(l).concat(Object.keys(r)).forEach((k) => { keys[k] = 1; });
      Object.keys(keys).forEach((k) => { const v = mergeVal(bb[k], l[k], r[k], pl); if (v !== undefined) out[k] = v; });
      return out;
    }
    if (Array.isArray(l) && Array.isArray(r) && isList(l) && isList(r)) return mergeList(Array.isArray(b) && isList(b) ? b : [], l, r, pl);
    return pl ? l : r;
  }
  function merge3(base, local, remote, pl) {
    const out = {}, keys = {}; [local, remote].forEach((s) => Object.keys(s || {}).forEach((k) => { if (!LOCAL_ONLY[k]) keys[k] = 1; }));
    Object.keys(keys).forEach((k) => { const v = mergeVal(base ? base[k] : undefined, local[k], remote[k], pl); if (v !== undefined) out[k] = v; });
    return out;
  }

  /* Éléments ajoutés indépendamment des deux côtés (identifiants différents, même contenu métier) : un seul est gardé. */
  const hkey = (h) => (h.account || '') + '|' + String(h.isin || h.ticker || h.name || '').toUpperCase();
  function dedupe(m, baseIds) {
    baseIds = baseIds || new Set(); const remap = {}; let n = 0;
    ['holdings', 'archive'].forEach((k) => {           // à l'intérieur de chaque liste seulement (une position clôturée puis rachetée existe légitimement dans les deux)
      const groups = new Map(); (m[k] || []).forEach((h) => { const g = groups.get(hkey(h)) || []; g.push(h); groups.set(hkey(h), g); });
      const drop = new Set();
      groups.forEach((g) => { if (g.length < 2) return; const keep = g.find((h) => baseIds.has(h.id)) || g[0]; g.forEach((h) => { if (h !== keep) { remap[h.id] = keep.id; drop.add(h); n++; } }); });
      if (drop.size) m[k] = m[k].filter((h) => !drop.has(h));
    });
    const fix = (x) => { if (remap[x.holdingId]) x.holdingId = remap[x.holdingId]; return x; };
    ['payments', 'transactions', 'estimates'].forEach((k) => { if (Array.isArray(m[k])) m[k] = m[k].map(fix); });
    ['payments', 'transactions'].forEach((k) => { if (!Array.isArray(m[k])) return; const ext = new Set(); m[k] = m[k].filter((x) => { if (!x.extId) return true; if (ext.has(x.extId)) { n++; return false; } ext.add(x.extId); return true; }); });
    return { merged: m, removed: n };
  }

  /* Remet les données de marché locales sur la version fusionnée (par identifiant, sinon par clé métier). */
  function reattach(merged, localFull) {
    ['holdings', 'archive'].forEach((k) => {
      const mine = localFull[k] || [], byId = new Map(mine.map((h) => [h.id, h])), byKey = new Map(mine.map((h) => [hkey(h), h]));
      (merged[k] || []).forEach((h) => {
        const src = byId.get(h.id) || byKey.get(hkey(h)); if (!src) return;
        MARKET.forEach((f) => { if (src[f] !== undefined && h[f] === undefined) h[f] = src[f]; });
        if (isObj(src.dividend)) { h.dividend = h.dividend || {}; DIV_MARKET.forEach((f) => { if (src.dividend[f] !== undefined && h.dividend[f] === undefined) h.dividend[f] = src.dividend[f]; }); }
      });
    });
    return merged;
  }

  root.Sync = { slim, merge3, dedupe, reattach, eq, st, MARKET };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.Sync;
})(typeof self !== 'undefined' ? self : this);
