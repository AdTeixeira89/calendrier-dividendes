import { useState, type FormEvent } from 'react'
import { Receipt, Trash2 } from 'lucide-react'
import { Button, ConfirmButton, Notice, Select, Sheet, TextArea, TextField } from '@/components/ui'
import { SegmentedControl } from '@/components/ui/SegmentedControl'
import { useCurrentUser } from '@/hooks/useAuth'
import { useHousehold } from '@/hooks/useHousehold'
import { createExpense, deleteExpense, fromTimestamp, toTimestamp, updateExpense } from '@/services/expenseService'
import { skipOccurrence } from '@/services/recurringExpenseService'
import { createSubscription } from '@/services/subscriptionService'
import type { Cents, Category, Expense, PaymentMethod, Scope } from '@/types'
import { EXPENSE_KIND_LABELS, PAYMENT_METHOD_LABELS, type ExpenseKind } from '@/types/expense'
import { toUserMessage } from '@/utils/firebaseErrors'
import { monthKey, shiftMonth } from '@/utils/month'
import { CategoryPicker } from './CategoryPicker'
import { AmountField } from './AmountField'
import { ToggleRow } from './ToggleRow'

/** Pré-remplissage initial (ex. issu du scanner de tickets), ignoré si `expense` est fourni. */
export interface ExpenseFormInitial {
  amountCents?: Cents
  date?: string
  merchant?: string
  receiptPath?: string
}

interface ExpenseFormSheetProps {
  open: boolean
  onClose: () => void
  categories: Category[]
  /** Dépense à modifier ; absent = création. */
  expense?: Expense
  defaultDate: string
  initial?: ExpenseFormInitial
}

const PAYMENT_METHODS: PaymentMethod[] = ['card', 'transfer', 'cash', 'check', 'direct_debit', 'other']
const KINDS: ExpenseKind[] = ['one_off', 'recurring', 'exceptional']

export function ExpenseFormSheet({ open, onClose, categories, expense, defaultDate, initial }: ExpenseFormSheetProps) {
  const user = useCurrentUser()
  const { household, members } = useHousehold()
  const [amountCents, setAmountCents] = useState<Cents | null>(expense?.amountCents ?? initial?.amountCents ?? null)
  const [date, setDate] = useState(expense ? fromTimestamp(expense.date) : (initial?.date ?? defaultDate))
  const [categoryId, setCategoryId] = useState(expense?.categoryId ?? '')
  const [merchant, setMerchant] = useState(expense?.merchant ?? initial?.merchant ?? '')
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>(expense?.paymentMethod ?? 'card')
  const [memberId, setMemberId] = useState(expense?.memberId ?? user.uid)
  const [scope, setScope] = useState<Scope>(expense?.scope ?? 'shared')
  const [kind, setKind] = useState<ExpenseKind>(expense?.kind ?? 'one_off')
  const [note, setNote] = useState(expense?.note ?? '')
  const [fixedMonthly, setFixedMonthly] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const receiptPath = expense?.receiptPath ?? initial?.receiptPath ?? null

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    if (amountCents === null || amountCents <= 0 || !categoryId) return setError('Renseignez un montant et une catégorie.')
    if (fixedMonthly && !merchant.trim()) return setError('Donnez un nom à cette charge fixe, par exemple « Eau ».')
    setError(null)
    setLoading(true)
    const data = {
      amountCents,
      date: toTimestamp(date),
      categoryId,
      merchant: merchant.trim() || null,
      paymentMethod,
      memberId: memberId || null,
      scope,
      kind: fixedMonthly ? ('recurring' as ExpenseKind) : kind,
      note: note.trim() || null,
      receiptPath,
    }
    try {
      if (expense) await updateExpense(household.id, expense.id, data, user)
      else if (fixedMonthly) {
        // La dépense saisie couvre son propre mois ; la charge fixe prend le relais dès le mois suivant.
        const subscriptionId = await createSubscription(
          household.id,
          {
            name: merchant.trim(),
            amountCents,
            period: 'monthly',
            categoryId,
            nextDate: data.date,
            usage: null,
            archived: false,
            autoExpense: true,
            startMonth: shiftMonth(monthKey(data.date.toDate()), 1),
          },
          user,
        )
        await createExpense(household.id, { ...data, recurrenceId: subscriptionId }, user)
      } else await createExpense(household.id, data, user)
      onClose()
    } catch (err) {
      setError(toUserMessage(err))
    } finally {
      setLoading(false)
    }
  }

  async function onDelete() {
    if (!expense) return
    setLoading(true)
    try {
      if (expense.recurrenceId) await skipOccurrence(household.id, expense.id, expense.recurrenceId, user)
      await deleteExpense(household.id, expense.id, user)
      onClose()
    } catch (err) {
      setError(toUserMessage(err))
      setLoading(false)
    }
  }

  return (
    <Sheet open={open} onClose={onClose} title={expense ? 'Modifier la dépense' : 'Nouvelle dépense'}>
      <form className="stack" onSubmit={onSubmit} noValidate>
        {error && <Notice tone="danger">{error}</Notice>}
        <div className="row" style={{ alignItems: 'flex-start' }}>
          <AmountField value={amountCents} onChange={setAmountCents} autoFocus={!expense} />
          <TextField label="Date" type="date" required value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
        {receiptPath && (
          <Notice tone="info">
            <span className="row" style={{ gap: 6 }}>
              <Receipt size={16} aria-hidden /> Ticket scanné joint à cette dépense.
            </span>
          </Notice>
        )}
        {expense?.recurrenceId && (
          <Notice tone="info">
            Dépense ajoutée automatiquement chaque mois. Cette modification ne change que ce mois-ci ; pour les mois suivants, modifiez la charge dans
            Abonnements et charges fixes.
          </Notice>
        )}
        <CategoryPicker categories={categories} value={categoryId} onChange={setCategoryId} />
        <TextField
          label={fixedMonthly ? 'Nom de la charge fixe' : 'Commerçant (facultatif)'}
          placeholder={fixedMonthly ? 'Ex. Eau, assurance habitation…' : undefined}
          maxLength={120}
          value={merchant}
          onChange={(e) => setMerchant(e.target.value)}
        />
        {!expense && (
          <ToggleRow
            label="Même montant chaque mois"
            description="Eau, assurance, loyer… ajoutée automatiquement aux dépenses de chaque mois, même si la consommation varie."
            checked={fixedMonthly}
            onChange={setFixedMonthly}
          />
        )}
        <div className="row" style={{ alignItems: 'flex-start' }}>
          <Select label="Moyen de paiement" value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value as PaymentMethod)}>
            {PAYMENT_METHODS.map((m) => (
              <option key={m} value={m}>
                {PAYMENT_METHOD_LABELS[m]}
              </option>
            ))}
          </Select>
          <Select label="Ajoutée par" value={memberId} onChange={(e) => setMemberId(e.target.value)}>
            {members.map((m) => (
              <option key={m.uid} value={m.uid}>
                {m.displayName}
              </option>
            ))}
          </Select>
        </div>
        <SegmentedControl label="Portée" value={scope} onChange={setScope} options={[{ value: 'shared', label: 'Commune' }, { value: 'personal', label: 'Personnelle' }]} />
        {!fixedMonthly && <SegmentedControl label="Type" value={kind} onChange={setKind} options={KINDS.map((k) => ({ value: k, label: EXPENSE_KIND_LABELS[k] }))} />}
        <TextArea label="Commentaire (facultatif)" maxLength={280} value={note} onChange={(e) => setNote(e.target.value)} />
        <div className="row">
          <Button type="submit" size="lg" block loading={loading}>
            {expense ? 'Enregistrer' : 'Ajouter la dépense'}
          </Button>
        </div>
        {expense && (
          <ConfirmButton label="Supprimer" icon={<Trash2 size={18} />} question="Supprimer cette dépense ?" onConfirm={() => void onDelete()} disabled={loading} />
        )}
      </form>
    </Sheet>
  )
}
