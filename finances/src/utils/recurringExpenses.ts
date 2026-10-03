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

function monthsBetween(from: MonthKey, to: MonthKey): MonthKey[] {
  const months: MonthKey[] = []
  for (let m = from; m <= to; m = shiftMonth(m, 1)) months.push(m)
  return months
}

/**
 * Occurrences à avoir en base, du mois de départ jusqu'au mois en cours.
 * Mensuel : chaque mois. Annuel : seulement le mois anniversaire, pour le
 * montant entier (c'est ce qui sort réellement du compte). Le jour est celui
 * du prélèvement (date saisie), borné à la fin du mois (un 31 devient un 30).
 */
export function dueOccurrences(subscription: Subscription, categories: Category[], today: Date = new Date()): DueOccurrence[] {
  if (subscription.archived || subscription.autoExpense === false) return []
  const current = monthKey(today)
  const start = subscription.startMonth ?? current
  if (start > current) return []
  const categoryId = resolveCategoryId(subscription.categoryId, categories)
  if (!categoryId) return []

  const billing = subscription.nextDate?.toDate() ?? null
  const day = billing?.getDate() ?? 1
  const anniversaryMonthIndex = (billing ?? monthRange(start).start).getMonth()

  const occurrences: DueOccurrence[] = []
  for (const month of monthsBetween(start, current)) {
    if (subscription.skippedMonths?.includes(month)) continue
    const { start: first } = monthRange(month)
    if (subscription.period === 'yearly' && first.getMonth() !== anniversaryMonthIndex) continue
    const lastDay = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate()
    occurrences.push({
      id: occurrenceId(subscription.id, month),
      subscriptionId: subscription.id,
      month,
      // Midi, comme les dates saisies à la main : aucun décalage de jour selon le fuseau.
      date: new Date(first.getFullYear(), first.getMonth(), Math.min(day, lastDay), 12),
      amountCents: subscription.amountCents,
      categoryId,
      merchant: subscription.name,
    })
  }
  return occurrences
}
