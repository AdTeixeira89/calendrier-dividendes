import type { Timestamp } from 'firebase/firestore'
import type { BaseEntity, Cents, Scope } from './common'

export type IncomeType = 'salary' | 'bonus' | 'overtime' | 'benefits' | 'rental' | 'secondary' | 'reimbursement' | 'other'
export type IncomeFrequency = 'monthly' | 'yearly' | 'one_off'

/** households/{householdId}/incomes/{id} */
export interface Income extends BaseEntity {
  amountCents: Cents
  date: Timestamp
  type: IncomeType
  label: string | null
  memberId: string | null
  scope: Scope
  frequency: IncomeFrequency
  note: string | null
  /** Revenu fixe qui a généré cette ligne automatiquement. */
  recurrenceId?: string | null
}

export const INCOME_TYPE_LABELS: Record<IncomeType, string> = {
  salary: 'Salaire',
  bonus: 'Prime',
  overtime: 'Heures supplémentaires',
  benefits: 'Allocations',
  rental: 'Revenus locatifs',
  secondary: 'Revenu secondaire',
  reimbursement: 'Remboursement',
  other: 'Autre',
}

export const INCOME_FREQUENCY_LABELS: Record<IncomeFrequency, string> = {
  monthly: 'Mensuel',
  yearly: 'Annuel',
  one_off: 'Ponctuel',
}
