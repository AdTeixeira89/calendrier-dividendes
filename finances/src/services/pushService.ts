import { deleteDoc, doc, serverTimestamp, setDoc } from 'firebase/firestore'
import { httpsCallable } from 'firebase/functions'
import { VAPID_PUBLIC_KEY } from '@shared/push'
import { db, functions } from '@/firebase/client'

export type PushSupport = 'ready' | 'needs-install' | 'unsupported'

function isIos(): boolean {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
}

function isStandalone(): boolean {
  return window.matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true
}

/**
 * Sur iPhone, les notifications web n'existent que pour l'app ajoutée à
 * l'écran d'accueil (iOS 16.4+) : dans Safari, `PushManager` est absent.
 */
export function pushSupport(): PushSupport {
  const supported = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window
  if (supported && (!isIos() || isStandalone())) return 'ready'
  return isIos() && !isStandalone() ? 'needs-install' : 'unsupported'
}

async function serviceWorker(): Promise<ServiceWorkerRegistration> {
  const timeout = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error("Le service de l'application n'est pas prêt. Rechargez la page puis réessayez.")), 10_000),
  )
  return Promise.race([navigator.serviceWorker.ready, timeout])
}

function base64UrlToBytes(value: string): Uint8Array<ArrayBuffer> {
  const base64 = (value + '='.repeat((4 - (value.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(base64)
  const bytes = new Uint8Array(new ArrayBuffer(raw.length))
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i)
  return bytes
}

/** Identifiant stable d'un appareil : empreinte de son adresse d'envoi. */
async function subscriptionId(endpoint: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(endpoint))
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

export async function currentPushSubscription(): Promise<PushSubscription | null> {
  if (pushSupport() !== 'ready') return null
  return (await serviceWorker()).pushManager.getSubscription()
}

/** Demande l'autorisation (doit suivre un geste de l'utilisateur) puis enregistre l'appareil. */
export async function enablePush(uid: string): Promise<void> {
  const permission = await Notification.requestPermission()
  if (permission !== 'granted') {
    throw new Error("Notifications refusées. Pour les autoriser : Réglages de l'iPhone → Notifications → Foyer.")
  }
  const registration = await serviceWorker()
  const subscription =
    (await registration.pushManager.getSubscription()) ??
    (await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: base64UrlToBytes(VAPID_PUBLIC_KEY) }))
  const json = subscription.toJSON()
  if (!json.endpoint || !json.keys?.p256dh || !json.keys.auth) throw new Error("Abonnement aux notifications incomplet, réessayez.")
  await setDoc(doc(db, 'users', uid, 'pushSubscriptions', await subscriptionId(json.endpoint)), {
    endpoint: json.endpoint,
    p256dh: json.keys.p256dh,
    auth: json.keys.auth,
    userAgent: navigator.userAgent.slice(0, 300),
    createdAt: serverTimestamp(),
  })
}

export async function disablePush(uid: string): Promise<void> {
  const subscription = await currentPushSubscription()
  if (!subscription) return
  await deleteDoc(doc(db, 'users', uid, 'pushSubscriptions', await subscriptionId(subscription.endpoint)))
  await subscription.unsubscribe()
}

const sendTestPushCallable = httpsCallable<void, { delivered: number }>(functions, 'sendTestPush')

export async function sendTestPush(): Promise<number> {
  const { data } = await sendTestPushCallable()
  return data.delivered
}
