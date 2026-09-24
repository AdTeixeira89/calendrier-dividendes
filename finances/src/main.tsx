import { StrictMode, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { isFirebaseConfigured } from '@/firebase/config'
import '@/styles/global.css'

const root = createRoot(document.getElementById('root')!)
const render = (node: ReactNode) => root.render(<StrictMode>{node}</StrictMode>)

// Firebase n'est initialisé que si la configuration est présente.
if (isFirebaseConfigured) {
  void import('./App').then(({ default: App }) => render(<App />))
} else {
  void import('@/pages/SetupRequiredPage').then(({ SetupRequiredPage }) => render(<SetupRequiredPage />))
}
