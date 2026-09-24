import type { HTMLAttributes, ReactNode } from 'react'
import styles from './Card.module.css'

interface CardProps extends Omit<HTMLAttributes<HTMLElement>, 'title'> {
  title?: ReactNode
  subtitle?: ReactNode
  action?: ReactNode
  padded?: boolean
}

export function Card({ title, subtitle, action, padded = true, className, children, ...rest }: CardProps) {
  return (
    <section className={[styles.card, padded && styles.padded, className].filter(Boolean).join(' ')} {...rest}>
      {(title || action) && (
        <header className={styles.header}>
          <div>
            {title && <h2 className={styles.title}>{title}</h2>}
            {subtitle && <p className={styles.subtitle}>{subtitle}</p>}
          </div>
          {action}
        </header>
      )}
      {children}
    </section>
  )
}
