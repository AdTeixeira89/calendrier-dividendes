import { Timestamp, getDoc } from 'firebase/firestore'
import { householdItemDoc } from '@/firebase/paths'
import type { Category, Subscription } from '@/types'
import { monthKey } from '@/utils/month'
import { dueOccurrences, occurrenceMonth, type DueOccurrence } from '@/utils/recurringExpenses'
import type { DueCopy } from '@/utils/recurringCopies'
import { findCreditsCategory, type DueDebtPayment } from '@/utils/debtExpenses'
import { createItemOnce, createPrivateExpenseOnce, updateItem } from './repository'

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
        memberId: o.memberId,
        scope: o.scope,
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
    { amountCents: occurrence.amountCents, categoryId: occurrence.categoryId, merchant: occurrence.merchant, date: Timestamp.fromDate(occurrence.date), scope: occurrence.scope, memberId: occurrence.memberId },
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
  // La règle d'origine est un abonnement ou, à défaut, un prêt dont la mensualité a été supprimée.
  for (const collection of ['subscriptions', 'debts'] as const) {
    const snap = await getDoc(householdItemDoc(householdId, collection, subscriptionId))
    if (!snap.exists()) continue
    const skipped = (snap.data().skippedMonths as string[] | undefined) ?? []
    if (skipped.includes(month)) return
    await updateItem(householdId, collection, subscriptionId, { skippedMonths: [...skipped, month] }, actor)
    return
  }
}

/** Crée les reprises du mois (communes dans le foyer, privées dans l'espace de leur auteur) ; celles qui existent déjà sont laissées. */
export async function createDueCopies(householdId: string, copies: DueCopy[], actor: Actor): Promise<number> {
  let created = 0
  for (const c of copies) {
    const data = { ...c.data, date: Timestamp.fromDate(c.data.date) }
    const wasCreated = c.private ? await createPrivateExpenseOnce(householdId, c.id, data, actor) : await createItemOnce(householdId, 'expenses', c.id, data, actor)
    if (wasCreated) created++
  }
  return created
}

/**
 * Inscrit les mensualités de prêt dues dans les dépenses communes (catégorie « Crédits », créée
 * au besoin), à leur date ; celles qui existent déjà sont laissées telles quelles.
 */
export async function createDueDebtExpenses(householdId: string, payments: DueDebtPayment[], categories: Category[], actor: Actor): Promise<number> {
  if (payments.length === 0) return 0
  let categoryId = findCreditsCategory(categories)?.id
  if (!categoryId) {
    categoryId = 'credits'
    await createItemOnce(householdId, 'categories', categoryId, { name: 'Crédits', kind: 'expense', parentId: null, icon: 'landmark', color: 'debt', order: 998, archived: false }, actor)
  }
  let created = 0
  for (const p of payments) {
    const wasCreated = await createItemOnce(
      householdId,
      'expenses',
      p.id,
      {
        amountCents: p.amountCents,
        date: Timestamp.fromDate(p.date),
        categoryId,
        merchant: p.merchant,
        paymentMethod: 'direct_debit',
        memberId: null,
        scope: 'shared',
        kind: 'recurring',
        note: null,
        receiptPath: null,
        recurrenceId: p.debtId,
      },
      actor,
    )
    if (wasCreated) created++
  }
  return created
}
