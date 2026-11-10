/* Configuration publique de l'application (aucun secret ici).
   - relayUrl : relais Cloudflare vers Yahoo Finance (données de marché).
   - firebase : configuration WEB de votre projet Firebase (identifiants publics,
     la sécurité repose sur les règles Firestore du fichier firestore.rules).
     Laissez `null` tant que le projet n'est pas créé : l'app fonctionne alors en mode local. */
window.APP_CONFIG = {
  /* Comptes et synchronisation (Firebase Auth + Firestore, collection « suivi_dividendes ») : configuration PRÊTE mais encore DÉSACTIVÉE.
     À passer à true une fois la console Firebase prête (e-mail / mot de passe activé, base Firestore, règles publiées, domaine autorisé) :
     tant que c'est false, l'application reste en mode local (données de l'appareil conservées). */
  accountsEnabled: false,
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
