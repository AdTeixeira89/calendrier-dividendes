import type { Category, Cents, Debt } from '@/types'
import { monthKey, shiftMonth, type MonthKey } from './month'
import { monthsBetween, occurrenceDate } from './recurringExpenses'

/** Une mensualité de prêt à inscrire dans les dépenses : prêt × mois. */
export interface DueDebtPayment {
  /** `${prêt}_${mois}` : identifiant fixe, donc une mensualité n'est jamais comptée deux fois. */
  id: string
  debtId: string
  month: MonthKey
  date: Date
  amountCents: Cents
  merchant: string
}

/** Montant débité chaque mois : mensualité + assurance. */
export function monthlyDebit(debt: Pick<Debt, 'monthlyPaymentCents' | 'insuranceCents'>): Cents {
  return debt.monthlyPaymentCents + (debt.insuranceCents ?? 0)
}

/** Catégorie « Crédits » existante (ou « Prêts »), s'il y en a une. */
export function findCreditsCategory(categories: Category[]): Category | undefined {
  return categories.find((c) => c.kind === 'expense' && !c.archived && /^(cr[ée]dits?|pr[eê]ts?|dettes?)\b/i.test(c.name.trim()))
}

/**
 * Mensualités à avoir en dépenses, du mois de départ du suivi jusqu'au mois en cours.
 * Le jour est celui de la date de début du prêt (le « 5 de chaque mois »), borné à la fin du
 * mois ; la mensualité n'est comptée qu'à partir de son jour. Le suivi commence au mois de
 * saisie du prêt (jamais de rattrapage d'années passées) et s'arrête à la fin de la durée du
 * prêt, ou s'il est soldé ou archivé.
 */
export function dueDebtPayments(debt: Debt, today: Date = new Date()): DueDebtPayment[] {
  if (debt.archived || debt.outstandingCents <= 0 || monthlyDebit(debt) <= 0) return []
  const current = monthKey(today)
  const entered = monthKey(debt.createdAt?.toDate?.() ?? today)
  const first = monthKey(debt.startDate.toDate())
  const start = entered > first ? entered : first
  const last = debt.termMonths ? shiftMonth(first, debt.termMonths - 1) : current
  const end = last < current ? last : current
  if (start > end) return []

  const day = debt.startDate.toDate().getDate()
  const endOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 23, 59, 59, 999)
  const skipped = (debt as Debt & { skippedMonths?: string[] }).skippedMonths ?? []
  const payments: DueDebtPayment[] = []
  for (const month of monthsBetween(start, end)) {
    if (skipped.includes(month)) continue
    const date = occurrenceDate(month, day)
    if (date > endOfToday) continue
    payments.push({ id: `${debt.id}_${month}`, debtId: debt.id, month, date, amountCents: monthlyDebit(debt), merchant: debt.name })
  }
  return payments
}
