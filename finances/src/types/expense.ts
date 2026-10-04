import type { Timestamp } from 'firebase/firestore'
import type { BaseEntity, Cents, Scope } from './common'

export type PaymentMethod = 'card' | 'transfer' | 'cash' | 'check' | 'direct_debit' | 'other'
export type ExpenseKind = 'one_off' | 'recurring' | 'exceptional'

/** households/{householdId}/expenses/{id} */
export interface Expense extends BaseEntity {
  amountCents: Cents
  date: Timestamp
  categoryId: string
  merchant: string | null
  paymentMethod: PaymentMethod
  /** uid du membre concerné, ou null si non attribuée à une personne précise. */
  memberId: string | null
  scope: Scope
  kind: ExpenseKind
  note: string | null
  /** Chemin Storage du ticket/justificatif scanné, ou null si saisie manuelle. */
  receiptPath: string | null
  /** Abonnement / charge fixe qui a généré cette dépense automatiquement. */
  recurrenceId?: string | null
  /** Origine de la saisie quand elle n'est pas manuelle (relevé bancaire importé). */
  source?: 'import'
}

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  card: 'Carte',
  transfer: 'Virement',
  cash: 'Espèces',
  check: 'Chèque',
  direct_debit: 'Prélèvement',
  other: 'Autre',
}

export const EXPENSE_KIND_LABELS: Record<ExpenseKind, string> = {
  one_off: 'Ponctuelle',
  recurring: 'Récurrente',
  exceptional: 'Exceptionnelle',
}
