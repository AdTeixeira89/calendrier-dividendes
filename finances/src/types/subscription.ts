import type { Timestamp } from 'firebase/firestore'
import type { BaseEntity, Cents, Scope } from './common'

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
  /** Ajoute chaque mois une dépense automatique (défaut : oui quand le champ est absent). */
  autoExpense?: boolean
  /** Premier mois (AAAA-MM) pour lequel la dépense automatique est créée. */
  startMonth?: string
  /** Mois (AAAA-MM) dont la dépense a été supprimée à la main : elle ne revient pas. */
  skippedMonths?: string[]
  /** Espace des dépenses générées : commun (défaut) ou personnel d'un membre. */
  scope?: Scope
  memberId?: string | null
}
