import { useState, type FormEvent } from 'react'
import { Trash2 } from 'lucide-react'
import { Button, ConfirmButton, Notice, Select, Sheet, TextField } from '@/components/ui'
import { useCurrentUser } from '@/hooks/useAuth'
import { useHousehold } from '@/hooks/useHousehold'
import { createDebt, deleteDebt, updateDebt } from '@/services/debtService'
import { fromTimestamp, toTimestamp } from '@/services/expenseService'
import type { Debt } from '@/types'
import { DEBT_TYPE_LABELS, type DebtType } from '@/types/debt'
import { toUserMessage } from '@/utils/firebaseErrors'

const TYPES: DebtType[] = ['mortgage', 'works', 'consumer', 'car', 'personal', 'other']

const toCents = (v: string) => Math.round(Number(v.replace(',', '.') || '0') * 100)
const toDisplay = (cents: number) => (cents ? String(cents / 100) : '')

interface DebtFormSheetProps {
  open: boolean
  onClose: () => void
  debt?: Debt
}

export function DebtFormSheet({ open, onClose, debt }: DebtFormSheetProps) {
  const user = useCurrentUser()
  const { household } = useHousehold()
  const [name, setName] = useState(debt?.name ?? '')
  const [type, setType] = useState<DebtType>(debt?.type ?? 'mortgage')
  const [lender, setLender] = useState(debt?.lender ?? '')
  const [contractNumber, setContractNumber] = useState(debt?.contractNumber ?? '')
  const [principal, setPrincipal] = useState(debt ? toDisplay(debt.principalCents) : '')
  const [outstanding, setOutstanding] = useState(debt ? toDisplay(debt.outstandingCents) : '')
  const [annualRate, setAnnualRate] = useState(debt?.annualRate?.toString() ?? '')
  const [startDate, setStartDate] = useState(debt ? fromTimestamp(debt.startDate) : new Date().toISOString().slice(0, 10))
  const [termMonths, setTermMonths] = useState(debt?.termMonths?.toString() ?? '')
  const [monthlyPayment, setMonthlyPayment] = useState(debt ? toDisplay(debt.monthlyPaymentCents) : '')
  const [insurance, setInsurance] = useState(debt ? toDisplay(debt.insuranceCents) : '0')
  const [fees, setFees] = useState(debt ? toDisplay(debt.feesCents) : '0')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    if (!name.trim() || !principal || !outstanding) return setError('Renseignez au moins le nom, le montant initial et le capital restant.')
    setError(null)
    setLoading(true)
    const data = {
      type,
      name: name.trim(),
      lender: lender.trim() || null,
      contractNumber: contractNumber.trim() || null,
      principalCents: toCents(principal),
      outstandingCents: toCents(outstanding),
      annualRate: annualRate ? Number(annualRate.replace(',', '.')) : null,
      startDate: toTimestamp(startDate),
      termMonths: termMonths ? Math.round(Number(termMonths)) : null,
      monthlyPaymentCents: toCents(monthlyPayment),
      insuranceCents: toCents(insurance),
      feesCents: toCents(fees),
      archived: false,
    }
    try {
      if (debt) await updateDebt(household.id, debt.id, data, user)
      else await createDebt(household.id, data, user)
      onClose()
    } catch (err) {
      setError(toUserMessage(err))
    } finally {
      setLoading(false)
    }
  }

  async function onDelete() {
    if (!debt) return
    setLoading(true)
    try {
      await deleteDebt(household.id, debt.id, user)
      onClose()
    } catch (err) {
      setError(toUserMessage(err))
      setLoading(false)
    }
  }

  return (
    <Sheet open={open} onClose={onClose} title={debt ? 'Modifier le prêt' : 'Nouveau prêt / crédit'}>
      <form className="stack" onSubmit={onSubmit} noValidate>
        {error && <Notice tone="danger">{error}</Notice>}
        <TextField label="Nom" placeholder="Ex. Prêt maison, Voiture…" maxLength={80} value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        <Select label="Type" value={type} onChange={(e) => setType(e.target.value as DebtType)}>
          {TYPES.map((t) => (
            <option key={t} value={t}>
              {DEBT_TYPE_LABELS[t]}
            </option>
          ))}
        </Select>
        <div className="row" style={{ alignItems: 'flex-start' }}>
          <TextField label="Organisme (facultatif)" maxLength={80} value={lender} onChange={(e) => setLender(e.target.value)} />
          <TextField label="N° de contrat (facultatif)" maxLength={60} value={contractNumber} onChange={(e) => setContractNumber(e.target.value)} />
        </div>
        <div className="row" style={{ alignItems: 'flex-start' }}>
          <TextField label="Montant initial" inputMode="decimal" required value={principal} onChange={(e) => setPrincipal(e.target.value)} trailing={<span className="subtle">€</span>} />
          <TextField label="Capital restant dû" inputMode="decimal" required value={outstanding} onChange={(e) => setOutstanding(e.target.value)} trailing={<span className="subtle">€</span>} />
        </div>
        <div className="row" style={{ alignItems: 'flex-start' }}>
          <TextField label="Taux annuel (facultatif)" inputMode="decimal" value={annualRate} onChange={(e) => setAnnualRate(e.target.value)} trailing={<span className="subtle">%</span>} />
          <TextField label="Durée initiale, en mois (facultatif)" inputMode="numeric" value={termMonths} onChange={(e) => setTermMonths(e.target.value)} />
        </div>
        <TextField label="Date de début" type="date" required value={startDate} onChange={(e) => setStartDate(e.target.value)} hint="Le jour de cette date est celui de chaque mensualité : elle est inscrite dans vos dépenses ce jour-là, chaque mois." />
        <div className="row" style={{ alignItems: 'flex-start' }}>
          <TextField
            label="Mensualité (hors assurance)"
            inputMode="decimal"
            value={monthlyPayment}
            onChange={(e) => setMonthlyPayment(e.target.value)}
            trailing={<span className="subtle">€</span>}
            hint="Laissez vide si inconnue pour l'instant"
          />
          <TextField label="Assurance / mois" inputMode="decimal" value={insurance} onChange={(e) => setInsurance(e.target.value)} trailing={<span className="subtle">€</span>} />
        </div>
        <TextField label="Frais éventuels (facultatif)" inputMode="decimal" value={fees} onChange={(e) => setFees(e.target.value)} trailing={<span className="subtle">€</span>} />
        <Button type="submit" size="lg" block loading={loading}>
          {debt ? 'Enregistrer' : 'Ajouter le prêt'}
        </Button>
        {debt && (
          <ConfirmButton label="Supprimer" icon={<Trash2 size={18} />} question={`Supprimer « ${debt.name} » ?`} onConfirm={() => void onDelete()} disabled={loading} />
        )}
      </form>
    </Sheet>
  )
}
