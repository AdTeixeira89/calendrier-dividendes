import { Timestamp, getDoc } from 'firebase/firestore'
import { householdItemDoc } from '@/firebase/paths'
import type { Category, Subscription } from '@/types'
import { monthKey } from '@/utils/month'
import { dueOccurrences, occurrenceMonth, type DueOccurrence } from '@/utils/recurringExpenses'
import { createItemOnce, updateItem } from './repository'

interface Actor {
  uid: string
}

/** Crée les dépenses automatiques manquantes ; celles qui existent déjà sont laissées telles quelles. */
export async function createDueExpenses(householdId: string, occurrences: DueOccurrence[], actor: Actor): Promise<number> {
  let created = 0
  for (const o of occurrences) {
    const wasCreated = await createItemOnce(
      householdId,
      'expenses',
      o.id,
      {
        amountCents: o.amountCents,
        date: Timestamp.fromDate(o.date),
        categoryId: o.categoryId,
        merchant: o.merchant,
        paymentMethod: 'direct_debit',
        memberId: null,
        scope: 'shared',
        kind: 'recurring',
        note: null,
        receiptPath: null,
        recurrenceId: o.subscriptionId,
      },
      actor,
    )
    if (wasCreated) created++
  }
  return created
}

/**
 * Après modification d'un abonnement, aligne la dépense du mois en cours
 * (montant, catégorie, libellé, jour) : sans cela, un changement de prix ne
 * se verrait qu'au mois suivant. Les mois passés restent tels quels.
 */
export async function syncCurrentOccurrence(householdId: string, subscription: Subscription, categories: Category[], actor: Actor): Promise<void> {
  const current = monthKey(new Date())
  const occurrence = dueOccurrences(subscription, categories, new Date(), { includeFuture: true }).find((o) => o.month === current)
  if (!occurrence) return
  if (!(await getDoc(householdItemDoc(householdId, 'expenses', occurrence.id))).exists()) return
  await updateItem(
    householdId,
    'expenses',
    occurrence.id,
    { amountCents: occurrence.amountCents, categoryId: occurrence.categoryId, merchant: occurrence.merchant, date: Timestamp.fromDate(occurrence.date) },
    actor,
  )
}

/**
 * Supprimer à la main la dépense d'un mois ne doit pas la faire revenir à la
 * prochaine ouverture : le mois est mémorisé dans l'abonnement.
 */
export async function skipOccurrence(householdId: string, expenseId: string, subscriptionId: string, actor: Actor): Promise<void> {
  const month = occurrenceMonth(expenseId, subscriptionId)
  if (!month) return
  const snap = await getDoc(householdItemDoc(householdId, 'subscriptions', subscriptionId))
  if (!snap.exists()) return
  const skipped = (snap.data().skippedMonths as string[] | undefined) ?? []
  if (skipped.includes(month)) return
  await updateItem(householdId, 'subscriptions', subscriptionId, { skippedMonths: [...skipped, month] }, actor)
}
