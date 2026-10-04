import type { Cents, IncomeType, RecurringIncome, Scope } from '@/types'
import { monthKey, type MonthKey } from './month'
import { monthsBetween, occurrenceDate, occurrenceId } from './recurringExpenses'

/** Un revenu à créer automatiquement : l'occurrence d'un revenu fixe pour un mois. */
export interface DueIncome {
  /** `${revenu fixe}_${mois}` : identifiant fixe, jamais créé deux fois. */
  id: string
  recurringId: string
  month: MonthKey
  date: Date
  amountCents: Cents
  type: IncomeType
  label: string
  memberId: string | null
  scope: Scope
}

/**
 * Occurrences à avoir en base, du mois de départ jusqu'au mois en cours.
 * `memberIds` : si la personne a quitté le foyer, le revenu devient celui du
 * foyer (les règles de sécurité refusent un membre inconnu).
 */
export function dueIncomes(income: RecurringIncome, memberIds: string[], today: Date = new Date()): DueIncome[] {
  if (income.archived) return []
  const current = monthKey(today)
  if (income.startMonth > current) return []
  const memberId = income.memberId && memberIds.includes(income.memberId) ? income.memberId : null
  return monthsBetween(income.startMonth, current)
    .filter((month) => !income.skippedMonths?.includes(month))
    .map((month) => ({
      id: occurrenceId(income.id, month),
      recurringId: income.id,
      month,
      date: occurrenceDate(month, income.dayOfMonth),
      amountCents: income.amountCents,
      type: income.type,
      label: income.label,
      memberId,
      scope: income.scope,
    }))
}
