import { initializeApp } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { getStorage } from 'firebase-admin/storage'
import { getFirestore, Timestamp } from 'firebase-admin/firestore'
import { HttpsError, onCall } from 'firebase-functions/v2/https'
import { defineSecret } from 'firebase-functions/params'
import { onSchedule } from 'firebase-functions/v2/scheduler'
import { setGlobalOptions } from 'firebase-functions/v2'
import { logger } from 'firebase-functions'
import webpush from 'web-push'
import { ClaudeProvider, InvalidAIResponseError, type StructuredAnswer } from './aiProvider.js'
import { deleteAccountData } from './accountDeletion.js'
import { notifyNewAlerts, sendToSubscriptions, type PushSender } from './alertsJob.js'
import { computeHouseholdFacts, type HouseholdFacts } from './context.js'
import { VAPID_PUBLIC_KEY } from './shared/push.js'

initializeApp()
setGlobalOptions({ region: 'europe-west1' })

const ANTHROPIC_API_KEY = defineSecret('ANTHROPIC_API_KEY')

// Secret Manager exige une valeur au premier déploiement : ce sentinel tient la
// place tant que la vraie clé (console.anthropic.com) n'a pas été configurée
// via `firebase functions:secrets:set ANTHROPIC_API_KEY`.
const NOT_CONFIGURED = '__not_configured__'

function isConfigured(apiKey: string): boolean {
  return apiKey.length > 0 && apiKey !== NOT_CONFIGURED
}

function currentMonthKey(date = new Date()): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`
}

function previousMonthKey(date = new Date()): string {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() - 1, 1))
  return currentMonthKey(d)
}

async function assertMember(householdId: string, uid: string): Promise<void> {
  const snap = await getFirestore().collection('households').doc(householdId).get()
  const memberIds = (snap.data()?.memberIds as string[] | undefined) ?? []
  if (!snap.exists || !memberIds.includes(uid)) {
    throw new HttpsError('permission-denied', "Vous n'êtes pas membre de ce foyer.")
  }
}

/**
 * Question/réponse IA sur les finances du foyer. Les chiffres viennent
 * toujours de `computeHouseholdFacts` (code déterministe) ; l'IA ne fait
 * qu'expliquer, et toute réponse citant une source inconnue est rejetée.
 */
export const askFinance = onCall({ secrets: [ANTHROPIC_API_KEY] }, async (request) => {
  const uid = request.auth?.uid
  if (!uid) throw new HttpsError('unauthenticated', 'Connexion requise.')

  const householdId = request.data?.householdId
  const question = request.data?.question
  if (typeof householdId !== 'string' || !householdId) throw new HttpsError('invalid-argument', 'householdId requis.')
  if (typeof question !== 'string' || !question.trim() || question.length > 500) {
    throw new HttpsError('invalid-argument', 'Question invalide (texte non vide, 500 caractères maximum).')
  }

  await assertMember(householdId, uid)

  const apiKey = ANTHROPIC_API_KEY.value()
  if (!isConfigured(apiKey)) {
    throw new HttpsError('failed-precondition', "IA indisponible : la clé n'est pas encore configurée pour ce foyer.")
  }

  const facts = await computeHouseholdFacts(getFirestore(), householdId, currentMonthKey())

  try {
    const provider = new ClaudeProvider(apiKey)
    const answer = await provider.complete(question, facts)
    return { answer, month: facts.month }
  } catch (err) {
    if (err instanceof InvalidAIResponseError) {
      logger.warn('Réponse IA rejetée par le validateur', { message: err.message })
      throw new HttpsError('internal', "La réponse de l'IA n'a pas pu être vérifiée, merci de réessayer.")
    }
    logger.error('Échec appel IA', err)
    throw new HttpsError('unavailable', "Le service IA est momentanément indisponible.")
  }
})

async function generateMonthlyReport(householdId: string, monthKey: string, apiKey: string | undefined): Promise<void> {
  const db = getFirestore()
  const facts: HouseholdFacts = await computeHouseholdFacts(db, householdId, monthKey)

  let bilan: StructuredAnswer | null = null
  let aiError: string | null = null
  if (apiKey) {
    try {
      bilan = await new ClaudeProvider(apiKey).complete('Fais un court bilan du mois : dépenses, épargne, dettes.', facts)
    } catch (err) {
      aiError = err instanceof Error ? err.message : 'Erreur inconnue'
      logger.warn(`Bilan IA indisponible pour ${householdId}/${monthKey}`, { aiError })
    }
  } else {
    aiError = "Clé IA non configurée."
  }

  await db
    .collection('households')
    .doc(householdId)
    .collection('reports')
    .doc(monthKey)
    .set({
      householdId,
      month: monthKey,
      facts: facts.items,
      bilan,
      aiError,
      generatedAt: Timestamp.now(),
    })
}

/** Bilan mensuel automatique : le 6 de chaque mois (le mois budgétaire s'est terminé le 5), pour tous les foyers. */
export const monthlyReport = onSchedule({ schedule: '0 6 6 * *', timeZone: 'Europe/Paris', secrets: [ANTHROPIC_API_KEY] }, async () => {
  const db = getFirestore()
  const monthKey = previousMonthKey()
  const households = await db.collection('households').get()
  const rawKey = ANTHROPIC_API_KEY.value()
  const apiKey = isConfigured(rawKey) ? rawKey : undefined

  for (const household of households.docs) {
    try {
      await generateMonthlyReport(household.id, monthKey, apiKey)
    } catch (err) {
      logger.error(`Échec du bilan mensuel pour le foyer ${household.id}`, err)
    }
  }
})

const VAPID_PRIVATE_KEY = defineSecret('VAPID_PRIVATE_KEY')

/** Expéditeur Web Push signé avec les clés VAPID du projet. */
function webPushSender(): PushSender {
  const subject = `https://${process.env.GCLOUD_PROJECT}.web.app`
  return async (subscription, payload) => {
    await webpush.sendNotification(
      { endpoint: subscription.endpoint, keys: { p256dh: subscription.p256dh, auth: subscription.auth } },
      JSON.stringify(payload),
      { vapidDetails: { subject, publicKey: VAPID_PUBLIC_KEY, privateKey: VAPID_PRIVATE_KEY.value() }, TTL: 60 * 60 * 24 },
    )
  }
}

/** Alertes du jour : chaque matin, notifie les membres des nouvelles alertes de leur foyer. */
export const dailyAlerts = onSchedule({ schedule: '0 9 * * *', timeZone: 'Europe/Paris', secrets: [VAPID_PRIVATE_KEY] }, async () => {
  const db = getFirestore()
  const send = webPushSender()
  const now = new Date()
  const households = await db.collection('households').get()
  for (const household of households.docs) {
    try {
      const sent = await notifyNewAlerts(db, household.id, now, send)
      if (sent.length > 0) logger.info(`Alertes envoyées pour ${household.id}`, { keys: sent.map((a) => a.key) })
    } catch (err) {
      logger.error(`Échec des alertes pour le foyer ${household.id}`, err)
    }
  }
})

/** Notification de test sur les appareils de l'utilisateur, pour vérifier l'installation. */
export const sendTestPush = onCall({ secrets: [VAPID_PRIVATE_KEY] }, async (request) => {
  const uid = request.auth?.uid
  if (!uid) throw new HttpsError('unauthenticated', 'Connexion requise.')
  const subscriptions = await getFirestore().collection('users').doc(uid).collection('pushSubscriptions').get()
  if (subscriptions.empty) throw new HttpsError('failed-precondition', "Aucun appareil n'est abonné aux notifications.")
  const delivered = await sendToSubscriptions(
    subscriptions.docs,
    { title: 'Monelya', body: 'Les notifications fonctionnent sur cet appareil.', url: '/parametres', tag: 'test' },
    webPushSender(),
  )
  if (delivered === 0) throw new HttpsError('failed-precondition', "L'abonnement de cet appareil a expiré : réactivez les notifications.")
  return { delivered }
})

/** Suppression définitive du compte de l'appelant, après une reconnexion récente (mot de passe confirmé). */
export const deleteAccount = onCall(async (request) => {
  const uid = request.auth?.uid
  if (!uid) throw new HttpsError('unauthenticated', 'Connexion requise.')
  const authTime = request.auth?.token.auth_time
  if (typeof authTime !== 'number' || Date.now() / 1000 - authTime > 5 * 60) {
    throw new HttpsError('failed-precondition', 'Par sécurité, confirmez votre mot de passe puis réessayez.')
  }
  try {
    const report = await deleteAccountData(getFirestore(), getAuth(), getStorage().bucket(), uid)
    logger.info('Compte supprimé', report)
    return report
  } catch (err) {
    logger.error('Échec de la suppression du compte', err)
    throw new HttpsError('internal', 'La suppression a échoué. Vos données sont intactes ou partiellement effacées : réessayez.')
  }
})
