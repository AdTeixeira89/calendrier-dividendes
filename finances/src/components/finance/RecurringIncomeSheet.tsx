import { useState, type FormEvent } from 'react'
import { Ban } from 'lucide-react'
import { Button, ConfirmButton, Notice, Select, Sheet, TextField } from '@/components/ui'
import { SegmentedControl } from '@/components/ui/SegmentedControl'
import { useCurrentUser } from '@/hooks/useAuth'
import { useHousehold } from '@/hooks/useHousehold'
import { createRecurringIncome, syncCurrentIncome, updateRecurringIncome } from '@/services/recurringIncomeService'
import type { Cents, RecurringIncome, Scope } from '@/types'
import { INCOME_TYPE_LABELS, type IncomeType } from '@/types/income'
import { toUserMessage } from '@/utils/firebaseErrors'
import { currentMonthKey } from '@/utils/month'
import { AmountField } from './AmountField'

const TYPES: IncomeType[] = ['salary', 'bonus', 'overtime', 'benefits', 'rental', 'secondary', 'reimbursement', 'other']

interface RecurringIncomeSheetProps {
  open: boolean
  onClose: () => void
  /** Revenu fixe à modifier ; absent = création. */
  income?: RecurringIncome
}

export function RecurringIncomeSheet({ open, onClose, income }: RecurringIncomeSheetProps) {
  const user = useCurrentUser()
  const { household, members } = useHousehold()
  const [label, setLabel] = useState(income?.label ?? '')
  const [amountCents, setAmountCents] = useState<Cents | null>(income?.amountCents ?? null)
  const [type, setType] = useState<IncomeType>(income?.type ?? 'salary')
  const [memberId, setMemberId] = useState(income?.memberId ?? user.uid)
  const [scope, setScope] = useState<Scope>(income?.scope ?? 'personal')
  const [day, setDay] = useState(String(income?.dayOfMonth ?? 1))
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    const dayOfMonth = Number(day)
    if (amountCents === null || amountCents <= 0) return setError('Renseignez un montant.')
    if (!Number.isInteger(dayOfMonth) || dayOfMonth < 1 || dayOfMonth > 31) return setError('Le jour du versement doit être compris entre 1 et 31.')
    setError(null)
    setLoading(true)
    const data = {
      label: label.trim() || INCOME_TYPE_LABELS[type],
      amountCents,
      type,
      memberId: memberId || null,
      scope,
      dayOfMonth,
    }
    try {
      if (income) {
        await updateRecurringIncome(household.id, income.id, data, user)
        await syncCurrentIncome(household.id, { ...income, ...data }, members.map((m) => m.uid), user)
      } else {
        await createRecurringIncome(household.id, { ...data, startMonth: currentMonthKey(), archived: false }, user)
      }
      onClose()
    } catch (err) {
      setError(toUserMessage(err))
    } finally {
      setLoading(false)
    }
  }

  async function onStop() {
    if (!income) return
    setLoading(true)
    try {
      await updateRecurringIncome(household.id, income.id, { archived: true }, user)
      onClose()
    } catch (err) {
      setError(toUserMessage(err))
      setLoading(false)
    }
  }

  return (
    <Sheet open={open} onClose={onClose} title={income ? 'Modifier ce revenu fixe' : 'Nouveau revenu fixe'}>
      <form className="stack" onSubmit={onSubmit} noValidate>
        {error && <Notice tone="danger">{error}</Notice>}
        <Notice tone="info">Ce revenu est ajouté automatiquement chaque mois, au même montant. Une augmentation s'applique dès ce mois-ci ; les mois passés ne changent pas.</Notice>
        <TextField label="Libellé (facultatif)" placeholder="Ex. Salaire, pension…" maxLength={120} value={label} onChange={(e) => setLabel(e.target.value)} autoFocus={!income} />
        <div className="row" style={{ alignItems: 'flex-start' }}>
          <AmountField value={amountCents} onChange={setAmountCents} />
          <TextField label="Jour du versement" inputMode="numeric" value={day} onChange={(e) => setDay(e.target.value.replace(/\D/g, '').slice(0, 2))} />
        </div>
        <div className="row" style={{ alignItems: 'flex-start' }}>
          <Select label="Type" value={type} onChange={(e) => setType(e.target.value as IncomeType)}>
            {TYPES.map((t) => (
              <option key={t} value={t}>
                {INCOME_TYPE_LABELS[t]}
              </option>
            ))}
          </Select>
          <Select label="Reçu par" value={memberId} onChange={(e) => setMemberId(e.target.value)}>
            {members.map((m) => (
              <option key={m.uid} value={m.uid}>
                {m.displayName}
              </option>
            ))}
          </Select>
        </div>
        <SegmentedControl label="Portée" value={scope} onChange={setScope} options={[{ value: 'personal', label: 'Personnel' }, { value: 'shared', label: 'Foyer' }]} />
        <Button type="submit" size="lg" block loading={loading}>
          {income ? 'Enregistrer' : 'Ajouter le revenu fixe'}
        </Button>
        {income && (
          <ConfirmButton
            label="Arrêter ce revenu fixe"
            confirmLabel="Confirmer l'arrêt"
            icon={<Ban size={18} />}
            question={`Arrêter « ${income.label} » ? Les mois déjà enregistrés sont conservés, aucun nouveau ne sera ajouté.`}
            onConfirm={() => void onStop()}
            disabled={loading}
          />
        )}
      </form>
    </Sheet>
  )
}
