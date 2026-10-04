import type { Timestamp } from 'firebase/firestore'
import type { BaseEntity, Cents, Scope } from './common'

/** households/{householdId}/savingsGoals/{id} */
export interface SavingsGoal extends BaseEntity {
  name: string
  icon: string
  color: string
  targetCents: Cents
  currentCents: Cents
  targetDate: Timestamp | null
  /** Versement mensuel prévu, pour estimer la date d'atteinte. */
  plannedMonthlyCents: Cents
  archived: boolean
  /** Absent sur les anciens objectifs : traités comme communs. */
  scope?: Scope
  /** Propriétaire quand l'épargne est personnelle. */
  memberId?: string | null
}
