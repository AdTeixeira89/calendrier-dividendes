import { useState, type FormEvent } from 'react'
import { Button, Notice, Sheet } from '@/components/ui'
import { useCurrentUser } from '@/hooks/useAuth'
import { useHousehold } from '@/hooks/useHousehold'
import { saveBudgetSplit } from '@/services/budgetSplitService'
import type { Cents } from '@/types'
import { EMPTY_PLAN, type BudgetSplitSettings, type MemberPlan } from '@/utils/budgetSplit'
import { toUserMessage } from '@/utils/firebaseErrors'
import { AmountField } from './AmountField'

interface BudgetSplitSheetProps {
  open: boolean
  onClose: () => void
  householdId: string
  settings: BudgetSplitSettings
}

type Field = keyof MemberPlan

export function BudgetSplitSheet({ open, onClose, householdId, settings }: BudgetSplitSheetProps) {
  const user = useCurrentUser()
  const { members } = useHousehold()
  const [plans, setPlans] = useState<Record<string, MemberPlan>>(() => Object.fromEntries(members.map((m) => [m.uid, settings.plans[m.uid] ?? EMPTY_PLAN])))
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  function setField(uid: string, field: Field, cents: Cents | null) {
    setPlans((prev) => ({ ...prev, [uid]: { ...(prev[uid] ?? EMPTY_PLAN), [field]: cents ?? 0 } }))
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    setError(null)
    setLoading(true)
    try {
      await saveBudgetSplit(householdId, { plans }, user)
      onClose()
    } catch (err) {
      setError(toUserMessage(err))
    } finally {
      setLoading(false)
    }
  }

  return (
    <Sheet open={open} onClose={onClose} title="Répartition des revenus">
      <form className="stack" onSubmit={onSubmit} noValidate>
        {error && <Notice tone="danger">{error}</Notice>}
        <p className="subtle" style={{ fontSize: 'var(--text-sm)' }}>
          Montants mensuels. « Versé au budget commun » est ce que chaque personne met réellement dans les dépenses du foyer ; épargne et investissement restent à part.
        </p>
        {members.map((m) => {
          const plan = plans[m.uid] ?? EMPTY_PLAN
          return (
            <fieldset key={m.uid} className="stack" style={{ border: 0, padding: 0, margin: 0 }}>
              <legend style={{ fontWeight: 600, marginBottom: 8 }}>{m.displayName}</legend>
              <AmountField label="Versé au budget commun" value={plan.commonCents || null} onChange={(c) => setField(m.uid, 'commonCents', c)} />
              <div className="row" style={{ alignItems: 'flex-start' }}>
                <AmountField label="Épargne" value={plan.savingsCents || null} onChange={(c) => setField(m.uid, 'savingsCents', c)} />
                <AmountField label="Investissement" value={plan.investCents || null} onChange={(c) => setField(m.uid, 'investCents', c)} />
              </div>
            </fieldset>
          )
        })}
        <Button type="submit" size="lg" block loading={loading}>
          Enregistrer
        </Button>
      </form>
    </Sheet>
  )
}
