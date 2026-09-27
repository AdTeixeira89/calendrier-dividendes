import type { BaseEntity } from './common'

export type DocumentKind = 'receipt' | 'invoice' | 'statement' | 'contract' | 'other'

/**
 * households/{householdId}/documents/{id} — documents importés (hors tickets
 * déjà rattachés à une dépense via `Expense.receiptPath`) : factures,
 * relevés, contrats… Stockage uniquement, sans extraction automatique.
 */
export interface AppDocument extends BaseEntity {
  name: string
  kind: DocumentKind
  storagePath: string
  mimeType: string
  sizeBytes: number
}

export const DOCUMENT_KIND_LABELS: Record<DocumentKind, string> = {
  receipt: 'Ticket',
  invoice: 'Facture',
  statement: 'Relevé',
  contract: 'Contrat',
  other: 'Autre',
}
