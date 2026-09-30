import { Card } from '@/components/ui'
import type { Asset } from '@/types'
import { ASSET_TYPE_LABELS } from '@/types/asset'
import { formatDate } from '@/utils/dates'
import { formatCents } from '@/utils/money'
import styles from './DebtCard.module.css'

export function AssetCard({ asset, onClick }: { asset: Asset; onClick: () => void }) {
  return (
    <Card padded={false}>
      <button type="button" className={styles.card} onClick={onClick}>
        <div className={styles.head}>
          <span className={styles.name}>{asset.name}</span>
          <span className="subtle">{ASSET_TYPE_LABELS[asset.type]}</span>
        </div>
        <p className={styles.footer}>
          <span className="num">{formatCents(asset.valueCents)}</span>
          <span className="subtle">Mis à jour le {formatDate(asset.valuedAt.toDate())}</span>
        </p>
      </button>
    </Card>
  )
}
