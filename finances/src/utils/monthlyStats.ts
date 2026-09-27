import type { Cents } from '@/types'
import type { Expense } from '@/types/expense'
import type { Income } from '@/types/income'

export interface MonthlySummary {
  incomeCents: Cents
  expenseCents: Cents
  /** Revenus − dépenses : ce qu'il reste une fois toutes les dépenses payées. */
  savingsCents: Cents
  /** Taux d'épargne en % (null si aucun revenu ce mois-ci). */
  savingsRate: number | null
  /** Revenus − dépenses récurrentes uniquement (charges fixes). */
  livingAllowanceCents: Cents
}

export function sumCents(items: { amountCents: Cents }[]): Cents {
  return items.reduce((total, item) => total + item.amountCents, 0)
}

export function summarizeMonth(expenses: Expense[], incomes: Income[]): MonthlySummary {
  const incomeCents = sumCents(incomes)
  const expenseCents = sumCents(expenses)
  const recurringCents = sumCents(expenses.filter((e) => e.kind === 'recurring'))
  const savingsCents = incomeCents - expenseCents
  return {
    incomeCents,
    expenseCents,
    savingsCents,
    savingsRate: incomeCents > 0 ? (savingsCents / incomeCents) * 100 : null,
    livingAllowanceCents: incomeCents - recurringCents,
  }
}

/**
 * Intègre les mensualités de prêts (capital + assurance) au résumé du mois :
 * ce sont des charges fixes à part entière, même si elles ne sont pas
 * enregistrées comme des dépenses individuelles (cahier des charges §13).
 */
export function withDebtCharges(summary: MonthlySummary, debtMonthlyCents: Cents): MonthlySummary {
  if (debtMonthlyCents <= 0) return summary
  const expenseCents = summary.expenseCents + debtMonthlyCents
  const savingsCents = summary.incomeCents - expenseCents
  return {
    incomeCents: summary.incomeCents,
    expenseCents,
    savingsCents,
    savingsRate: summary.incomeCents > 0 ? (savingsCents / summary.incomeCents) * 100 : null,
    livingAllowanceCents: summary.livingAllowanceCents - debtMonthlyCents,
  }
}

export interface CategoryTotal {
  categoryId: string
  amountCents: Cents
}

/** Total des dépenses par catégorie, trié du plus gros au plus petit poste. */
export function totalsByCategory(expenses: Expense[]): CategoryTotal[] {
  const byCategory = new Map<string, Cents>()
  for (const expense of expenses) {
    byCategory.set(expense.categoryId, (byCategory.get(expense.categoryId) ?? 0) + expense.amountCents)
  }
  return [...byCategory.entries()].map(([categoryId, amountCents]) => ({ categoryId, amountCents })).sort((a, b) => b.amountCents - a.amountCents)
}

export interface BudgetLine {
  categoryId: string
  plannedCents: Cents
  actualCents: Cents
  varianceCents: Cents
}

/** Fusionne budget prévu et dépenses réelles par catégorie (« Budget / Réel / Écart »). */
export function buildBudgetLines(plannedByCategory: Record<string, Cents>, expenses: Expense[]): BudgetLine[] {
  const actual = new Map(totalsByCategory(expenses).map((t) => [t.categoryId, t.amountCents]))
  const categoryIds = new Set([...Object.keys(plannedByCategory), ...actual.keys()])
  return [...categoryIds]
    .map((categoryId) => {
      const plannedCents = plannedByCategory[categoryId] ?? 0
      const actualCents = actual.get(categoryId) ?? 0
      return { categoryId, plannedCents, actualCents, varianceCents: actualCents - plannedCents }
    })
    .sort((a, b) => b.actualCents - a.actualCents)
}
