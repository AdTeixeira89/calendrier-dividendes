import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { PiggyBank, Plus } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { SavingsGoalCard } from '@/components/finance/SavingsGoalCard'
import { SavingsGoalFormSheet } from '@/components/finance/SavingsGoalFormSheet'
import { Button, EmptyState, StatCard } from '@/components/ui'
import { useHousehold } from '@/hooks/useHousehold'
import { useSavingsGoals } from '@/hooks/useSavingsGoals'
import type { SavingsGoal } from '@/types'
import { sumCents } from '@/utils/monthlyStats'

export function EpargnePage() {
  const { household, canWrite } = useHousehold()
  const goals = useSavingsGoals(household.id)
  const [params, setParams] = useSearchParams()
  const [editing, setEditing] = useState<SavingsGoal | undefined>(undefined)
  const sheetOpen = params.has('ajouter') || Boolean(editing)

  function closeSheet() {
    setEditing(undefined)
    if (params.has('ajouter')) {
      const next = new URLSearchParams(params)
      next.delete('ajouter')
      setParams(next, { replace: true })
    }
  }

  const totalSaved = goals ? sumCents(goals.map((g) => ({ amountCents: g.currentCents }))) : null

  return (
    <div className="stack animate-in">
      <PageHeader title="Épargne" subtitle="Vos objectifs et leur progression." />

      <StatCard label="Total épargné" amount={totalSaved} tone="saving" icon={<PiggyBank size={16} />} footnote="Sur tous les objectifs" />

      {canWrite && (
        <Button icon={<Plus size={18} />} onClick={() => setParams((p) => new URLSearchParams({ ...Object.fromEntries(p), ajouter: '1' }))}>
          Nouvel objectif
        </Button>
      )}

      {goals === undefined ? null : goals.length === 0 ? (
        <EmptyState
          icon={<PiggyBank size={28} />}
          title="Aucun objectif pour l'instant"
          description="Épargne de sécurité, vacances, voiture, travaux… créez votre premier objectif."
        />
      ) : (
        <div className="stack">
          {goals.map((goal) => (
            <SavingsGoalCard key={goal.id} goal={goal} onClick={() => setEditing(goal)} />
          ))}
        </div>
      )}

      <SavingsGoalFormSheet key={editing?.id ?? 'new'} open={sheetOpen} onClose={closeSheet} goal={editing} />
    </div>
  )
}
