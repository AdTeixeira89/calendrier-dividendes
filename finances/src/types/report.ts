import type { Timestamp } from 'firebase/firestore'
import type { StructuredAnswer } from '@/services/aiService'

export interface ReportFactItem {
  key: string
  label: string
  value: string
}

/** households/{householdId}/reports/{AAAA-MM} — généré par la Function planifiée `monthlyReport`. */
export interface MonthlyReport {
  householdId: string
  month: string
  facts: ReportFactItem[]
  bilan: StructuredAnswer | null
  aiError: string | null
  generatedAt: Timestamp
}
