import type { BaseEntity, Cents, Scope } from './common'
import type { IncomeType } from './income'

/** households/{householdId}/recurringIncomes/{id} — revenu identique chaque mois (salaire, pension…). */
export interface RecurringIncome extends BaseEntity {
  label: string
  amountCents: Cents
  type: IncomeType
  /** Membre qui le reçoit ; null si le foyer. */
  memberId: string | null
  scope: Scope
  /** Jour du versement (1-31), borné à la fin du mois. */
  dayOfMonth: number
  /** Premier mois (AAAA-MM) pour lequel le revenu est créé automatiquement. */
  startMonth: string
  /** Mois (AAAA-MM) dont le revenu a été supprimé à la main : il ne revient pas. */
  skippedMonths?: string[]
  /** Revenu arrêté (changement d'emploi…) : l'historique est conservé. */
  archived: boolean
}
