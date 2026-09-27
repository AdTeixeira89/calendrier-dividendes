import { useState, type FormEvent } from 'react'
import { Trash2 } from 'lucide-react'
import { Button, ConfirmButton, Notice, Select, Sheet, TextArea, TextField } from '@/components/ui'
import { SegmentedControl } from '@/components/ui/SegmentedControl'
import { useCurrentUser } from '@/hooks/useAuth'
import { useHousehold } from '@/hooks/useHousehold'
import { fromTimestamp, toTimestamp } from '@/services/expenseService'
import { createIncome, deleteIncome, updateIncome } from '@/services/incomeService'
import type { Cents, Income, Scope } from '@/types'
import { INCOME_FREQUENCY_LABELS, INCOME_TYPE_LABELS, type IncomeFrequency, type IncomeType } from '@/types/income'
import { toUserMessage } from '@/utils/firebaseErrors'
import { AmountField } from './AmountField'

interface IncomeFormSheetProps {
  open: boolean
  onClose: () => void
  income?: Income
  defaultDate: string
}

const TYPES: IncomeType[] = ['salary', 'bonus', 'overtime', 'benefits', 'rental', 'secondary', 'reimbursement', 'other']
const FREQUENCIES: IncomeFrequency[] = ['monthly', 'yearly', 'one_off']

export function IncomeFormSheet({ open, onClose, income, defaultDate }: IncomeFormSheetProps) {
  const user = useCurrentUser()
  const { household, members } = useHousehold()
  const [amountCents, setAmountCents] = useState<Cents | null>(income?.amountCents ?? null)
  const [date, setDate] = useState(income ? fromTimestamp(income.date) : defaultDate)
  const [type, setType] = useState<IncomeType>(income?.type ?? 'salary')
  const [label, setLabel] = useState(income?.label ?? '')
  const [memberId, setMemberId] = useState(income?.memberId ?? user.uid)
  const [scope, setScope] = useState<Scope>(income?.scope ?? 'personal')
  const [frequency, setFrequency] = useState<IncomeFrequency>(income?.frequency ?? 'monthly')
  const [note, setNote] = useState(income?.note ?? '')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    if (amountCents === null || amountCents <= 0) return setError('Renseignez un montant.')
    setError(null)
    setLoading(true)
    const data = {
      amountCents,
      date: toTimestamp(date),
      type,
      label: label.trim() || null,
      memberId: memberId || null,
      scope,
      frequency,
      note: note.trim() || null,
    }
    try {
      if (income) await updateIncome(household.id, income.id, data, user)
      else await createIncome(household.id, data, user)
      onClose()
    } catch (err) {
      setError(toUserMessage(err))
    } finally {
      setLoading(false)
    }
  }

  async function onDelete() {
    if (!income) return
    setLoading(true)
    try {
      await deleteIncome(household.id, income.id, user)
      onClose()
    } catch (err) {
      setError(toUserMessage(err))
      setLoading(false)
    }
  }

  return (
    <Sheet open={open} onClose={onClose} title={income ? 'Modifier le revenu' : 'Nouveau revenu'}>
      <form className="stack" onSubmit={onSubmit} noValidate>
        {error && <Notice tone="danger">{error}</Notice>}
        <div className="row" style={{ alignItems: 'flex-start' }}>
          <AmountField value={amountCents} onChange={setAmountCents} autoFocus={!income} />
          <TextField label="Date" type="date" required value={date} onChange={(e) => setDate(e.target.value)} />
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
        <TextField label="Libellé (facultatif)" placeholder="Ex. Employeur, locataire…" maxLength={120} value={label} onChange={(e) => setLabel(e.target.value)} />
        <SegmentedControl label="Fréquence" value={frequency} onChange={setFrequency} options={FREQUENCIES.map((f) => ({ value: f, label: INCOME_FREQUENCY_LABELS[f] }))} />
        <SegmentedControl label="Portée" value={scope} onChange={setScope} options={[{ value: 'personal', label: 'Personnel' }, { value: 'shared', label: 'Foyer' }]} />
        <TextArea label="Commentaire (facultatif)" maxLength={280} value={note} onChange={(e) => setNote(e.target.value)} />
        <Button type="submit" size="lg" block loading={loading}>
          {income ? 'Enregistrer' : 'Ajouter le revenu'}
        </Button>
        {income && (
          <ConfirmButton label="Supprimer" icon={<Trash2 size={18} />} question="Supprimer ce revenu ?" onConfirm={() => void onDelete()} disabled={loading} />
        )}
      </form>
    </Sheet>
  )
}
