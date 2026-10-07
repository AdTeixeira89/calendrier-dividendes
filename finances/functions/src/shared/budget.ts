/**
 * Budget global des dépenses communes : un seul montant. Celui que le foyer a
 * inscrit, sinon le total des sommes versées au budget commun par chaque personne.
 * Partagé entre l'application et les Cloud Functions (alertes) pour que les deux
 * comptent pareil.
 */
export function commonBudgetCents(overrideCents: number | null | undefined, plans: Record<string, { commonCents?: number }> | undefined): number {
  if (overrideCents && overrideCents > 0) return overrideCents
  return Object.values(plans ?? {}).reduce((total, plan) => total + (plan.commonCents ?? 0), 0)
}
