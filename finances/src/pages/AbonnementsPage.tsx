import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Plus, Repeat } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { SubscriptionFormSheet } from '@/components/finance/SubscriptionFormSheet'
import { SubscriptionRow } from '@/components/finance/SubscriptionRow'
import { Button, Card, EmptyState, Notice, StatCard } from '@/components/ui'
import { useHousehold } from '@/hooks/useHousehold'
import { useSubscriptions } from '@/hooks/useSubscriptions'
import type { Subscription } from '@/types'
import { totalAnnualCost, totalMonthlyCost } from '@/utils/subscriptions'

export function AbonnementsPage() {
  const { household, canWrite } = useHousehold()
  const subscriptions = useSubscriptions(household.id)
  const [params, setParams] = useSearchParams()
  const [editing, setEditing] = useState<Subscription | undefined>(undefined)
  const sheetOpen = params.has('ajouter') || Boolean(editing)

  function closeSheet() {
    setEditing(undefined)
    if (params.has('ajouter')) {
      const next = new URLSearchParams(params)
      next.delete('ajouter')
      setParams(next, { replace: true })
    }
  }

  const rareCount = subscriptions?.filter((s) => s.usage === 'rare').length ?? 0

  return (
    <div className="stack animate-in">
      <PageHeader title="Abonnements et charges fixes" subtitle="Ajoutés automatiquement à vos dépenses, chaque mois." />

      <section className="grid-cards" style={{ gridTemplateColumns: 'repeat(2, minmax(0,1fr))' }}>
        <StatCard label="Coût mensuel" amount={subscriptions ? totalMonthlyCost(subscriptions) : null} tone="expense" icon={<Repeat size={16} />} higherIsBetter={false} footnote={subscriptions ? `${subscriptions.length} abonnement${subscriptions.length > 1 ? 's' : ''}` : undefined} />
        <StatCard label="Coût annuel" amount={subscriptions ? totalAnnualCost(subscriptions) : null} tone="expense" higherIsBetter={false} />
      </section>

      {rareCount > 0 && (
        <Notice tone="warning">
          {rareCount} abonnement{rareCount > 1 ? 's marqués' : ' marqué'} « peu utilisé » — pensez à vérifier s'ils sont toujours nécessaires.
        </Notice>
      )}

      {canWrite && (
        <Button icon={<Plus size={18} />} onClick={() => setParams((p) => new URLSearchParams({ ...Object.fromEntries(p), ajouter: '1' }))}>
          Ajouter un abonnement ou une charge
        </Button>
      )}

      <Card title="Vos abonnements et charges" padded={subscriptions !== undefined && subscriptions.length === 0}>
        {subscriptions === undefined ? null : subscriptions.length === 0 ? (
          <EmptyState icon={<Repeat size={28} />} title="Aucun abonnement" description="Netflix, Spotify, internet, eau, assurances… chacun est ajouté tout seul aux dépenses de chaque mois." />
        ) : (
          <ul className="stack" style={{ gap: 2 }}>
            {subscriptions.map((subscription) => (
              <li key={subscription.id}>
                <SubscriptionRow subscription={subscription} onClick={() => setEditing(subscription)} />
              </li>
            ))}
          </ul>
        )}
      </Card>

      <SubscriptionFormSheet key={editing?.id ?? 'new'} open={sheetOpen} onClose={closeSheet} subscription={editing} />
    </div>
  )
}
