import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { TrendingDown, TrendingUp } from 'lucide-react'
import type { Cents } from '@/types'
import { formatCents, formatPercent } from '@/utils/money'
import { toneColor, type Tone } from './tone'
import styles from './StatCard.module.css'

interface StatCardProps {
  label: string
  /** Montant en centimes ; null = pas encore de données (ignoré si `displayValue` est fourni). */
  amount: Cents | null
  /** Remplace l'affichage du montant par un texte déjà formaté (ex. un pourcentage). */
  displayValue?: string
  tone?: Tone
  icon?: ReactNode
  /** Variation en % par rapport à la période précédente. */
  change?: number | null
  /** Une hausse est-elle une bonne nouvelle ? (vrai pour revenus/épargne, faux pour dépenses). */
  higherIsBetter?: boolean
  footnote?: ReactNode
  /** Rend toute la carte cliquable vers cette page. */
  to?: string
  /** Petit contrôle à droite du titre (ex. choix Communes / Perso). */
  action?: ReactNode
}

export function StatCard({ label, amount, displayValue, tone = 'accent', icon, change, higherIsBetter = true, footnote, to, action }: StatCardProps) {
  const hasChange = change !== undefined && change !== null && Number.isFinite(change)
  const positive = hasChange && (change > 0) === higherIsBetter
  const value = displayValue ?? (amount === null ? '—' : formatCents(amount, 'EUR', { compact: true }))
  const card = (
    <article className={styles.card} style={{ ['--tone' as string]: toneColor(tone) }}>
      <div className={styles.head}>
        {icon && <span className={styles.icon}>{icon}</span>}
        <span className={styles.label}>{label}</span>
      </div>
      <p className={`${styles.amount} num`}>{value}</p>
      {hasChange ? (
        <p className={[styles.change, positive ? styles.good : styles.bad].join(' ')}>
          {change >= 0 ? <TrendingUp size={14} aria-hidden /> : <TrendingDown size={14} aria-hidden />}
          <span className="num">{formatPercent(change, { signed: true })}</span>
          <span className={styles.vs}>vs mois dernier</span>
        </p>
      ) : (
        footnote && <p className={styles.footnote}>{footnote}</p>
      )}
      {action && <div style={{ margin: 'var(--space-1) 0 -12px -8px' }}>{action}</div>}
    </article>
  )
  return to ? (
    <Link to={to} className={styles.link}>
      {card}
    </Link>
  ) : (
    card
  )
}
