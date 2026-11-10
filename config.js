/* Configuration publique de l'application (aucun secret ici).
   - relayUrl : relais Cloudflare vers Yahoo Finance (données de marché).
   - firebase : configuration WEB de votre projet Firebase (identifiants publics,
     la sécurité repose sur les règles Firestore du fichier firestore.rules).
     Laissez `null` tant que le projet n'est pas créé : l'app fonctionne alors en mode local. */
window.APP_CONFIG = {
  /* Comptes et synchronisation : ACTIVÉS (Firebase Auth + Firestore, collection « suivi_dividendes »).
     Pour revenir au mode local seul : passer accountsEnabled à false (les données de l'appareil sont conservées). */
  accountsEnabled: true,
  relayUrl: 'https://dividende-relais.adam-teixeira89.workers.dev',
  firebase: {
    apiKey: 'AIzaSyAPi_3AMb0r5_ytEY7rPISJ1n3Jsw6-j5E',
    authDomain: 'gestion-finances-6f15f.firebaseapp.com',
    projectId: 'gestion-finances-6f15f',
    storageBucket: 'gestion-finances-6f15f.firebasestorage.app',
    messagingSenderId: '272504769508',
    appId: '1:272504769508:web:51069bd30c8f77aaee95f1'
  }
};
