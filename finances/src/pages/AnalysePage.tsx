import { PageHeader } from '@/components/layout/PageHeader'
import { CategoryBreakdownChart } from '@/components/finance/CategoryBreakdownChart'
import { MonthNav } from '@/components/finance/MonthNav'
import { TrendChart } from '@/components/finance/TrendChart'
import { Card, StatCard } from '@/components/ui'
import { useCategories } from '@/hooks/useCategories'
import { useHousehold } from '@/hooks/useHousehold'
import { useMonthNav } from '@/hooks/useMonthNav'
import { useCommonBudget } from '@/hooks/useCommonBudget'
import { useCommonMonthlyExpenses } from '@/hooks/useMonthlyExpenses'
import { useTrend } from '@/hooks/useTrend'
import { formatPercent } from '@/utils/money'

export function AnalysePage() {
  const { household } = useHousehold()
  const { month, setMonth } = useMonthNav('budget')
  const categories = useCategories(household.id, 'expense')
  const expenses = useCommonMonthlyExpenses(household.id, month)
  const trend = useTrend(household.id, month, 6)
  const commonBudget = useCommonBudget(month)
  const hasBudget = Boolean(commonBudget && commonBudget.split.budgetCents > 0)
  // Épargne = ce qui est réellement mis de côté (épargne + investissement prévus), jamais « revenus − dépenses ».
  const savingsRate = commonBudget && commonBudget.split.incomeCents > 0 && commonBudget.split.savingsCents + commonBudget.split.investCents > 0 ? ((commonBudget.split.savingsCents + commonBudget.split.investCents) / commonBudget.split.incomeCents) * 100 : null


  return (
    <div className="stack animate-in">
      <PageHeader title="Analyse" subtitle="La répartition et l'évolution de vos finances." />
      <MonthNav month={month} onChange={setMonth} kind="budget" />

      <section className="grid-cards" style={{ gridTemplateColumns: 'repeat(2, minmax(0,1fr))' }}>
        <StatCard
          label="Taux d'épargne"
          amount={null}
          displayValue={savingsRate === null ? '—' : formatPercent(savingsRate)}
          tone="saving"
          footnote={savingsRate === null ? 'Réglez la répartition des revenus' : 'Épargne et investissement prévus / revenus'}
        />
        <StatCard
          label="Reste à vivre"
          amount={hasBudget ? commonBudget!.split.commonRemainingCents : null}
          tone="accent"
          footnote={hasBudget ? 'Reste du budget des dépenses communes' : 'Définissez le budget commun'}
        />
      </section>

      <Card title="Dépenses par catégorie">
        {categories && expenses ? <CategoryBreakdownChart expenses={expenses} categories={categories} /> : null}
      </Card>

      <Card title="Revenus vs dépenses" subtitle="6 derniers mois">
        {trend ? <TrendChart points={trend} /> : null}
      </Card>
    </div>
  )
}
