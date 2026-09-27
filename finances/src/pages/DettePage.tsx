import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { CreditCard, Plus } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { Button, Card, EmptyState, StatCard } from '@/components/ui'
import { DebtCard } from '@/components/finance/DebtCard'
import { DebtFormSheet } from '@/components/finance/DebtFormSheet'
import { DebtReductionChart } from '@/components/finance/DebtReductionChart'
import { useDebts } from '@/hooks/useDebts'
import { useHousehold } from '@/hooks/useHousehold'
import type { Debt } from '@/types'
import { formatDate } from '@/utils/dates'
import { aggregateDebts, projectCombinedYearlyBalances } from '@/utils/debt'

export function DettePage() {
  const { household, canWrite } = useHousehold()
  const debts = useDebts(household.id)
  const [params, setParams] = useSearchParams()
  const [editing, setEditing] = useState<Debt | undefined>(undefined)
  const sheetOpen = params.has('ajouter') || Boolean(editing)

  function closeSheet() {
    setEditing(undefined)
    if (params.has('ajouter')) {
      const next = new URLSearchParams(params)
      next.delete('ajouter')
      setParams(next, { replace: true })
    }
  }

  const aggregate = debts ? aggregateDebts(debts) : null
  const projection = debts && debts.length > 0 ? projectCombinedYearlyBalances(debts, 6) : []

  return (
    <div className="stack animate-in">
      <PageHeader title="Ma dette" subtitle="Vos prêts et crédits, leur remboursement et leur fin estimée." />

      {aggregate && aggregate.totalPrincipalCents > 0 && (
        <>
          <section className="grid-cards" style={{ gridTemplateColumns: 'repeat(2, minmax(0,1fr))' }}>
            <StatCard label="Capital restant" amount={aggregate.totalOutstandingCents} tone="debt" higherIsBetter={false} />
            <StatCard label="Mensualités totales" amount={aggregate.totalMonthlyCents} tone="expense" higherIsBetter={false} />
          </section>
          <Card
            title="Vision d'ensemble"
            subtitle={
              aggregate.debtFreeDate
                ? `Désendettement estimé le ${formatDate(aggregate.debtFreeDate)}`
                : 'Renseignez les mensualités pour estimer une date'
            }
          >
            <p className="num" style={{ fontSize: 'var(--text-2xl)', fontWeight: 700 }}>
              {Math.round(aggregate.percentPaid)} % remboursé
            </p>
          </Card>
          {projection.length > 0 && (
            <Card title="Diminution de la dette" subtitle="Projection estimée, hors recalcul des intérêts">
              <DebtReductionChart points={projection} />
            </Card>
          )}
        </>
      )}

      {canWrite && (
        <Button icon={<Plus size={18} />} onClick={() => setParams((p) => new URLSearchParams({ ...Object.fromEntries(p), ajouter: '1' }))}>
          Ajouter un prêt
        </Button>
      )}

      {debts === undefined ? null : debts.length === 0 ? (
        <EmptyState icon={<CreditCard size={28} />} title="Aucun prêt enregistré" description="Prêt immobilier, travaux, consommation, automobile…" />
      ) : (
        <div className="stack">
          {debts.map((debt) => (
            <DebtCard key={debt.id} debt={debt} onClick={() => setEditing(debt)} />
          ))}
        </div>
      )}

      <DebtFormSheet key={editing?.id ?? 'new'} open={sheetOpen} onClose={closeSheet} debt={editing} />
    </div>
  )
}
