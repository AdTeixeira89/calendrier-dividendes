import type { Timestamp } from 'firebase/firestore'
import type { BaseEntity, Cents } from './common'

export type DebtType = 'mortgage' | 'works' | 'consumer' | 'car' | 'personal' | 'other'

/** households/{householdId}/debts/{id} */
export interface Debt extends BaseEntity {
  type: DebtType
  name: string
  lender: string | null
  contractNumber: string | null
  principalCents: Cents
  outstandingCents: Cents
  /** Taux annuel en %, ex. 3.2 pour 3,2 %. */
  annualRate: number | null
  startDate: Timestamp
  /** Durée initiale du prêt, en mois. */
  termMonths: number | null
  monthlyPaymentCents: Cents
  insuranceCents: Cents
  feesCents: Cents
  archived: boolean
}

export const DEBT_TYPE_LABELS: Record<DebtType, string> = {
  mortgage: 'Prêt immobilier',
  works: 'Prêt travaux',
  consumer: 'Crédit consommation',
  car: 'Crédit automobile',
  personal: 'Prêt personnel',
  other: 'Autre dette',
}
