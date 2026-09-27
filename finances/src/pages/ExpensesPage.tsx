import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Plus, Receipt, Settings2 } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { BudgetSection } from '@/components/finance/BudgetSection'
import { ExpenseFormSheet } from '@/components/finance/ExpenseFormSheet'
import { MonthNav } from '@/components/finance/MonthNav'
import { ExpenseRow } from '@/components/finance/ExpenseRow'
import { Button, Card, EmptyState, StatCard } from '@/components/ui'
import { useCategories } from '@/hooks/useCategories'
import { useBudget } from '@/hooks/useBudget'
import { useHousehold } from '@/hooks/useHousehold'
import { useMonthNav } from '@/hooks/useMonthNav'
import { useMonthlyExpenses } from '@/hooks/useMonthlyExpenses'
import type { Expense } from '@/types'
import { currentMonthKey } from '@/utils/month'
import { sumCents } from '@/utils/monthlyStats'

export function ExpensesPage() {
  const { household, canWrite } = useHousehold()
  const { month, setMonth } = useMonthNav()
  const categories = useCategories(household.id, 'expense')
  const expenses = useMonthlyExpenses(household.id, month)
  const budget = useBudget(household.id, month)
  const [params, setParams] = useSearchParams()
  const [editing, setEditing] = useState<Expense | undefined>(undefined)
  const sheetOpen = params.has('ajouter') || Boolean(editing)

  function closeSheet() {
    setEditing(undefined)
    if (params.has('ajouter')) {
      const next = new URLSearchParams(params)
      next.delete('ajouter')
      setParams(next, { replace: true })
    }
  }

  const total = expenses ? sumCents(expenses) : null
  const loading = categories === undefined || expenses === undefined

  return (
    <div className="stack animate-in">
      <PageHeader
        title="Dépenses"
        action={
          <Link to="/categories">
            <Button variant="ghost" size="sm" icon={<Settings2 size={16} />}>
              Catégories
            </Button>
          </Link>
        }
      />

      <MonthNav month={month} onChange={setMonth} />

      <StatCard label="Total des dépenses" amount={total} tone="expense" icon={<Receipt size={16} />} higherIsBetter={false} />

      {canWrite && (
        <Button icon={<Plus size={18} />} onClick={() => setParams((p) => new URLSearchParams({ ...Object.fromEntries(p), ajouter: '1' }))}>
          Ajouter une dépense
        </Button>
      )}

      <Card title="Transactions" padded={expenses !== undefined && expenses.length === 0}>
        {loading ? null : expenses.length === 0 ? (
          <EmptyState icon={<Receipt size={28} />} title="Aucune dépense ce mois-ci" description="Ajoutez votre première dépense pour ce mois." />
        ) : (
          <ul className="stack" style={{ gap: 2 }}>
            {expenses.map((expense) => (
              <li key={expense.id}>
                <ExpenseRow expense={expense} category={categories?.find((c) => c.id === expense.categoryId)} onClick={() => setEditing(expense)} />
              </li>
            ))}
          </ul>
        )}
      </Card>

      {!loading && categories.length > 0 && <BudgetSection month={month} categories={categories} expenses={expenses} budget={budget} />}

      {categories !== undefined && (
        <ExpenseFormSheet key={editing?.id ?? 'new'} open={sheetOpen} onClose={closeSheet} categories={categories} expense={editing} defaultDate={monthDefaultDate(month)} />
      )}
    </div>
  )
}

function monthDefaultDate(month: string): string {
  return month === currentMonthKey() ? new Date().toISOString().slice(0, 10) : `${month}-01`
}
