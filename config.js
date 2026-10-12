/* Configuration publique de l'application (aucun secret ici).
   - relayUrl : relais Cloudflare vers Yahoo Finance (données de marché).
   - firebase : configuration WEB de votre projet Firebase (identifiants publics,
     la sécurité repose sur les règles Firestore du fichier firestore.rules).
     Laissez `null` tant que le projet n'est pas créé : l'app fonctionne alors en mode local. */
window.APP_CONFIG = {
  relayUrl: 'https://dividende-relais.adam-teixeira89.workers.dev',
  firebase: null
  /* Exemple :
  firebase: {
    apiKey: '…', authDomain: '….firebaseapp.com', projectId: '…',
    storageBucket: '….appspot.com', messagingSenderId: '…', appId: '…'
  } */
};
