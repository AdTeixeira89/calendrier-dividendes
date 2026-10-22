/* ==================================================================
   refresh.js — « tirer pour actualiser » (téléphone) + bouton discret d'actualisation.
   Une actualisation = 1. mise à jour de l'application si une nouvelle version est publiée (rechargement),
   2. cours / dividendes / historique Yahoo des actifs affichés, 3. taux de change, 4. actualités, 5. synchronisation du compte.
   APP_BUILD doit rester égal au numéro de version du cache du service worker (sw.js : dividendes-shell-vNN) : un test le vérifie.
   ================================================================== */
const APP_BUILD = 24;
let pullBusy = false, updateAvail = false;

/* Version publiée (sw.js lu sans cache). null = injoignable / hors-ligne. */
async function fetchPublishedBuild() {
  try {
    const r = await fetch('sw.js?v=' + Date.now(), { cache: 'no-store' }); if (!r.ok) return null;
    const m = (await r.text()).match(/dividendes-shell-v(\d+)/); return m ? Number(m[1]) : null;
  } catch (e) { return null; }
}
async function updateAvailable() { const v = await fetchPublishedBuild(); return v !== null && v > APP_BUILD; }

/* Recharge l'application avec la nouvelle version (le service worker est invité à se mettre à jour, puis la page est rechargée). */
async function applyAppUpdate() {
  try { const reg = await navigator.serviceWorker.getRegistration(); if (reg) await reg.update(); } catch (e) { /* le rechargement suffit : le service worker sert le réseau d'abord */ }
  location.reload();
}

function ptrEl() { return document.getElementById('ptr'); }
function ptrShow(label, o) {
  const el = ptrEl(); if (!el) return; o = o || {};
  el.querySelector('.ptr-txt').textContent = label; el.classList.toggle('run', !!o.run); el.classList.toggle('ready', !!o.ready);
  el.style.transition = o.anim ? 'transform .25s ease, opacity .25s ease' : 'none'; el.style.opacity = o.hide ? '0' : '1';
  el.style.transform = 'translate(-50%,' + (o.hide ? -70 : o.y) + 'px)'; el.querySelector('svg').style.transform = o.run ? '' : 'rotate(' + Math.round(o.rot || 0) + 'deg)';
}
function ptrHide() { ptrShow('', { hide: true, anim: true }); }

function rfButtons(on) { $$('[data-rf-btn]').forEach((b) => { b.classList.toggle('spin', !!on); b.disabled = !!on; }); }
function markUpdate(v) {
  updateAvail = !!v; $$('[data-rf-btn]').forEach((b) => { b.classList.toggle('has-update', updateAvail); b.title = updateAvail ? 'Mise à jour disponible : toucher pour mettre à jour et actualiser' : 'Actualiser (cours, taux, actualités) et rechercher une mise à jour'; });
}

/* Actualisation complète. source : 'pull' | 'button'. */
async function runFullRefresh(source) {
  if (pullBusy) return; pullBusy = true; rfButtons(true);
  const label = (t) => { if (source === 'pull') ptrShow(t, { run: true, y: 14 }); };
  try {
    if (!navigator.onLine) { toast('Hors-ligne : actualisation impossible.', { error: true }); return; }
    label('Recherche de mise à jour…');
    if (await updateAvailable()) { label('Mise à jour de l\'application…'); toast('Nouvelle version disponible : mise à jour…', { ms: 2500 }); await new Promise((r) => setTimeout(r, 400)); await applyAppUpdate(); return; }
    markUpdate(false);
    const parts = []; let err = null;
    if (state.settings.relayUrl && state.holdings.length) {
      label('Actualisation des cours…');
      try { const res = await refreshMarket(visibleHoldings(), { silent: true }); if (res) { parts.push(res.ok + ' actif(s) actualisé(s)'); if (res.fail && !res.ok) err = (res.errors && res.errors[0] && res.errors[0].message) || 'échec de l\'actualisation'; } }
      catch (e) { err = e.message; }
    } else if (!state.settings.relayUrl) parts.push('relais de données non configuré (Paramètres)');
    label('Taux de change et actualités…');
    try { localStorage.removeItem('fxRatesCache_v2'); localStorage.removeItem('dca_news'); } catch (e) { /* ignoré */ }
    if (typeof newsMem !== 'undefined') newsMem.data = null;
    try { await ensureFx(); ensureFxHistory(); } catch (e) { /* taux : repli sur le cache */ }
    if (Cloud && Cloud.user && Cloud.user()) { label('Synchronisation…'); try { await pullIfChanged(); } catch (e) { /* ignoré */ } }
    renderPage();
    toast((err ? 'Actualisation incomplète : ' + err : 'À jour') + (parts.length ? ' · ' + parts.join(' · ') : '') + '.', { error: !!err, ms: 4000 });
  } finally { pullBusy = false; rfButtons(false); if (source === 'pull') ptrHide(); }
}

/* Vérification discrète au démarrage et au retour au premier plan : un point sur le bouton si une mise à jour est publiée. */
async function checkUpdateQuietly() { if (pullBusy || !navigator.onLine) return; if (await updateAvailable()) { const first = !updateAvail; markUpdate(true); if (first) toast('Mise à jour disponible.', { ms: 9000, action: { label: 'Mettre à jour', fn: () => runFullRefresh('button') } }); } }

function initPullRefresh() {
  if (document.getElementById('ptr')) return;
  const el = document.createElement('div'); el.id = 'ptr'; el.setAttribute('aria-hidden', 'true');
  el.innerHTML = '<div class="ptr-in">' + icon('refresh') + '<span class="ptr-txt"></span></div>'; document.body.appendChild(el); ptrShow('', { hide: true });
  $$('[data-rf-btn]').forEach((b) => { b.onclick = () => runFullRefresh('button'); }); markUpdate(false);
  const THRESH = 56, MAXPULL = 110;
  let y0 = null, x0 = 0, pull = 0, armed = false, active = false;
  const blocked = (t) => !!(t && t.closest && t.closest('.modal, #modalRoot > *, #authRoot > *, input, textarea, select, .tbl-wrap, .ticker-track, svg.chart, .news-scroll, .dd-panel'));
  const atTop = () => (document.scrollingElement ? document.scrollingElement.scrollTop : window.scrollY) <= 0;
  document.addEventListener('touchstart', (e) => {
    pull = 0; armed = false; active = false; y0 = null;
    if (pullBusy || e.touches.length !== 1 || !atTop() || blocked(e.target) || document.querySelector('#modalRoot .modal, #authRoot > *')) return;
    y0 = e.touches[0].clientY; x0 = e.touches[0].clientX;
  }, { passive: true });
  document.addEventListener('touchmove', (e) => {
    if (y0 === null || pullBusy) return;
    const dy = e.touches[0].clientY - y0, dx = e.touches[0].clientX - x0;
    if (!active) { if (dy < 8) { if (dy < -8 || Math.abs(dx) > 14) y0 = null; return; } if (Math.abs(dx) > dy) { y0 = null; return; } if (!atTop()) { y0 = null; return; } active = true; }
    if (e.cancelable) e.preventDefault();                                   // pas de rebond natif ni de rechargement du navigateur
    pull = Math.min(MAXPULL, Math.max(0, dy * 0.5)); armed = pull >= THRESH;
    ptrShow(armed ? 'Relâchez pour actualiser' : 'Tirez pour actualiser', { y: pull - 34, rot: pull / MAXPULL * 270, ready: armed });
  }, { passive: false });
  const end = () => {
    if (y0 === null) return; const go = active && armed; y0 = null; active = false;
    if (go) { ptrShow('Actualisation…', { run: true, y: 14, anim: true }); runFullRefresh('pull'); } else ptrHide();
  };
  document.addEventListener('touchend', end, { passive: true }); document.addEventListener('touchcancel', () => { y0 = null; active = false; ptrHide(); }, { passive: true });
  setTimeout(checkUpdateQuietly, 4000);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') setTimeout(checkUpdateQuietly, 1500); });
}
