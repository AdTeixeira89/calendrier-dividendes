import { useState, type FormEvent } from 'react'
import { Trash2 } from 'lucide-react'
import { Button, ConfirmButton, Notice, Select, Sheet, TextField } from '@/components/ui'
import { SegmentedControl } from '@/components/ui/SegmentedControl'
import { useCurrentUser } from '@/hooks/useAuth'
import { useCategories } from '@/hooks/useCategories'
import { useHousehold } from '@/hooks/useHousehold'
import { fromTimestamp, toTimestamp } from '@/services/expenseService'
import { syncCurrentOccurrence } from '@/services/recurringExpenseService'
import { createSubscription, deleteSubscription, updateSubscription } from '@/services/subscriptionService'
import type { Subscription } from '@/types'
import type { SubscriptionPeriod } from '@/types/subscription'
import { toUserMessage } from '@/utils/firebaseErrors'
import { currentMonthKey } from '@/utils/month'
import { CategoryPicker } from './CategoryPicker'
import { ToggleRow } from './ToggleRow'

const fromTimestampOrNull = (t: Subscription['nextDate']) => (t ? fromTimestamp(t) : '')

interface SubscriptionFormSheetProps {
  open: boolean
  onClose: () => void
  subscription?: Subscription
}

export function SubscriptionFormSheet({ open, onClose, subscription }: SubscriptionFormSheetProps) {
  const user = useCurrentUser()
  const { household } = useHousehold()
  const categories = useCategories(household.id, 'expense')
  const [name, setName] = useState(subscription?.name ?? '')
  const [amount, setAmount] = useState(subscription ? String(subscription.amountCents / 100) : '')
  const [period, setPeriod] = useState<SubscriptionPeriod>(subscription?.period ?? 'monthly')
  const [categoryId, setCategoryId] = useState(subscription?.categoryId ?? '')
  const [autoExpense, setAutoExpense] = useState(subscription?.autoExpense ?? true)
  const [nextDate, setNextDate] = useState(subscription?.nextDate ? fromTimestamp(subscription.nextDate) : '')
  const [usage, setUsage] = useState<'frequent' | 'occasional' | 'rare' | ''>(subscription?.usage ?? '')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    const amountCents = Math.round(Number(amount.replace(',', '.')) * 100)
    if (!name.trim() || !Number.isFinite(amountCents) || amountCents <= 0) return setError('Donnez un nom et un montant valide.')
    if (autoExpense && !categoryId) return setError('Choisissez une catégorie : la dépense automatique y sera rangée.')
    setError(null)
    setLoading(true)
    // Le suivi (re)démarre ce mois-ci à la création, ou quand on réactive la dépense automatique.
    const keepsStart = subscription?.startMonth && (subscription.autoExpense ?? true)
    const data = {
      name: name.trim(),
      amountCents,
      period,
      categoryId: categoryId || null,
      nextDate: nextDate ? toTimestamp(nextDate) : null,
      usage: usage || null,
      archived: subscription?.archived ?? false,
      autoExpense,
      startMonth: keepsStart ? subscription.startMonth : currentMonthKey(),
    }
    try {
      if (subscription) {
        await updateSubscription(household.id, subscription.id, data, user)
        const changed =
          subscription.amountCents !== data.amountCents || subscription.name !== data.name || subscription.categoryId !== data.categoryId || fromTimestampOrNull(subscription.nextDate) !== nextDate
        if (changed && categories) await syncCurrentOccurrence(household.id, { ...subscription, ...data, nextDate: data.nextDate }, categories, user)
      } else await createSubscription(household.id, data, user)
      onClose()
    } catch (err) {
      setError(toUserMessage(err))
    } finally {
      setLoading(false)
    }
  }

  async function onDelete() {
    if (!subscription) return
    setLoading(true)
    try {
      await deleteSubscription(household.id, subscription.id, user)
      onClose()
    } catch (err) {
      setError(toUserMessage(err))
      setLoading(false)
    }
  }

  return (
    <Sheet open={open} onClose={onClose} title={subscription ? 'Modifier cet abonnement ou cette charge' : 'Nouvel abonnement ou charge fixe'}>
      <form className="stack" onSubmit={onSubmit} noValidate>
        {error && <Notice tone="danger">{error}</Notice>}
        <TextField label="Nom" placeholder="Ex. Netflix, Spotify, Internet…" maxLength={80} value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        <div className="row" style={{ alignItems: 'flex-start' }}>
          <TextField label="Montant" inputMode="decimal" required value={amount} onChange={(e) => setAmount(e.target.value)} trailing={<span className="subtle">€</span>} />
          <SegmentedControl label="Période" value={period} onChange={setPeriod} options={[{ value: 'monthly', label: 'Mensuel' }, { value: 'yearly', label: 'Annuel' }]} />
        </div>
        {categories && <CategoryPicker categories={categories} value={categoryId} onChange={setCategoryId} />}
        <TextField
          label="Prochain prélèvement (facultatif)"
          type="date"
          value={nextDate}
          onChange={(e) => setNextDate(e.target.value)}
          hint="Le jour du prélèvement : il sert au rappel et à la date de la dépense automatique."
        />
        <ToggleRow
          label="Ajouter aux dépenses chaque mois"
          description="Une dépense de ce montant est créée automatiquement, sans ressaisie."
          checked={autoExpense}
          onChange={setAutoExpense}
        />
        <Select label="Usage (facultatif)" value={usage} onChange={(e) => setUsage(e.target.value as typeof usage)}>
          <option value="">Non renseigné</option>
          <option value="frequent">Fréquent</option>
          <option value="occasional">Occasionnel</option>
          <option value="rare">Rare</option>
        </Select>
        <Button type="submit" size="lg" block loading={loading}>
          {subscription ? 'Enregistrer' : "Ajouter l'abonnement"}
        </Button>
        {subscription && (
          <ConfirmButton
            label="Supprimer"
            icon={<Trash2 size={18} />}
            question={`Supprimer « ${subscription.name} » ?`}
            onConfirm={() => void onDelete()}
            disabled={loading}
          />
        )}
      </form>
    </Sheet>
  )
}
