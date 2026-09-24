import type { Timestamp } from 'firebase/firestore'

/** Profil applicatif : users/{uid} */
export interface UserProfile {
  uid: string
  displayName: string
  email: string
  activeHouseholdId: string | null
  createdAt: Timestamp
  updatedAt: Timestamp
}
