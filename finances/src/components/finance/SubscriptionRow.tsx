import { Repeat } from 'lucide-react'
import type { Subscription } from '@/types'
import { formatCents } from '@/utils/money'
import { annualCost, monthlyCost } from '@/utils/subscriptions'
import styles from './TransactionRow.module.css'

const USAGE_LABELS: Record<string, string> = { frequent: 'Fréquent', occasional: 'Occasionnel', rare: 'Peu utilisé' }

export function SubscriptionRow({ subscription, onClick }: { subscription: Subscription; onClick: () => void }) {
  return (
    <button type="button" className={styles.row} onClick={onClick}>
      <span style={{ display: 'grid', placeItems: 'center', flex: 'none', width: 36, height: 36, borderRadius: 10, background: 'var(--surface-hover)', color: 'var(--accent)' }}>
        <Repeat size={16} aria-hidden />
      </span>
      <span className={styles.info}>
        <strong>{subscription.name}</strong>
        <span className="subtle">
          {formatCents(annualCost(subscription), 'EUR', { compact: true })} / an
          {subscription.usage === 'rare' && ' · Peu utilisé'}
          {subscription.usage && subscription.usage !== 'rare' && ` · ${USAGE_LABELS[subscription.usage]}`}
        </span>
      </span>
      <span className={`${styles.amount} num`} style={{ color: 'var(--text)' }}>
        {formatCents(monthlyCost(subscription), 'EUR', { compact: true })}/mois
      </span>
    </button>
  )
}
