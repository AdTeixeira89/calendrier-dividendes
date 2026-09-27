export type Cents = number

export function sumCents(values: Cents[]): Cents {
  return values.reduce((total, v) => total + v, 0)
}

/** Taux d'épargne en pourcentage (0-100), arrondi à 1 décimale. Retourne null si aucun revenu. */
export function savingsRatePercent(incomeCents: Cents, expensesCents: Cents): number | null {
  if (incomeCents <= 0) return null
  return Math.round(((incomeCents - expensesCents) / incomeCents) * 1000) / 10
}
