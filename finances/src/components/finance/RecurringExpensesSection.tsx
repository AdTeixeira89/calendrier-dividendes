import { useId, useState } from 'react'
import { ChevronDown, Plus, Repeat } from 'lucide-react'
import { Button, Card } from '@/components/ui'
import { useHousehold } from '@/hooks/useHousehold'
import { useSubscriptions } from '@/hooks/useSubscriptions'
import type { Subscription } from '@/types'
import { formatCents } from '@/utils/money'
import { totalMonthlyCost } from '@/utils/subscriptions'
import styles from './RecurringExpensesSection.module.css'
import { SubscriptionFormSheet } from './SubscriptionFormSheet'
import { SubscriptionRow } from './SubscriptionRow'

/**
 * Dépenses récurrentes (eau, assurance, abonnements…) : menu déroulant compact
 * de la page Dépenses. Chaque occurrence apparaît dans la liste des dépenses,
 * à sa date ; ici on ne gère que la règle (montant, date, catégorie).
 */
export function RecurringExpensesSection() {
  const { household, canWrite } = useHousehold()
  const subscriptions = useSubscriptions(household.id)
  const [open, setOpen] = useState(false)
  const [adding, setAdding] = useState(false)
  const [editing, setEditing] = useState<Subscription | undefined>(undefined)
  const panelId = useId()

  if (subscriptions === undefined || (subscriptions.length === 0 && !canWrite)) return null

  const summary = subscriptions.length === 0 ? 'Aucune pour le moment' : `${subscriptions.length} · ${formatCents(totalMonthlyCost(subscriptions), 'EUR', { compact: true })} par mois`

  return (
    <>
      <Card padded={false} className={open ? styles.open : undefined}>
        <button type="button" className={styles.toggle} aria-expanded={open} aria-controls={panelId} onClick={() => setOpen((value) => !value)}>
          <Repeat size={18} aria-hidden className="subtle" />
          <span className={styles.title}>
            <strong>Dépenses récurrentes</strong>
            <span className="subtle">{summary}</span>
          </span>
          <ChevronDown size={20} aria-hidden className={styles.chevron} />
        </button>
        {open && (
          <div id={panelId} className={styles.panel}>
            {subscriptions.length === 0 ? (
              <p className="subtle" style={{ fontSize: 'var(--text-sm)' }}>
                Eau, assurance, internet, abonnements… ajoutez-les une fois : elles s’inscrivent seules dans vos dépenses, à leur date, chaque mois.
              </p>
            ) : (
              <ul className="stack" style={{ gap: 2 }}>
                {subscriptions.map((subscription) => (
                  <li key={subscription.id}>
                    <SubscriptionRow subscription={subscription} onClick={() => setEditing(subscription)} />
                  </li>
                ))}
              </ul>
            )}
            {canWrite && (
              <Button variant="secondary" icon={<Plus size={18} />} onClick={() => setAdding(true)}>
                Ajouter une dépense récurrente
              </Button>
            )}
          </div>
        )}
      </Card>
      <SubscriptionFormSheet
        key={editing?.id ?? (adding ? 'new' : 'closed')}
        open={adding || Boolean(editing)}
        onClose={() => {
          setAdding(false)
          setEditing(undefined)
        }}
        subscription={editing}
      />
    </>
  )
}
