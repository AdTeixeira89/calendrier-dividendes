import type { BaseEntity, Cents } from './common'

/**
 * households/{householdId}/budgets/{id}, id au format "AAAA-MM".
 * `lines` associe un identifiant de catégorie au montant budgété du mois.
 */
export interface Budget extends BaseEntity {
  month: string
  lines: Record<string, Cents>
}
