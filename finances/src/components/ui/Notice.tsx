import type { ReactNode } from 'react'
import { AlertTriangle, CheckCircle2, Info, XCircle } from 'lucide-react'
import styles from './Notice.module.css'

type NoticeTone = 'info' | 'success' | 'warning' | 'danger'

const ICONS = { info: Info, success: CheckCircle2, warning: AlertTriangle, danger: XCircle }

export function Notice({ tone = 'info', children }: { tone?: NoticeTone; children: ReactNode }) {
  const Icon = ICONS[tone]
  return (
    <div className={styles.notice} style={{ ['--tone' as string]: `var(--${tone})` }} role={tone === 'danger' ? 'alert' : 'status'}>
      <Icon size={18} aria-hidden className={styles.icon} />
      <div>{children}</div>
    </div>
  )
}
