/**
 * Mois budgétaire : il commence le 6 et se termine le 5 du mois suivant. Une dépense datée
 * du 1er au 5 d'un mois est donc comptée dans le mois précédent (la dépense du 5 octobre
 * compte pour septembre). Partagé entre l'application et les Cloud Functions.
 */
export const BUDGET_MONTH_START_DAY = 6

function key(year: number, monthIndex: number): string {
  const d = new Date(year, monthIndex, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

/** Mois budgétaire (« AAAA-MM ») d'une date. */
export function budgetMonthKey(date: Date): string {
  return key(date.getFullYear(), date.getMonth() - (date.getDate() < BUDGET_MONTH_START_DAY ? 1 : 0))
}

/** Bornes [début, fin) d'un mois budgétaire : du 6 inclus au 6 du mois suivant exclu, à minuit. */
export function budgetMonthBounds(month: string): { start: Date; end: Date } {
  const [year, m] = month.split('-').map(Number) as [number, number]
  return { start: new Date(year, m - 1, BUDGET_MONTH_START_DAY), end: new Date(year, m, BUDGET_MONTH_START_DAY) }
}
