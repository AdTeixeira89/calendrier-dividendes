import { useState, type FormEvent } from 'react'
import { Receipt, Trash2 } from 'lucide-react'
import { Button, ConfirmButton, Notice, Select, Sheet, TextArea, TextField } from '@/components/ui'
import { SegmentedControl } from '@/components/ui/SegmentedControl'
import { useCurrentUser } from '@/hooks/useAuth'
import { useHousehold } from '@/hooks/useHousehold'
import { createExpense, deleteExpense, fromTimestamp, toTimestamp, updateExpense } from '@/services/expenseService'
import { skipOccurrence } from '@/services/recurringExpenseService'
import { createSubscription } from '@/services/subscriptionService'
import type { Cents, Category, Expense, PaymentMethod } from '@/types'
import { EXPENSE_KIND_LABELS, PAYMENT_METHOD_LABELS, type ExpenseKind } from '@/types/expense'
import { toUserMessage } from '@/utils/firebaseErrors'
import { monthKey, shiftMonth } from '@/utils/month'
import { COMMON_SPACE, expenseSpace, spaceFields, type Space } from '@/utils/spaces'
import { CategoryPicker } from './CategoryPicker'
import { AmountField } from './AmountField'
import { NewCategoryInline } from './NewCategoryInline'
import { SpaceFields, type Privacy } from './SpaceFields'
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
  /** Espace proposé à la création : celui affiché sur la page. */
  defaultSpace?: Space
  initial?: ExpenseFormInitial
}

const PAYMENT_METHODS: PaymentMethod[] = ['card', 'transfer', 'cash', 'check', 'direct_debit', 'other']
const KINDS: ExpenseKind[] = ['one_off', 'recurring', 'exceptional']

export function ExpenseFormSheet({ open, onClose, categories, expense, defaultDate, defaultSpace, initial }: ExpenseFormSheetProps) {
  const user = useCurrentUser()
  const { household } = useHousehold()
  const [amountCents, setAmountCents] = useState<Cents | null>(expense?.amountCents ?? initial?.amountCents ?? null)
  const [date, setDate] = useState(expense ? fromTimestamp(expense.date) : (initial?.date ?? defaultDate))
  const [categoryId, setCategoryId] = useState(expense?.categoryId ?? '')
  const [merchant, setMerchant] = useState(expense?.merchant ?? initial?.merchant ?? '')
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>(expense?.paymentMethod ?? 'card')
  const [space, setSpace] = useState<Space>(expense ? expenseSpace(expense) : (defaultSpace ?? COMMON_SPACE))
  const [privacy, setPrivacy] = useState<Privacy>(expense?.private ? 'private' : 'visible')
  const [kind, setKind] = useState<ExpenseKind>(expense?.kind ?? 'one_off')
  const [note, setNote] = useState(expense?.note ?? '')
  const [fixedMonthly, setFixedMonthly] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const receiptPath = expense?.receiptPath ?? initial?.receiptPath ?? null
  const privateNow = space === user.uid && privacy === 'private'
  // Une règle automatique est visible du foyer : pas pour une dépense privée.
  const ruleMode = fixedMonthly && !privateNow

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    if (amountCents === null || amountCents <= 0 || !categoryId) return setError('Renseignez un montant et une catégorie.')
    if (ruleMode && !merchant.trim()) return setError('Donnez un nom à cette charge fixe, par exemple « Eau ».')
    setError(null)
    setLoading(true)
    // Privée seulement dans son propre espace personnel ; ailleurs, toujours visible.
    const isPrivate = privateNow
    const { scope, memberId } = spaceFields(space, expense?.memberId ?? user.uid)
    const data = {
      amountCents,
      date: toTimestamp(date),
      categoryId,
      merchant: merchant.trim() || null,
      paymentMethod,
      memberId,
      scope,
      kind: ruleMode ? ('recurring' as ExpenseKind) : kind,
      note: note.trim() || null,
      receiptPath,
    }
    try {
      if (expense) await updateExpense(household.id, expense, data, user, isPrivate)
      else if (ruleMode) {
        // Comptée à partir de la date choisie : si elle est déjà passée, la dépense saisie couvre son mois et la
        // charge fixe prend le relais le mois suivant ; si elle est à venir, rien n'est compté avant ce jour-là.
        const first = data.date.toDate()
        const upcoming = first > new Date(new Date().getFullYear(), new Date().getMonth(), new Date().getDate(), 23, 59, 59, 999)
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
            scope,
            memberId,
            startMonth: upcoming ? monthKey(first) : shiftMonth(monthKey(first), 1),
          },
          user,
        )
        if (!upcoming) await createExpense(household.id, { ...data, recurrenceId: subscriptionId }, user)
      } else await createExpense(household.id, data, user, isPrivate)
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
      await deleteExpense(household.id, expense, user)
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
            Dépense ajoutée automatiquement chaque mois. Cette modification ne change que ce mois-ci ; pour les mois suivants, modifiez-la dans
            « Dépenses récurrentes ».
          </Notice>
        )}
        <CategoryPicker categories={categories} value={categoryId} onChange={setCategoryId} />
        <NewCategoryInline onCreated={setCategoryId} />
        <TextField
          label={ruleMode ? 'Nom de la charge fixe' : 'Commerçant (facultatif)'}
          placeholder={ruleMode ? 'Ex. Eau, assurance habitation…' : undefined}
          maxLength={120}
          value={merchant}
          onChange={(e) => setMerchant(e.target.value)}
        />
        {!expense && !privateNow && (
          <ToggleRow
            label="Même montant chaque mois"
            description="Eau, assurance, loyer… ajoutée automatiquement chaque mois, à partir de la date choisie, même si la consommation varie."
            checked={fixedMonthly}
            onChange={setFixedMonthly}
          />
        )}
        <SpaceFields space={space} onSpace={setSpace} privacy={privacy} onPrivacy={setPrivacy} />
        <Select label="Moyen de paiement" value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value as PaymentMethod)}>
          {PAYMENT_METHODS.map((m) => (
            <option key={m} value={m}>
              {PAYMENT_METHOD_LABELS[m]}
            </option>
          ))}
        </Select>
        {!ruleMode && <SegmentedControl label="Type" value={kind} onChange={setKind} options={KINDS.map((k) => ({ value: k, label: EXPENSE_KIND_LABELS[k] }))} />}
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
