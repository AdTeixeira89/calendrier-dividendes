import type { Timestamp } from 'firebase/firestore'
import type { BaseEntity, Cents } from './common'

export type SubscriptionPeriod = 'monthly' | 'yearly'

/** households/{householdId}/subscriptions/{id} */
export interface Subscription extends BaseEntity {
  name: string
  amountCents: Cents
  period: SubscriptionPeriod
  categoryId: string | null
  nextDate: Timestamp | null
  /** Renseigné par l'utilisateur : aide à repérer les abonnements peu utilisés. */
  usage: 'frequent' | 'occasional' | 'rare' | null
  archived: boolean
}
