/* ==================================================================
   vault.js — stockage durable + code de verrouillage (sans compte).
   - Les données sont écrites dans localStorage ET dans IndexedDB
     (copie de secours si l'un des deux est vidé par le système).
   - Si un code est défini, tout l'état (y compris la clé API) est chiffré
     (AES-GCM 256, clé dérivée du code par PBKDF2) : sans le code, le
     contenu stocké sur le téléphone est illisible.
   - Aucun code n'est jamais stocké ni envoyé : seul le chiffrement le vérifie.
   ================================================================== */
(function (root) {
  const KEY = 'dividendCalendarApp_v1';
  const FAIL_KEY = 'dividendCalendarApp_fails';
  const ITER = 250000;
  const AUTO_LOCK_MS = 60000;
  const te = new TextEncoder(), td = new TextDecoder();

  let key = null, salt = null, iter = ITER;   // clé en mémoire uniquement
  let chain = Promise.resolve();               // écritures sérialisées
  let persisted = null;

  /* ---------- utilitaires ---------- */
  function toB64(buf) {
    const a = new Uint8Array(buf); let s = '';
    for (let i = 0; i < a.length; i += 0x8000) s += String.fromCharCode.apply(null, a.subarray(i, i + 0x8000));
    return btoa(s);
  }
  function fromB64(s) { return Uint8Array.from(atob(s), function (c) { return c.charCodeAt(0); }); }
  function isEnvelope(raw) {
    if (!raw || raw.charAt(0) !== '{') return false;
    try { const o = JSON.parse(raw); return !!(o && o.enc === 1 && o.data && o.salt && o.iv); } catch (e) { return false; }
  }

  /* ---------- IndexedDB (copie de secours) ---------- */
  function idb() {
    return new Promise(function (res, rej) {
      if (!root.indexedDB) return rej(new Error('no idb'));
      const r = indexedDB.open('dividendes', 1);
      r.onupgradeneeded = function () { r.result.createObjectStore('kv'); };
      r.onsuccess = function () { res(r.result); };
      r.onerror = function () { rej(r.error); };
    });
  }
  function idbGet() {
    return idb().then(function (db) {
      return new Promise(function (res) {
        const q = db.transaction('kv').objectStore('kv').get('state');
        q.onsuccess = function () { res(q.result || null); };
        q.onerror = function () { res(null); };
      });
    }).catch(function () { return null; });
  }
  function idbSet(v) {
    return idb().then(function (db) {
      return new Promise(function (res) {
        const tx = db.transaction('kv', 'readwrite');
        if (v === null) tx.objectStore('kv').delete('state'); else tx.objectStore('kv').put(v, 'state');
        tx.oncomplete = function () { res(true); };
        tx.onerror = function () { res(false); };
      });
    }).catch(function () { return false; });
  }
  function lsGet() { try { return localStorage.getItem(KEY); } catch (e) { return null; } }
  function lsSet(v) { try { if (v === null) localStorage.removeItem(KEY); else localStorage.setItem(KEY, v); } catch (e) {} }

  /* Lit les données : localStorage d'abord, sinon la copie IndexedDB (et la restaure). */
  async function readRaw() {
    let raw = lsGet();
    if (!raw) {
      raw = await idbGet();
      if (raw) lsSet(raw);
    }
    return raw || null;
  }

  /* ---------- chiffrement ---------- */
  async function derive(pin, saltBytes, it) {
    const base = await crypto.subtle.importKey('raw', te.encode(pin), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt: saltBytes, iterations: it, hash: 'SHA-256' },
      base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  }
  async function seal(plain) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv }, key, te.encode(plain));
    return JSON.stringify({ enc: 1, v: 1, it: iter, salt: toB64(salt), iv: toB64(iv), data: toB64(ct) });
  }
  async function open(raw, pin) {
    const o = JSON.parse(raw);
    const s = fromB64(o.salt), it = o.it || ITER;
    const k = await derive(pin, s, it);
    const buf = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64(o.iv) }, k, fromB64(o.data));
    return { text: td.decode(buf), key: k, salt: s, iter: it };
  }

  /* ---------- écriture ---------- */
  function write(plainJson) {
    chain = chain.then(async function () {
      const out = key ? await seal(plainJson) : plainJson;
      lsSet(out);
      await idbSet(out);
    }).catch(function () {});
    return chain;
  }
  function hasPin() { return !!key || isEnvelope(lsGet()); }

  /* ---------- essais limités ---------- */
  function fails() { try { return JSON.parse(localStorage.getItem(FAIL_KEY)) || { n: 0, until: 0 }; } catch (e) { return { n: 0, until: 0 }; } }
  function setFails(f) { try { localStorage.setItem(FAIL_KEY, JSON.stringify(f)); } catch (e) {} }
  function waitSeconds() { return Math.max(0, Math.ceil((fails().until - Date.now()) / 1000)); }
  function registerFail() {
    const f = fails(); f.n += 1;
    if (f.n >= 5) f.until = Date.now() + Math.min(900, 30 * Math.pow(2, f.n - 5)) * 1000;
    setFails(f);
  }

  /* ---------- écran de verrouillage ---------- */
  function lockScreen(opts) {
    return new Promise(function (resolve) {
      document.documentElement.classList.add('vault-locked');
      let el = document.getElementById('lockScreen');
      if (el) el.remove();
      el = document.createElement('div');
      el.id = 'lockScreen';
      el.innerHTML =
        '<form class="lock-card" autocomplete="off">' +
        '<img src="logo.svg" alt="" class="lock-logo">' +
        '<h2>Dividendes</h2>' +
        '<p class="lock-sub">Entrez votre code pour ouvrir l\'application.</p>' +
        '<input id="lockPin" type="password" inputmode="numeric" pattern="[0-9]*" maxlength="8" autocomplete="off" placeholder="Code" aria-label="Code">' +
        '<div class="lock-err" id="lockErr" role="alert"></div>' +
        '<button class="btn btn-primary" type="submit" id="lockBtn">Déverrouiller</button>' +
        '<button class="lock-forgot" type="button" id="lockForgot">Code oublié ?</button>' +
        '</form>';
      document.body.appendChild(el);
      const pin = el.querySelector('#lockPin'), err = el.querySelector('#lockErr'), btn = el.querySelector('#lockBtn');
      setTimeout(function () { pin.focus(); }, 50);

      let tick = null;
      function showWait() {
        const w = waitSeconds();
        if (w > 0) {
          err.textContent = 'Trop d\'essais. Réessayez dans ' + w + ' s.';
          btn.disabled = true;
          clearTimeout(tick); tick = setTimeout(showWait, 1000);
        } else { btn.disabled = false; if (err.textContent.indexOf('Trop') === 0) err.textContent = ''; }
      }
      showWait();

      el.querySelector('form').onsubmit = async function (e) {
        e.preventDefault();
        if (waitSeconds() > 0) return;
        const v = pin.value.trim();
        if (!/^\d{4,8}$/.test(v)) { err.textContent = 'Le code compte 4 à 8 chiffres.'; return; }
        btn.disabled = true; err.textContent = '';
        try {
          const r = await opts.verify(v);
          setFails({ n: 0, until: 0 });
          el.remove();
          document.documentElement.classList.remove('vault-locked');
          resolve(r);
        } catch (ex) {
          registerFail();
          pin.value = '';
          err.textContent = 'Code incorrect.';
          btn.disabled = false;
          showWait();
          pin.focus();
        }
      };
      el.querySelector('#lockForgot').onclick = function () {
        if (!confirm('Sans le code, les données de ce téléphone ne peuvent pas être récupérées.\n\nEffacer les données de cet appareil pour repartir à zéro ? Vous pourrez ensuite restaurer une sauvegarde (fichier JSON) si vous en avez une.')) return;
        wipe().then(function () { location.reload(); });
      };
    });
  }

  /* Déverrouillage au démarrage : renvoie le JSON en clair. */
  function promptUnlock(raw) {
    return lockScreen({
      verify: async function (pin) {
        const r = await open(raw, pin);
        key = r.key; salt = r.salt; iter = r.iter;
        return r.text;
      }
    });
  }
  /* Reverrouillage (retour d'arrière-plan) : le code est revérifié sur la copie stockée. */
  function promptRelock() {
    const raw = lsGet();
    if (!isEnvelope(raw)) return Promise.resolve();
    return lockScreen({ verify: function (pin) { return open(raw, pin); } });
  }

  let hiddenAt = 0, locking = false;
  function enableAutoLock() {
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'hidden') { hiddenAt = Date.now(); return; }
      if (key && !locking && hiddenAt && Date.now() - hiddenAt > AUTO_LOCK_MS) {
        locking = true;
        promptRelock().then(function () { locking = false; });
      }
    });
  }

  /* ---------- gestion du code ---------- */
  async function verifyPin(pin) {
    const raw = lsGet();
    if (!isEnvelope(raw)) throw new Error('no pin');
    await open(raw, pin);
  }
  async function setPin(pin, plainJson) {
    salt = crypto.getRandomValues(new Uint8Array(16)); iter = ITER;
    key = await derive(pin, salt, iter);
    await write(plainJson);
  }
  async function removePin(plainJson) {
    key = null; salt = null;
    await write(plainJson);
  }
  async function wipe() {
    key = null; salt = null;
    lsSet(null);
    await idbSet(null);
    setFails({ n: 0, until: 0 });
    try { const c = await caches.open('dividendes-data'); await c.delete('state.json'); } catch (e) {}
  }

  /* ---------- stockage persistant ---------- */
  async function requestPersistence() {
    try {
      if (navigator.storage && navigator.storage.persist) {
        persisted = (await navigator.storage.persisted()) || (await navigator.storage.persist());
      }
    } catch (e) {}
    return persisted;
  }

  /* Si les données sont chiffrées, masque l'app dès le chargement (avant tout calcul). */
  if (isEnvelope(lsGet())) document.documentElement.classList.add('vault-locked');

  root.Vault = {
    readRaw: readRaw, write: write, isEnvelope: isEnvelope, hasPin: hasPin,
    promptUnlock: promptUnlock, enableAutoLock: enableAutoLock,
    verifyPin: verifyPin, setPin: setPin, removePin: removePin, wipe: wipe,
    requestPersistence: requestPersistence,
    isPersisted: function () { return persisted; }
  };
})(window);
