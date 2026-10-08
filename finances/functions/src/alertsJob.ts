import { FieldValue, type Firestore, type QueryDocumentSnapshot } from 'firebase-admin/firestore'
import { evaluateAlerts, withDefaultSettings, type AlertInput, type AlertSettings, type FinancialAlert } from './shared/alerts.js'
import { commonBudgetCents } from './shared/budget.js'
import { BUDGET_MONTH_START_DAY, budgetMonthKey, expenseFetchBounds, expenseMonthKey } from './shared/budgetMonth.js'
import type { PushPayload } from './shared/push.js'

export interface StoredPushSubscription {
  endpoint: string
  p256dh: string
  auth: string
}

/** Envoie une notification ; rejette avec `statusCode` 404/410 si l'abonnement n'existe plus. */
export type PushSender = (subscription: StoredPushSubscription, payload: PushPayload) => Promise<void>

/** Date calendaire à Paris, quel que soit le fuseau du serveur (UTC sur Cloud Functions). */
export function parisCalendar(now: Date): { today: Date; month: string; previousMonth: string } {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now).map((p) => [p.type, p.value]),
  )
  const year = Number(parts.year)
  const month = Number(parts.month)
  const today = new Date(year, month - 1, Number(parts.day))
  const prev = new Date(year, month - 2, 1)
  const key = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
  return { today, month: key(today), previousMonth: key(prev) }
}

function monthBounds(month: string): { start: Date; end: Date } {
  const [year, m] = month.split('-').map(Number)
  return { start: new Date(Date.UTC(year!, m! - 1, 1)), end: new Date(Date.UTC(year!, m!, 1)) }
}

/** Dépenses communes seulement : les dépenses personnelles ne se mélangent pas aux suivis du foyer. */
const commonOnly = (docs: QueryDocumentSnapshot[]) => docs.filter((d) => d.data().scope !== 'personal')

/** Dépenses du mois comptable : courantes du 6 au 5, récurrentes (prêts, abonnements…) dans le mois civil de leur date. */
const inMonth = (docs: QueryDocumentSnapshot[], month: string) => docs.filter((d) => expenseMonthKey(d.data().date.toDate(), d.data()) === month)

const cents = (docs: QueryDocumentSnapshot[]) => docs.reduce((sum, d) => sum + (d.data().amountCents as number), 0)

/** Rassemble, pour un foyer, exactement les données que la carte « Alertes » de l'app utilise. */
export async function loadAlertInput(db: Firestore, householdId: string, now: Date): Promise<AlertInput> {
  const paris = parisCalendar(now)
  const { today } = paris
  // Dépenses : mois budgétaire (du 6 au 5) ; du 1er au 5, c'est encore le mois précédent. Revenus : mois civils.
  const month = budgetMonthKey(today)
  const previousMonth = budgetMonthKey(new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)) - 2, BUDGET_MONTH_START_DAY))
  const ref = db.collection('households').doc(householdId)
  const cur = monthBounds(month)
  const prev = monthBounds(previousMonth)
  const curWindow = expenseFetchBounds(month, month)
  const prevWindow = expenseFetchBounds(previousMonth, previousMonth)

  const [expenses, incomes, prevExpenses, prevIncomes, budgetGlobal, budgetSplit, categories, subscriptions, settings] = await Promise.all([
    ref.collection('expenses').where('date', '>=', curWindow.start).where('date', '<', curWindow.end).get(),
    ref.collection('incomes').where('date', '>=', cur.start).where('date', '<', cur.end).get(),
    ref.collection('expenses').where('date', '>=', prevWindow.start).where('date', '<', prevWindow.end).get(),
    ref.collection('incomes').where('date', '>=', prev.start).where('date', '<', prev.end).get(),
    ref.collection('settings').doc('budgetGlobal').get(),
    ref.collection('settings').doc('budgetSplit').get(),
    ref.collection('categories').get(),
    ref.collection('subscriptions').get(),
    ref.collection('settings').doc('alerts').get(),
  ])

  return {
    today,
    month,
    expenses: commonOnly(inMonth(expenses.docs, month)).map((d) => ({ amountCents: d.data().amountCents as number, categoryId: d.data().categoryId as string })),
    incomeCents: cents(incomes.docs),
    budgetCents: commonBudgetCents(budgetGlobal.data()?.totalCents as number | null | undefined, budgetSplit.data()?.plans as Record<string, { commonCents?: number }> | undefined),
    categoryNames: Object.fromEntries(categories.docs.map((d) => [d.id, d.data().name as string])),
    subscriptions: subscriptions.docs.map((d) => {
      const data = d.data()
      return { id: d.id, name: data.name as string, amountCents: data.amountCents as number, period: data.period === 'yearly' ? ('yearly' as const) : ('monthly' as const), nextDate: data.nextDate?.toDate() ?? null, archived: Boolean(data.archived) }
    }),
    previousMonth: { month: previousMonth, incomeCents: cents(prevIncomes.docs), expenseCents: cents(commonOnly(inMonth(prevExpenses.docs, previousMonth))) },
    settings: withDefaultSettings(settings.data() as Partial<AlertSettings> | undefined),
  }
}

/** Regroupe les nouvelles alertes en une seule notification (une par alerte serait envahissant). */
export function buildPayload(alerts: FinancialAlert[]): PushPayload {
  if (alerts.length === 1) {
    const [a] = alerts
    return { title: a!.title, body: a!.message, url: a!.link, tag: a!.key }
  }
  return {
    title: `${alerts.length} nouvelles alertes`,
    body: alerts.map((a) => `• ${a.title}`).join('\n'),
    url: '/',
    tag: 'alerts-summary',
  }
}

/** Abonnements push de tous les membres du foyer. */
async function householdSubscriptions(db: Firestore, householdId: string) {
  const household = await db.collection('households').doc(householdId).get()
  const memberIds = (household.data()?.memberIds as string[] | undefined) ?? []
  const snaps = await Promise.all(memberIds.map((uid) => db.collection('users').doc(uid).collection('pushSubscriptions').get()))
  return snaps.flatMap((s) => s.docs)
}

/** Envoie à chaque appareil ; supprime les abonnements expirés (appareil réinitialisé, notifications retirées…). */
export async function sendToSubscriptions(docs: QueryDocumentSnapshot[], payload: PushPayload, send: PushSender): Promise<number> {
  let delivered = 0
  await Promise.all(
    docs.map(async (doc) => {
      try {
        await send(doc.data() as StoredPushSubscription, payload)
        delivered++
      } catch (err) {
        const status = (err as { statusCode?: number }).statusCode
        if (status === 404 || status === 410) await doc.ref.delete()
        else throw err
      }
    }),
  )
  return delivered
}

/**
 * Évalue les alertes d'un foyer et notifie uniquement celles qui ne l'ont pas
 * encore été (mémorisées dans `alerts/notified`). Retourne les alertes envoyées.
 */
export async function notifyNewAlerts(db: Firestore, householdId: string, now: Date, send: PushSender): Promise<FinancialAlert[]> {
  const subscriptions = await householdSubscriptions(db, householdId)
  if (subscriptions.length === 0) return []

  const alerts = evaluateAlerts(await loadAlertInput(db, householdId, now))
  const stateRef = db.collection('households').doc(householdId).collection('alerts').doc('notified')
  const alreadySent = new Set(((await stateRef.get()).data()?.keys as string[] | undefined) ?? [])
  const fresh = alerts.filter((a) => !alreadySent.has(a.key))
  if (fresh.length === 0) return []

  await sendToSubscriptions(subscriptions, buildPayload(fresh), send)
  // On ne garde que les 200 dernières clés : les anciennes portent sur des mois révolus.
  const keys = [...alreadySent, ...fresh.map((a) => a.key)].slice(-200)
  await stateRef.set({ householdId, keys, updatedAt: FieldValue.serverTimestamp() })
  return fresh
}
