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

/**
 * Une dépense récurrente (type « Récurrente », abonnement, mensualité de prêt, reprise automatique)
 * compte toujours dans le mois civil de sa date de prélèvement : le 5 octobre, c'est octobre.
 */
export function isRecurringExpense(expense: { kind?: string | null; recurrenceId?: string | null }): boolean {
  return expense.kind === 'recurring' || Boolean(expense.recurrenceId)
}

/** Mois comptable d'une dépense : mois civil si récurrente, mois budgétaire (du 6 au 5) sinon. */
export function expenseMonthKey(date: Date, expense: { kind?: string | null; recurrenceId?: string | null }): string {
  return isRecurringExpense(expense) ? key(date.getFullYear(), date.getMonth()) : budgetMonthKey(date)
}

/**
 * Plage à lire pour couvrir les dépenses de [from, to] (mois comptables inclus) : du 1er du premier
 * mois (récurrentes) au 6 qui suit le dernier mois (courantes) ; on filtre ensuite avec `expenseMonthKey`.
 */
export function expenseFetchBounds(from: string, to: string): { start: Date; end: Date } {
  const [fy, fm] = from.split('-').map(Number) as [number, number]
  return { start: new Date(fy, fm - 1, 1), end: budgetMonthBounds(to).end }
}
