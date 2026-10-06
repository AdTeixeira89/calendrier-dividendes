import { evaluateAlerts, type FinancialAlert } from '@shared/alerts'
import { aggregateDebts } from '@/utils/debt'
import { currentMonthKey, previousMonthKey } from '@/utils/month'
import { useAlertSettings } from './useAlertSettings'
import { useBudget } from './useBudget'
import { useCategories } from './useCategories'
import { useDebts } from './useDebts'
import { useCommonMonthlyExpenses } from './useMonthlyExpenses'
import { useMonthlyIncomes } from './useMonthlyIncomes'
import { useSubscriptions } from './useSubscriptions'

const sum = (items: { amountCents: number }[]) => items.reduce((total, i) => total + i.amountCents, 0)

/**
 * Alertes du mois en cours, recalculées en direct à chaque saisie. Mêmes
 * règles que les notifications push envoyées par la Cloud Function.
 */
export function useFinancialAlerts(householdId: string): FinancialAlert[] | undefined {
  const month = currentMonthKey()
  const prevMonth = previousMonthKey(month)
  const settings = useAlertSettings(householdId)
  const expenses = useCommonMonthlyExpenses(householdId, month)
  const incomes = useMonthlyIncomes(householdId, month)
  const prevExpenses = useCommonMonthlyExpenses(householdId, prevMonth)
  const prevIncomes = useMonthlyIncomes(householdId, prevMonth)
  const budget = useBudget(householdId, month)
  const categories = useCategories(householdId)
  const subscriptions = useSubscriptions(householdId)
  const debts = useDebts(householdId)

  if (!settings || !expenses || !incomes || !prevExpenses || !prevIncomes || budget === undefined || !categories || !subscriptions || !debts) {
    return undefined
  }

  return evaluateAlerts({
    today: new Date(),
    month,
    expenses: expenses.map((e) => ({ amountCents: e.amountCents, categoryId: e.categoryId })),
    incomeCents: sum(incomes),
    debtMonthlyCents: aggregateDebts(debts).totalMonthlyCents,
    budgetLines: budget?.lines ?? {},
    categoryNames: Object.fromEntries(categories.map((c) => [c.id, c.name])),
    subscriptions: subscriptions.map((s) => ({ id: s.id, name: s.name, amountCents: s.amountCents, period: s.period, nextDate: s.nextDate?.toDate() ?? null, archived: s.archived })),
    previousMonth: { month: prevMonth, incomeCents: sum(prevIncomes), expenseCents: sum(prevExpenses) },
    settings,
  })
}
