/* ==================================================================
   cloud.js — comptes utilisateurs et synchronisation (Firebase Auth + Firestore).
   - Connexion / création de compte par e-mail + mot de passe, récupération par e-mail.
   - Les données de chaque utilisateur sont dans  users/{uid}  (règles Firestore : seul
     le propriétaire peut lire / écrire — voir firestore.rules).
   - L'état complet est sérialisé en JSON, découpé en morceaux (limite Firestore),
     écrit dans une transaction avec contrôle de version (pas d'écrasement silencieux
     entre deux appareils).
   - Le SDK est chargé à la demande : sans configuration ou hors-ligne, l'app reste
     utilisable en mode local.
   ================================================================== */
(function (root) {
  const SDK = ['https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js',
    'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth-compat.js',
    'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore-compat.js'];
  const CHUNK = 200000;

  let fb = null, auth = null, db = null, ready = null, currentUser = null;
  const listeners = [];

  function config() { return root.APP_CONFIG && root.APP_CONFIG.firebase && root.APP_CONFIG.firebase.apiKey ? root.APP_CONFIG.firebase : null; }
  function configured() { return !!config(); }

  function loadScript(src) {
    return new Promise(function (res, rej) {
      const s = document.createElement('script');
      s.src = src; s.async = false; s.onload = res; s.onerror = function () { rej(new Error('sdk')); };
      document.head.appendChild(s);
    });
  }

  /* Initialise Firebase (une seule fois). `inject` sert aux tests. */
  function init(inject) {
    if (ready) return ready;
    ready = (async function () {
      if (!configured()) throw new Error('not-configured');
      if (inject) fb = inject;
      else {
        if (!root.firebase) { for (let i = 0; i < SDK.length; i++) await loadScript(SDK[i]); }
        fb = root.firebase;
      }
      if (!fb.apps.length) fb.initializeApp(config());
      auth = fb.auth(); db = fb.firestore();
      auth.onAuthStateChanged(function (u) { currentUser = u; listeners.forEach(function (f) { f(u); }); });
    })();
    ready.catch(function () { ready = null; });
    return ready;
  }
  function onAuthChange(cb) { listeners.push(cb); if (currentUser !== null) cb(currentUser); }
  function user() { return currentUser; }

  /* ---------- erreurs en français ---------- */
  function friendly(e) {
    const c = (e && (e.code || e.message)) || '';
    const map = {
      'auth/invalid-email': "Adresse e-mail invalide.",
      'auth/user-not-found': "Aucun compte avec cette adresse e-mail.",
      'auth/wrong-password': "Mot de passe incorrect.",
      'auth/invalid-credential': "E-mail ou mot de passe incorrect.",
      'auth/invalid-login-credentials': "E-mail ou mot de passe incorrect.",
      'auth/email-already-in-use': "Un compte existe déjà avec cette adresse e-mail.",
      'auth/weak-password': "Mot de passe trop faible (8 caractères minimum conseillés, 6 requis).",
      'auth/too-many-requests': "Trop de tentatives. Patientez quelques minutes avant de réessayer.",
      'auth/network-request-failed': "Connexion impossible : vérifiez votre accès Internet.",
      'auth/requires-recent-login': "Pour cette action, reconnectez-vous d'abord.",
      'auth/operation-not-allowed': "La connexion par e-mail n'est pas activée dans le projet Firebase.",
      'auth/missing-password': "Saisissez votre mot de passe.",
      'permission-denied': "Accès refusé par la base de données : vérifiez les règles Firestore (voir README).",
      'unavailable': "Base de données injoignable pour le moment (hors-ligne ?).",
      'sdk': "Impossible de charger le service de synchronisation (hors-ligne ?).",
      'not-configured': "La synchronisation n'est pas encore configurée."
    };
    return map[c] || ('Erreur : ' + (e && e.message ? e.message : c));
  }

  async function need() { await init(); }

  async function signUp(email, pwd) { await need(); return auth.createUserWithEmailAndPassword(email, pwd); }
  async function signIn(email, pwd) { await need(); return auth.signInWithEmailAndPassword(email, pwd); }
  async function signOut() { await need(); return auth.signOut(); }
  async function resetPassword(email) { await need(); return auth.sendPasswordResetEmail(email); }
  async function sendVerification() { await need(); if (auth.currentUser) return auth.currentUser.sendEmailVerification(); }

  /* ---------- données ---------- */
  function refs(uid) {
    const meta = db.collection('users').doc(uid);
    return { meta: meta, chunks: meta.collection('chunks') };
  }

  /* Lit l'état distant : { exists, updatedAt, state }. */
  async function fetchRemote() {
    await need();
    const u = auth.currentUser; if (!u) throw new Error('Non connecté.');
    const r = refs(u.uid);
    const snap = await r.meta.get();
    if (!snap.exists) return { exists: false, updatedAt: 0, state: null };
    const m = snap.data();
    if (!m.chunks) return { exists: true, updatedAt: m.updatedAt || 0, state: null };
    const qs = await r.chunks.get();
    const parts = [];
    qs.forEach(function (d) { const x = d.data(); parts[x.i] = x.data; });
    if (parts.length !== m.chunks || parts.some(function (p) { return typeof p !== 'string'; })) throw new Error("Données cloud incomplètes : réessayez dans un instant.");
    return { exists: true, updatedAt: m.updatedAt || 0, state: JSON.parse(parts.join('')) };
  }

  /* Version distante seule (lecture légère du document de contrôle). */
  async function remoteVersion() {
    await need();
    const u = auth.currentUser; if (!u) throw new Error('Non connecté.');
    const snap = await refs(u.uid).meta.get();
    return snap.exists ? (snap.data().updatedAt || 0) : 0;
  }

  /* Écrit l'état. `base` = version distante connue : si elle a changé entre-temps, conflit (rien n'est écrasé). */
  async function push(stateObj, base) {
    await need();
    const u = auth.currentUser; if (!u) throw new Error('Non connecté.');
    const r = refs(u.uid);
    const json = JSON.stringify(stateObj);
    const parts = [];
    for (let i = 0; i < json.length; i += CHUNK) parts.push(json.slice(i, i + CHUNK));
    if (!parts.length) parts.push('{}');
    const updatedAt = Math.max(Date.now(), (base || 0) + 1);
    await db.runTransaction(async function (tx) {
      const snap = await tx.get(r.meta);
      const remoteAt = snap.exists ? (snap.data().updatedAt || 0) : 0;
      if (remoteAt !== (base || 0)) { const e = new Error('conflict'); e.conflict = true; e.remoteAt = remoteAt; throw e; }
      const old = snap.exists ? (snap.data().chunks || 0) : 0;
      parts.forEach(function (p, i) { tx.set(r.chunks.doc(String(i)), { i: i, data: p }); });
      for (let i = parts.length; i < old; i++) tx.delete(r.chunks.doc(String(i)));
      tx.set(r.meta, { schema: 2, updatedAt: updatedAt, chunks: parts.length, size: json.length, email: u.email || null });
    });
    return { updatedAt: updatedAt };
  }

  /* Suppression du compte et de toutes ses données cloud (mot de passe redemandé). */
  async function deleteAccount(pwd) {
    await need();
    const u = auth.currentUser; if (!u) throw new Error('Non connecté.');
    const cred = fb.auth.EmailAuthProvider.credential(u.email, pwd);
    await u.reauthenticateWithCredential(cred);
    const r = refs(u.uid);
    const qs = await r.chunks.get();
    const batch = db.batch();
    qs.forEach(function (d) { batch.delete(d.ref); });
    batch.delete(r.meta);
    await batch.commit();
    await u.delete();
  }

  root.Cloud = { configured: configured, init: init, onAuthChange: onAuthChange, user: user, friendly: friendly,
    signUp: signUp, signIn: signIn, signOut: signOut, resetPassword: resetPassword, sendVerification: sendVerification,
    fetchRemote: fetchRemote, remoteVersion: remoteVersion, push: push, deleteAccount: deleteAccount };
})(typeof self !== 'undefined' ? self : this);
