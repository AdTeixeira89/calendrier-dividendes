import { ProgressBar } from '@/components/ui'
import type { Debt } from '@/types'
import { DEBT_TYPE_LABELS } from '@/types/debt'
import { formatDate } from '@/utils/dates'
import { formatCents } from '@/utils/money'
import { debtProgress, estimatedPayoffDate, monthsRemaining } from '@/utils/debt'
import { Card } from '@/components/ui'
import styles from './DebtCard.module.css'

export function DebtCard({ debt, onClick }: { debt: Debt; onClick: () => void }) {
  const progress = debtProgress(debt.principalCents, debt.outstandingCents)
  const months = monthsRemaining(debt.outstandingCents, debt.monthlyPaymentCents)
  const payoff = estimatedPayoffDate(debt.outstandingCents, debt.monthlyPaymentCents)

  return (
    <Card padded={false}>
      <button type="button" className={styles.card} onClick={onClick}>
        <div className={styles.head}>
          <span className={styles.name}>{debt.name}</span>
          <span className="subtle">{DEBT_TYPE_LABELS[debt.type]}</span>
        </div>
        <div className={styles.grid}>
          <Figure label="Capital restant" value={formatCents(debt.outstandingCents, 'EUR', { compact: true })} />
          <Figure label="Mensualité" value={formatCents(debt.monthlyPaymentCents + debt.insuranceCents, 'EUR', { compact: true })} />
          <Figure label="Taux" value={debt.annualRate !== null ? `${debt.annualRate.toLocaleString('fr-FR')} %` : '—'} />
        </div>
        <ProgressBar value={progress} tone="debt" label={`Progression du remboursement de ${debt.name}`} size="lg" />
        <p className={styles.footer}>
          <span className="num">{Math.round(progress)} % remboursé</span>
          <span className="subtle">
            {months === null ? 'Mensualité manquante' : months === 0 ? 'Soldé' : `Environ ${months} mois restants${payoff ? ` · fin estimée ${formatDate(payoff)}` : ''}`}
          </span>
        </p>
      </button>
    </Card>
  )
}

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <span className={styles.figure}>
      <span className={styles.figureLabel}>{label}</span>
      <span className="num">{value}</span>
    </span>
  )
}
