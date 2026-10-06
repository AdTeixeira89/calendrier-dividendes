import type { Category, Cents, Subscription } from '@/types'
import { monthKey, monthRange, shiftMonth, type MonthKey } from './month'

/** Une dépense automatique à créer : l'occurrence d'un abonnement ou d'une charge fixe pour un mois. */
export interface DueOccurrence {
  /** `${abonnement}_${mois}` : identifiant fixe, donc une occurrence n'est jamais créée deux fois. */
  id: string
  subscriptionId: string
  month: MonthKey
  date: Date
  amountCents: Cents
  categoryId: string
  merchant: string
}

export function occurrenceId(subscriptionId: string, month: MonthKey): string {
  return `${subscriptionId}_${month}`
}

/** Mois d'une dépense générée automatiquement d'après son identifiant ; null pour toute autre dépense. */
export function occurrenceMonth(expenseId: string, subscriptionId: string): MonthKey | null {
  const prefix = `${subscriptionId}_`
  const month = expenseId.startsWith(prefix) ? expenseId.slice(prefix.length) : ''
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(month) ? month : null
}

/** Catégorie de la dépense : celle choisie, sinon « Autres », sinon la première catégorie racine. */
export function resolveCategoryId(categoryId: string | null, categories: Category[]): string | null {
  const usable = categories.filter((c) => c.kind === 'expense' && !c.archived)
  if (categoryId && usable.some((c) => c.id === categoryId)) return categoryId
  return (usable.find((c) => c.name === 'Autres') ?? usable.find((c) => !c.parentId))?.id ?? null
}

export function monthsBetween(from: MonthKey, to: MonthKey): MonthKey[] {
  const months: MonthKey[] = []
  for (let m = from; m <= to; m = shiftMonth(m, 1)) months.push(m)
  return months
}

/** Date de l'occurrence d'un mois : jour demandé borné à la fin du mois (un 31 devient un 30), à midi comme les saisies manuelles. */
export function occurrenceDate(month: MonthKey, day: number): Date {
  const { start } = monthRange(month)
  const lastDay = new Date(start.getFullYear(), start.getMonth() + 1, 0).getDate()
  return new Date(start.getFullYear(), start.getMonth(), Math.min(day, lastDay), 12)
}

/**
 * Occurrences à avoir en base, du mois de départ jusqu'au mois en cours.
 * Mensuel : chaque mois. Annuel : seulement le mois anniversaire, pour le
 * montant entier (c'est ce qui sort réellement du compte). Le jour est celui
 * du prélèvement (date saisie), borné à la fin du mois (un 31 devient un 30).
 *
 * Une occurrence n'est comptée qu'à partir de sa date : tant que le jour du
 * prélèvement n'est pas arrivé, rien n'est créé (`includeFuture` sert
 * uniquement à réaligner une dépense déjà créée après modification).
 */
export function dueOccurrences(subscription: Subscription, categories: Category[], today: Date = new Date(), options: { includeFuture?: boolean } = {}): DueOccurrence[] {
  if (subscription.archived || subscription.autoExpense === false) return []
  const current = monthKey(today)
  const start = subscription.startMonth ?? current
  if (start > current) return []
  const categoryId = resolveCategoryId(subscription.categoryId, categories)
  if (!categoryId) return []

  const billing = subscription.nextDate?.toDate() ?? null
  const day = billing?.getDate() ?? 1
  const anniversaryMonthIndex = (billing ?? monthRange(start).start).getMonth()

  const endOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 23, 59, 59, 999)
  const occurrences: DueOccurrence[] = []
  for (const month of monthsBetween(start, current)) {
    if (subscription.skippedMonths?.includes(month)) continue
    if (subscription.period === 'yearly' && monthRange(month).start.getMonth() !== anniversaryMonthIndex) continue
    const date = occurrenceDate(month, day)
    if (!options.includeFuture && date > endOfToday) continue
    occurrences.push({
      id: occurrenceId(subscription.id, month),
      subscriptionId: subscription.id,
      month,
      date,
      amountCents: subscription.amountCents,
      categoryId,
      merchant: subscription.name,
    })
  }
  return occurrences
}
