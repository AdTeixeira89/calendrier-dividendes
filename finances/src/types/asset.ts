import type { Timestamp } from 'firebase/firestore'
import type { BaseEntity, Cents } from './common'

export type AssetType = 'account' | 'savings' | 'investment' | 'real_estate' | 'vehicle' | 'other'

export interface AssetValuation {
  valueCents: Cents
  date: Timestamp
}

/** households/{householdId}/assets/{id} */
export interface Asset extends BaseEntity {
  name: string
  type: AssetType
  valueCents: Cents
  valuedAt: Timestamp
  /** Valorisations précédentes, la plus ancienne en premier — alimente la courbe d'évolution. */
  history: AssetValuation[]
  archived: boolean
}

export const ASSET_TYPE_LABELS: Record<AssetType, string> = {
  account: 'Compte courant',
  savings: 'Épargne',
  investment: 'Placement',
  real_estate: 'Immobilier',
  vehicle: 'Véhicule',
  other: 'Autre',
}
