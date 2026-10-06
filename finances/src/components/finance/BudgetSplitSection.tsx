import { useBudgetSplit } from '@/hooks/useBudgetSplit'
import { useDebts } from '@/hooks/useDebts'
import { useHousehold } from '@/hooks/useHousehold'
import { useCommonMonthlyExpenses } from '@/hooks/useMonthlyExpenses'
import type { Income } from '@/types'
import { householdSplit } from '@/utils/budgetSplit'
import { aggregateDebts } from '@/utils/debt'
import type { MonthKey } from '@/utils/month'
import { BudgetSplitCard } from './BudgetSplitCard'

/** Répartition des revenus du mois affiché : menu déroulant de la page Revenus. */
export function BudgetSplitSection({ month, incomes }: { month: MonthKey; incomes: Income[] | undefined }) {
  const { household, members } = useHousehold()
  const settings = useBudgetSplit(household.id)
  const expenses = useCommonMonthlyExpenses(household.id, month)
  const debts = useDebts(household.id)
  if (!settings || !incomes || !expenses) return null
  const debtMonthlyCents = debts ? aggregateDebts(debts).totalMonthlyCents : 0
  return <BudgetSplitCard settings={settings} split={householdSplit(members.map((m) => m.uid), settings, incomes, expenses, debtMonthlyCents)} />
}
