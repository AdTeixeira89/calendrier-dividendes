import { Link } from 'react-router-dom'
import { AlertTriangle, BellRing, ChevronRight, XCircle } from 'lucide-react'
import type { AlertSeverity, FinancialAlert } from '@shared/alerts'
import { Card } from '@/components/ui'
import styles from './AlertsCard.module.css'

const ICONS: Record<AlertSeverity, typeof XCircle> = { danger: XCircle, warning: AlertTriangle, info: BellRing }
const TONES: Record<AlertSeverity, string> = { danger: 'var(--danger)', warning: 'var(--warning)', info: 'var(--accent)' }

export function AlertsCard({ alerts }: { alerts: FinancialAlert[] }) {
  return (
    <Card title="Alertes" subtitle={`${alerts.length} point${alerts.length > 1 ? 's' : ''} à surveiller`} padded={false}>
      <ul className={styles.list}>
        {alerts.map((alert) => {
          const Icon = ICONS[alert.severity]
          return (
            <li key={alert.key}>
              <Link to={alert.link} className={styles.item} style={{ ['--tone' as string]: TONES[alert.severity] }}>
                <Icon size={20} aria-hidden className={styles.icon} />
                <span className={styles.text}>
                  <strong>{alert.title}</strong>
                  <span className="subtle">{alert.message}</span>
                </span>
                <ChevronRight size={18} aria-hidden className="subtle" />
              </Link>
            </li>
          )
        })}
      </ul>
    </Card>
  )
}
