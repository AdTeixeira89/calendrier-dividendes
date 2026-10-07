import { useMemo } from 'react'
import { householdSplit, type BudgetSplitSettings, type HouseholdSplit } from '@/utils/budgetSplit'
import type { MonthKey } from '@/utils/month'
import { useBudgetSplit } from './useBudgetSplit'
import { useGlobalBudget } from './useGlobalBudget'
import { useHousehold } from './useHousehold'
import { useCommonMonthlyExpenses } from './useMonthlyExpenses'
import { useMonthlyIncomes } from './useMonthlyIncomes'

/**
 * Suivi du budget des dépenses communes pour un mois : budget global, versements
 * de chacun, dépensé et reste (foyer et par personne). undefined pendant le chargement.
 */
export function useCommonBudget(month: MonthKey): { settings: BudgetSplitSettings; split: HouseholdSplit; overrideCents: number | null } | undefined {
  const { household, members } = useHousehold()
  const settings = useBudgetSplit(household.id)
  const override = useGlobalBudget(household.id)
  const incomes = useMonthlyIncomes(household.id, month)
  const expenses = useCommonMonthlyExpenses(household.id, month)

  return useMemo(() => {
    if (!settings || override === undefined || !incomes || !expenses) return undefined
    return { settings, overrideCents: override, split: householdSplit(members.map((m) => m.uid), settings, incomes, expenses, override) }
  }, [settings, override, incomes, expenses, members])
}
