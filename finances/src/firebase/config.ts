import type { FirebaseOptions } from 'firebase/app'

const env = import.meta.env

/** Mode développement local : l'application parle aux émulateurs Firebase. */
export const useEmulators = env.VITE_USE_EMULATORS === 'true'

const EMULATOR_PROJECT_ID = 'demo-finances'

export const firebaseOptions: FirebaseOptions = useEmulators
  ? {
      apiKey: 'demo-api-key',
      authDomain: `${EMULATOR_PROJECT_ID}.firebaseapp.com`,
      projectId: EMULATOR_PROJECT_ID,
      storageBucket: `${EMULATOR_PROJECT_ID}.appspot.com`,
      appId: 'demo-app',
    }
  : {
      apiKey: env.VITE_FIREBASE_API_KEY,
      authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
      projectId: env.VITE_FIREBASE_PROJECT_ID,
      storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET,
      messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID,
      appId: env.VITE_FIREBASE_APP_ID,
    }

export const isFirebaseConfigured = Boolean(firebaseOptions.apiKey && firebaseOptions.projectId)
