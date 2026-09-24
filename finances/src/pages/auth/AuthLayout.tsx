import type { ReactNode } from 'react'
import { Logo } from '@/components/layout/Logo'
import styles from './AuthLayout.module.css'

export function AuthLayout({ title, subtitle, children, footer }: { title: string; subtitle?: string; children: ReactNode; footer?: ReactNode }) {
  return (
    <div className={styles.page}>
      <div className={`${styles.panel} animate-in`}>
        <Logo size={40} />
        <div className={styles.heading}>
          <h1>{title}</h1>
          {subtitle && <p className="muted">{subtitle}</p>}
        </div>
        {children}
        {footer && <div className={styles.footer}>{footer}</div>}
      </div>
    </div>
  )
}
