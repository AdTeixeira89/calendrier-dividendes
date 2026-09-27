import { initializeApp } from 'firebase/app'
import { connectAuthEmulator, getAuth } from 'firebase/auth'
import {
  connectFirestoreEmulator,
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
} from 'firebase/firestore'
import { connectFunctionsEmulator, getFunctions } from 'firebase/functions'
import { connectStorageEmulator, getStorage } from 'firebase/storage'
import { firebaseOptions, useEmulators } from './config'

export const app = initializeApp(firebaseOptions)

// La session est persistée (IndexedDB) : l'utilisateur reste connecté.
export const auth = getAuth(app)
auth.languageCode = 'fr'

// Cache local persistant : lecture hors-ligne et écritures mises en file
// d'attente, synchronisées automatiquement au retour de la connexion.
export const db = initializeFirestore(app, {
  localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
})

export const storage = getStorage(app)

// Région par défaut des Cloud Functions (europe-west1) : voir functions/src/index.ts.
export const functions = getFunctions(app, 'europe-west1')

if (useEmulators) {
  const host = window.location.hostname
  connectAuthEmulator(auth, `http://${host}:9099`, { disableWarnings: true })
  connectFirestoreEmulator(db, host, 8080)
  connectStorageEmulator(storage, host, 9199)
  connectFunctionsEmulator(functions, host, 5001)
}
