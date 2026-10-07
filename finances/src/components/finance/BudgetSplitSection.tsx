import { useCommonBudget } from '@/hooks/useCommonBudget'
import { currentBudgetMonthKey } from '@/utils/budgetMonth'
import { currentMonthKey, type MonthKey } from '@/utils/month'
import { BudgetSplitCard } from './BudgetSplitCard'

/** Répartition des revenus du mois affiché : menu déroulant de la page Revenus. */
export function BudgetSplitSection({ month }: { month: MonthKey }) {
  // Mois civil courant de la page Revenus → mois budgétaire en cours (du 1er au 5, encore le précédent).
  const budget = useCommonBudget(month === currentMonthKey() ? currentBudgetMonthKey() : month)
  if (!budget) return null
  return <BudgetSplitCard settings={budget.settings} split={budget.split} />
}
