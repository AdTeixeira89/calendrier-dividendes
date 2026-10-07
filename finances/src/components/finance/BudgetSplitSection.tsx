import { useCommonBudget } from '@/hooks/useCommonBudget'
import type { MonthKey } from '@/utils/month'
import { BudgetSplitCard } from './BudgetSplitCard'

/** Répartition des revenus du mois affiché : menu déroulant de la page Revenus. */
export function BudgetSplitSection({ month }: { month: MonthKey }) {
  const budget = useCommonBudget(month)
  if (!budget) return null
  return <BudgetSplitCard settings={budget.settings} split={budget.split} />
}
