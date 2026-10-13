/* Configuration publique de l'application (aucun secret ici).
   - relayUrl : relais Cloudflare vers Yahoo Finance (données de marché).
   - firebase : configuration WEB de votre projet Firebase (identifiants publics,
     la sécurité repose sur les règles Firestore du fichier firestore.rules).
     Laissez `null` tant que le projet n'est pas créé : l'app fonctionne alors en mode local. */
window.APP_CONFIG = {
  /* Comptes et synchronisation : DÉSACTIVÉS pour le moment (le code PIN local et l'import / export suffisent).
     Le code est conservé : passer à true ET renseigner `firebase` pour les réactiver. */
  accountsEnabled: false,
  relayUrl: 'https://dividende-relais.adam-teixeira89.workers.dev',
  firebase: null
  /* Exemple :
  firebase: {
    apiKey: '…', authDomain: '….firebaseapp.com', projectId: '…',
    storageBucket: '….appspot.com', messagingSenderId: '…', appId: '…'
  } */
};
