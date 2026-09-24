import type { Timestamp } from 'firebase/firestore'

/** Montant en centimes (entier) : évite toute erreur d'arrondi sur les flottants. */
export type Cents = number

/** Code devise ISO 4217 (ex. "EUR"). */
export type CurrencyCode = string

/** Rattachement d'une donnée : personnelle ou commune au foyer. */
export type Scope = 'personal' | 'shared'

/**
 * Champs présents sur toute donnée financière d'un foyer.
 * `householdId` duplique le chemin Firestore pour faciliter exports et contrôles.
 */
export interface BaseEntity {
  id: string
  householdId: string
  createdBy: string
  createdAt: Timestamp
  updatedBy: string
  updatedAt: Timestamp
}

/** Données saisies par l'utilisateur (sans les champs gérés par le dépôt). */
export type EntityInput<T extends BaseEntity> = Omit<T, keyof BaseEntity>
