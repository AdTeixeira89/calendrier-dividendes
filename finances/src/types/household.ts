import type { Timestamp } from 'firebase/firestore'
import type { CurrencyCode } from './common'

/**
 * owner  : fondateur du foyer, gère les membres
 * member : lecture + écriture des données financières
 * viewer : lecture seule (enfant, conseiller… — prévu pour plus tard)
 */
export type HouseholdRole = 'owner' | 'member' | 'viewer'

/** households/{householdId} */
export interface Household {
  id: string
  name: string
  currency: CurrencyCode
  ownerId: string
  memberIds: string[]
  roles: Record<string, HouseholdRole>
  createdAt: Timestamp
  createdBy: string
  updatedAt: Timestamp
  updatedBy: string
}

/** households/{householdId}/members/{uid} */
export interface HouseholdMember {
  uid: string
  displayName: string
  email: string
  role: HouseholdRole
  joinedAt: Timestamp
  inviteCode?: string
}

/** invites/{code} — invitation à usage unique */
export interface HouseholdInvite {
  code: string
  householdId: string
  householdName: string
  createdBy: string
  createdAt: Timestamp
  expiresAt: Timestamp
  usedBy: string | null
  usedAt: Timestamp | null
}
