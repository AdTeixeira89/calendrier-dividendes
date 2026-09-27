import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Banknote, Plus } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { IncomeFormSheet } from '@/components/finance/IncomeFormSheet'
import { IncomeRow } from '@/components/finance/IncomeRow'
import { MonthNav } from '@/components/finance/MonthNav'
import { Button, Card, EmptyState, StatCard } from '@/components/ui'
import { useHousehold } from '@/hooks/useHousehold'
import { useMonthNav } from '@/hooks/useMonthNav'
import { useMonthlyIncomes } from '@/hooks/useMonthlyIncomes'
import type { Income } from '@/types'
import { currentMonthKey } from '@/utils/month'
import { sumCents } from '@/utils/monthlyStats'

export function IncomesPage() {
  const { household, canWrite } = useHousehold()
  const { month, setMonth } = useMonthNav()
  const incomes = useMonthlyIncomes(household.id, month)
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

      <IncomeFormSheet key={editing?.id ?? 'new'} open={sheetOpen} onClose={closeSheet} income={editing} defaultDate={monthDefaultDate(month)} />
    </div>
  )
}

function monthDefaultDate(month: string): string {
  return month === currentMonthKey() ? new Date().toISOString().slice(0, 10) : `${month}-01`
}
