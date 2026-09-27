import { PageHeader } from '@/components/layout/PageHeader'
import { CategoryBreakdownChart } from '@/components/finance/CategoryBreakdownChart'
import { MonthNav } from '@/components/finance/MonthNav'
import { TrendChart } from '@/components/finance/TrendChart'
import { Card, StatCard } from '@/components/ui'
import { useCategories } from '@/hooks/useCategories'
import { useDebts } from '@/hooks/useDebts'
import { useHousehold } from '@/hooks/useHousehold'
import { useMonthNav } from '@/hooks/useMonthNav'
import { useMonthlyExpenses } from '@/hooks/useMonthlyExpenses'
import { useMonthlyIncomes } from '@/hooks/useMonthlyIncomes'
import { useTrend } from '@/hooks/useTrend'
import { aggregateDebts } from '@/utils/debt'
import { formatPercent, percentChange } from '@/utils/money'
import { previousMonthKey } from '@/utils/month'
import { summarizeMonth, withDebtCharges } from '@/utils/monthlyStats'

export function AnalysePage() {
  const { household } = useHousehold()
  const { month, setMonth } = useMonthNav()
  const categories = useCategories(household.id, 'expense')
  const expenses = useMonthlyExpenses(household.id, month)
  const incomes = useMonthlyIncomes(household.id, month)
  const prevExpenses = useMonthlyExpenses(household.id, previousMonthKey(month))
  const prevIncomes = useMonthlyIncomes(household.id, previousMonthKey(month))
  const trend = useTrend(household.id, month, 6)
  const debts = useDebts(household.id)

  const debtMonthlyCents = debts ? aggregateDebts(debts).totalMonthlyCents : 0
  const summary = expenses && incomes ? withDebtCharges(summarizeMonth(expenses, incomes), debtMonthlyCents) : null
  const prevSummary = prevExpenses && prevIncomes ? withDebtCharges(summarizeMonth(prevExpenses, prevIncomes), debtMonthlyCents) : null

  return (
    <div className="stack animate-in">
      <PageHeader title="Analyse" subtitle="La répartition et l'évolution de vos finances." />
      <MonthNav month={month} onChange={setMonth} />

      <section className="grid-cards" style={{ gridTemplateColumns: 'repeat(2, minmax(0,1fr))' }}>
        <StatCard
          label="Taux d'épargne"
          amount={null}
          displayValue={summary?.savingsRate !== null && summary?.savingsRate !== undefined ? formatPercent(summary.savingsRate) : '—'}
          tone="saving"
          footnote={summary?.savingsRate === null || summary?.savingsRate === undefined ? 'Aucun revenu ce mois-ci' : undefined}
        />
        <StatCard
          label="Reste à vivre"
          amount={summary?.livingAllowanceCents ?? null}
          tone="accent"
          change={summary && prevSummary ? percentChange(summary.livingAllowanceCents, prevSummary.livingAllowanceCents) : null}
          footnote="Après charges fixes et mensualités de prêts"
        />
      </section>

      <Card title="Dépenses par catégorie">
        {categories && expenses ? <CategoryBreakdownChart expenses={expenses} categories={categories} debtMonthlyCents={debtMonthlyCents} /> : null}
      </Card>

      <Card title="Revenus vs dépenses" subtitle="6 derniers mois">
        {trend ? <TrendChart points={trend} /> : null}
      </Card>
    </div>
  )
}
