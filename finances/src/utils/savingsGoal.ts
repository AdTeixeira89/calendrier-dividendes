import type { Cents } from '@/types'

/** Progression en %, bornée à [0, 100]. */
export function goalProgress(currentCents: Cents, targetCents: Cents): number {
  if (targetCents <= 0) return 0
  return Math.min(100, Math.max(0, (currentCents / targetCents) * 100))
}

/**
 * Nombre de mois estimé pour atteindre l'objectif au rythme de versement prévu.
 * `null` si l'objectif est déjà atteint, ou si aucun versement mensuel n'est prévu.
 */
export function monthsToReachGoal(currentCents: Cents, targetCents: Cents, plannedMonthlyCents: Cents): number | null {
  const remaining = targetCents - currentCents
  if (remaining <= 0) return 0
  if (plannedMonthlyCents <= 0) return null
  return Math.ceil(remaining / plannedMonthlyCents)
}

/** Date estimée d'atteinte de l'objectif à partir d'aujourd'hui, `null` si non estimable. */
export function estimatedGoalDate(currentCents: Cents, targetCents: Cents, plannedMonthlyCents: Cents, from: Date = new Date()): Date | null {
  const months = monthsToReachGoal(currentCents, targetCents, plannedMonthlyCents)
  if (months === null) return null
  return new Date(from.getFullYear(), from.getMonth() + months, from.getDate())
}
