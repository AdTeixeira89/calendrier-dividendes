import { useState, type FormEvent } from 'react'
import { Trash2 } from 'lucide-react'
import { Button, ConfirmButton, Notice, Select, Sheet, TextField } from '@/components/ui'
import { SegmentedControl } from '@/components/ui/SegmentedControl'
import { useCurrentUser } from '@/hooks/useAuth'
import { useHousehold } from '@/hooks/useHousehold'
import { createSubscription, deleteSubscription, updateSubscription } from '@/services/subscriptionService'
import type { Subscription } from '@/types'
import type { SubscriptionPeriod } from '@/types/subscription'
import { toUserMessage } from '@/utils/firebaseErrors'

interface SubscriptionFormSheetProps {
  open: boolean
  onClose: () => void
  subscription?: Subscription
}

export function SubscriptionFormSheet({ open, onClose, subscription }: SubscriptionFormSheetProps) {
  const user = useCurrentUser()
  const { household } = useHousehold()
  const [name, setName] = useState(subscription?.name ?? '')
  const [amount, setAmount] = useState(subscription ? String(subscription.amountCents / 100) : '')
  const [period, setPeriod] = useState<SubscriptionPeriod>(subscription?.period ?? 'monthly')
  const [usage, setUsage] = useState<'frequent' | 'occasional' | 'rare' | ''>(subscription?.usage ?? '')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    const amountCents = Math.round(Number(amount.replace(',', '.')) * 100)
    if (!name.trim() || !Number.isFinite(amountCents) || amountCents <= 0) return setError('Donnez un nom et un montant valide.')
    setError(null)
    setLoading(true)
    const data = { name: name.trim(), amountCents, period, categoryId: null, nextDate: null, usage: usage || null, archived: false }
    try {
      if (subscription) await updateSubscription(household.id, subscription.id, data, user)
      else await createSubscription(household.id, data, user)
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
    <Sheet open={open} onClose={onClose} title={subscription ? "Modifier l'abonnement" : 'Nouvel abonnement'}>
      <form className="stack" onSubmit={onSubmit} noValidate>
        {error && <Notice tone="danger">{error}</Notice>}
        <TextField label="Nom" placeholder="Ex. Netflix, Spotify, Internet…" maxLength={80} value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        <div className="row" style={{ alignItems: 'flex-start' }}>
          <TextField label="Montant" inputMode="decimal" required value={amount} onChange={(e) => setAmount(e.target.value)} trailing={<span className="subtle">€</span>} />
          <SegmentedControl label="Période" value={period} onChange={setPeriod} options={[{ value: 'monthly', label: 'Mensuel' }, { value: 'yearly', label: 'Annuel' }]} />
        </div>
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
