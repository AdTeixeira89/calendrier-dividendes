import { createWorker, OEM, type Worker } from 'tesseract.js'

let workerPromise: Promise<Worker> | null = null

const base = import.meta.env.BASE_URL

/**
 * Un seul worker Tesseract, créé à la demande et réutilisé entre deux scans.
 * Moteur et modèle de langue auto-hébergés (public/) plutôt que chargés
 * depuis un CDN : fonctionne même si un pare-feu bloque les CDN tiers, et
 * reste mis en cache par le service worker après le premier scan.
 */
function getWorker(): Promise<Worker> {
  if (!workerPromise) {
    workerPromise = createWorker('fra', OEM.LSTM_ONLY, {
      workerPath: `${base}worker.min.js`,
      // Fichier précis (et non un dossier) : évite la détection de capacités
      // SIMD/relaxedSIMD du navigateur, qui varie selon l'appareil et peut
      // demander une variante non hébergée. SIMD classique est supporté par
      // tous les navigateurs mobiles récents (iPhone/Android des dernières années).
      corePath: `${base}tesseract-core/tesseract-core-simd-lstm.wasm.js`,
      langPath: `${base}tesseract-lang`,
    })
  }
  return workerPromise
}

/**
 * Reconnaissance de texte sur une image (photo de ticket). Le modèle de
 * langue est téléchargé au premier appel (~2 Mo, mis en cache par le
 * navigateur) : prévoir un indicateur de chargement côté interface.
 */
export async function recognizeReceiptText(image: File | Blob | string): Promise<string> {
  const worker = await getWorker()
  const {
    data: { text },
  } = await worker.recognize(image)
  return text
}
