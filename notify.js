/* ==================================================================
   notify.js — CLOCHE DE NOTIFICATIONS (coin supérieur droit).
   Tout défaut, avertissement, erreur ou information « à lire » passe par ici au lieu d'occuper de la place dans les pages.
   Chaque notification : niveau (error / warn / info), titre, détail, et jusqu'à trois actions :
     Accepter  — appliquer la correction proposée (ou « Compris » pour une simple information) ;
     Modifier  — ouvrir l'endroit où l'on peut corriger à la main ;
     Ignorer   — la masquer (elle revient seulement si son contenu change ; « Traitées » permet de la rétablir).
   Les pages publient leurs notifications par source : Notify.set('source', [ { id, level, title, body, accept, edit } ]).
   ================================================================== */
const Notify = (function () {
  const reg = new Map(), events = [];
  let open = false, showDone = false, timer = null;
  const hash = (s) => { let h = 5381; s = String(s); for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0; return (h >>> 0).toString(36); };
  const done = () => { state.notices = state.notices && typeof state.notices === 'object' ? state.notices : {}; state.notices.handled = state.notices.handled || {}; return state.notices.handled; };
  const LV = { error: 0, warn: 1, info: 2 };

  /* Publie (remplace) les notifications d'une source. */
  function set(src, list) { reg.set(src, (list || []).filter(Boolean).map((n) => Object.assign({ src, level: 'warn' }, n, { sig: hash((n.title || '') + '|' + (n.body || '')) }))); schedule(); }
  function clear(src) { if (reg.delete(src)) schedule(); }
  /* Événement ponctuel (ex. erreur affichée en bulle) : conservé dans la cloche jusqu'à ce qu'on le traite. */
  function push(n) {
    const id = 'ev:' + hash(n.title + '|' + (n.body || '')), ex = events.find((e) => e.id === id);
    if (ex) { ex.at = Date.now(); schedule(); return; }
    events.unshift(Object.assign({ level: 'error', src: 'event', at: Date.now() }, n, { id, sig: id })); events.length = Math.min(events.length, 20); schedule();
  }
  const everything = () => { const out = []; reg.forEach((l) => l.forEach((n) => out.push(n))); return out.concat(events); };
  const isDone = (n) => { const h = done()[n.id]; return !!h && h.sig === n.sig; };
  const pending = () => everything().filter((n) => !isDone(n)).sort((a, b) => (LV[a.level] - LV[b.level]));
  const handled = () => everything().filter(isDone);

  function handle(id, how) {
    const n = everything().find((x) => x.id === id); if (!n) return;
    done()[id] = { sig: n.sig, at: new Date().toISOString(), how }; if (n.src === 'event') events.splice(events.indexOf(n), 1);
    try { saveState(); } catch (e) { /* sans stockage : masqué pour la session seulement */ } render();
  }
  function restore(id) { delete done()[id]; try { saveState(); } catch (e) { /* ignoré */ } render(); }
  function run(id, kind) {
    const n = everything().find((x) => x.id === id); if (!n) return;
    const a = kind === 'accept' ? (n.accept || { label: 'Compris', ack: true }) : n.edit; if (!a) return;
    if (a.run) { closePanel(); try { a.run(); } catch (e) { console.error(e); } }
    if (kind === 'accept' && a.ack !== false) handle(id, 'accepted');
  }

  const ICON = { error: '⛔', warn: '⚠', info: 'ℹ' };
  function itemHtml(n, isHandled) {
    const acc = n.accept || { label: 'Compris', ack: true };
    return '<li class="nt nt-' + n.level + '" data-nt="' + esc(n.id) + '"><div class="nt-h"><span class="nt-ic" aria-hidden="true">' + ICON[n.level] + '</span><b>' + esc(n.title) + '</b></div>' + (n.body ? '<div class="nt-b">' + n.body + '</div>' : '') +
      '<div class="nt-a">' + (isHandled ? '<button type="button" class="btn sm" data-nt-act="restore">Rétablir</button>'
        : '<button type="button" class="btn sm primary" data-nt-act="accept">' + esc(acc.label) + '</button>' + (n.edit ? '<button type="button" class="btn sm" data-nt-act="edit">' + esc(n.edit.label || 'Modifier') + '</button>' : '') + '<button type="button" class="btn sm ghost" data-nt-act="ignore">Ignorer</button>') + '</div></li>';
  }
  function panelHtml() {
    const p = pending(), d = handled();
    return '<div class="nt-top"><b>Notifications</b><span class="grow"></span>' + (p.length > 1 ? '<button type="button" class="btn sm ghost" data-nt-all>Tout ignorer</button>' : '') + '<button type="button" class="btn sm ghost" data-nt-close aria-label="Fermer">✕</button></div>' +
      (p.length ? '<ul class="nt-list">' + p.map((n) => itemHtml(n, false)).join('') + '</ul>' : '<div class="nt-empty">Rien à signaler.</div>') +
      (d.length ? '<button type="button" class="nt-toggle" data-nt-toggle aria-expanded="' + showDone + '">Traitées (' + d.length + ')' + (showDone ? ' ▴' : ' ▾') + '</button>' + (showDone ? '<ul class="nt-list nt-done">' + d.map((n) => itemHtml(n, true)).join('') + '</ul>' : '') : '');
  }
  function render() {
    const btn = document.getElementById('bellBtn'); if (!btn) return;
    const n = pending(), badge = btn.querySelector('.bell-badge'), worst = n.length ? n[0].level : '';
    badge.textContent = n.length > 9 ? '9+' : String(n.length); badge.classList.toggle('hide', !n.length); badge.dataset.level = worst;
    btn.setAttribute('aria-label', n.length ? 'Notifications : ' + n.length + ' à lire' : 'Notifications : rien à signaler'); btn.title = btn.getAttribute('aria-label');
    const pan = document.getElementById('bellPanel'); if (pan) { pan.classList.toggle('hide', !open); btn.setAttribute('aria-expanded', open ? 'true' : 'false'); if (open) pan.innerHTML = panelHtml(); }
  }
  function schedule() { if (timer) return; timer = setTimeout(() => { timer = null; render(); }, 60); }
  function closePanel() { open = false; render(); }
  function toggle() { open = !open; showDone = false; render(); if (open) { const p = document.getElementById('bellPanel'); if (p) p.focus(); } }

  function init() {
    const btn = document.getElementById('bellBtn'); if (!btn || btn.dataset.wired) return; btn.dataset.wired = '1';
    let pan = document.getElementById('bellPanel');
    if (!pan) { pan = document.createElement('div'); pan.id = 'bellPanel'; pan.className = 'bell-panel hide'; pan.setAttribute('role', 'dialog'); pan.setAttribute('aria-label', 'Notifications'); pan.tabIndex = -1; document.body.appendChild(pan); }
    btn.onclick = (e) => { e.stopPropagation(); toggle(); };
    pan.addEventListener('click', (e) => {
      e.stopPropagation(); const t = e.target;
      if (t.closest('[data-nt-close]')) return closePanel();
      if (t.closest('[data-nt-toggle]')) { showDone = !showDone; return render(); }
      if (t.closest('[data-nt-all]')) { pending().forEach((n) => { done()[n.id] = { sig: n.sig, at: new Date().toISOString(), how: 'ignored' }; if (n.src === 'event') events.splice(events.indexOf(n), 1); }); try { saveState(); } catch (er) { /* ignoré */ } return render(); }
      const b = t.closest('[data-nt-act]'), li = t.closest('[data-nt]'); if (!b || !li) return;
      const id = li.dataset.nt, act = b.dataset.ntAct;
      if (act === 'ignore') handle(id, 'ignored'); else if (act === 'restore') restore(id); else run(id, act);
    });
    document.addEventListener('click', (e) => { if (open && !e.target.closest('#bellPanel') && !e.target.closest('#bellBtn')) closePanel(); });
    document.addEventListener('keydown', (e) => { if (open && e.key === 'Escape') { closePanel(); btn.focus(); } });
    render();
  }
  return { set, clear, push, init, render, pending, handled, handle, restore };
})();
