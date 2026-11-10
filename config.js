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
    apiKey: 'AIzaSyCR9LIFocA7tWbrdj7aPbgAIy9yqbq2-vk',
    authDomain: 'stock-pilot-323e4.firebaseapp.com',
    projectId: 'stock-pilot-323e4',
    storageBucket: 'stock-pilot-323e4.firebasestorage.app',
    messagingSenderId: '151595483615',
    appId: '1:151595483615:web:df56fb14b81edc9276846a'
  }
};
