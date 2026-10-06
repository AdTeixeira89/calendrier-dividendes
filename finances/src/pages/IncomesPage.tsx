import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Banknote, Plus, Repeat } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { IncomeFormSheet } from '@/components/finance/IncomeFormSheet'
import { BudgetSplitSection } from '@/components/finance/BudgetSplitSection'
import { CategoryIcon } from '@/components/finance/CategoryIcon'
import { IncomeRow } from '@/components/finance/IncomeRow'
import rowStyles from '@/components/finance/TransactionRow.module.css'
import { MonthNav } from '@/components/finance/MonthNav'
import { RecurringIncomeSheet } from '@/components/finance/RecurringIncomeSheet'
import { Button, Card, EmptyState, StatCard } from '@/components/ui'
import { useHousehold } from '@/hooks/useHousehold'
import { useMonthNav } from '@/hooks/useMonthNav'
import { useMonthlyIncomes } from '@/hooks/useMonthlyIncomes'
import { useRecurringIncomes } from '@/hooks/useRecurringIncomes'
import type { Income, RecurringIncome } from '@/types'
import { INCOME_TYPE_LABELS } from '@/types/income'
import { formatCents } from '@/utils/money'
import { currentMonthKey } from '@/utils/month'
import { sumCents } from '@/utils/monthlyStats'

export function IncomesPage() {
  const { household, members, canWrite } = useHousehold()
  const { month, setMonth } = useMonthNav()
  const incomes = useMonthlyIncomes(household.id, month)
  const fixed = useRecurringIncomes(household.id)?.filter((r) => !r.archived)
  const [editingFixed, setEditingFixed] = useState<RecurringIncome | 'new' | undefined>(undefined)
  const [params, setParams] = useSearchParams()
  const [editing, setEditing] = useState<Income | undefined>(undefined)
  const sheetOpen = params.has('ajouter') || Boolean(editing)

  function closeSheet() {
    setEditing(undefined)
    if (params.has('ajouter')) {
      const next = new URLSearchParams(params)
      next.delete('ajouter')
      setParams(next, { replace: true })
    }
  }

  const total = incomes ? sumCents(incomes) : null

  return (
    <div className="stack animate-in">
      <PageHeader title="Revenus" />
      <MonthNav month={month} onChange={setMonth} />
      <StatCard label="Total des revenus" amount={total} tone="income" icon={<Banknote size={16} />} />

      {canWrite && (
        <Button icon={<Plus size={18} />} onClick={() => setParams((p) => new URLSearchParams({ ...Object.fromEntries(p), ajouter: '1' }))}>
          Ajouter un revenu
        </Button>
      )}

      <BudgetSplitSection month={month} incomes={incomes} />

      <Card title="Revenus du mois" padded={incomes !== undefined && incomes.length === 0}>
        {incomes === undefined ? null : incomes.length === 0 ? (
          <EmptyState icon={<Banknote size={28} />} title="Aucun revenu ce mois-ci" description="Ajoutez salaires, primes ou autres revenus." />
        ) : (
          <ul className="stack" style={{ gap: 2 }}>
            {incomes.map((income) => (
              <li key={income.id}>
                <IncomeRow income={income} onClick={() => setEditing(income)} />
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card
        title="Revenus fixes"
        subtitle="Ajoutés automatiquement chaque mois, au même montant."
        padded={fixed !== undefined && fixed.length === 0}
        action={
          canWrite ? (
            <Button size="sm" variant="secondary" icon={<Plus size={16} />} onClick={() => setEditingFixed('new')}>
              Ajouter
            </Button>
          ) : undefined
        }
      >
        {fixed === undefined ? null : fixed.length === 0 ? (
          <EmptyState icon={<Repeat size={28} />} title="Aucun revenu fixe" description="Même salaire chaque mois ? Ajoutez-le une fois, il se remplira tout seul." />
        ) : (
          <ul className="stack" style={{ gap: 2 }}>
            {fixed.map((r) => (
              <li key={r.id}>
                <button type="button" className={rowStyles.row} onClick={() => canWrite && setEditingFixed(r)}>
                  <CategoryIcon icon="banknote" color="income" />
                  <span className={rowStyles.info}>
                    <strong>{r.label}</strong>
                    <span className="subtle">
                      {INCOME_TYPE_LABELS[r.type]} · le {r.dayOfMonth} de chaque mois
                      {r.memberId && ` · ${members.find((m) => m.uid === r.memberId)?.displayName ?? ''}`}
                    </span>
                  </span>
                  <span className={`${rowStyles.amount} num`} style={{ color: 'var(--income)' }}>
                    +{formatCents(r.amountCents)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <RecurringIncomeSheet key={editingFixed === 'new' ? 'new' : (editingFixed?.id ?? 'none')} open={editingFixed !== undefined} onClose={() => setEditingFixed(undefined)} income={editingFixed === 'new' ? undefined : editingFixed} />

      <IncomeFormSheet key={editing?.id ?? 'new'} open={sheetOpen} onClose={closeSheet} income={editing} defaultDate={monthDefaultDate(month)} />
    </div>
  )
}

function monthDefaultDate(month: string): string {
  return month === currentMonthKey() ? new Date().toISOString().slice(0, 10) : `${month}-01`
}
