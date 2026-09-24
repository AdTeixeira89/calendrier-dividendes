import type { Timestamp } from 'firebase/firestore'

export type AuditAction = 'create' | 'update' | 'delete'

/** households/{householdId}/auditLog/{entryId} — journal des modifications (immuable). */
export interface AuditEntry {
  id: string
  householdId: string
  entityType: string
  entityId: string
  action: AuditAction
  before: Record<string, unknown> | null
  after: Record<string, unknown> | null
  changedFields: string[]
  by: string
  at: Timestamp
}
