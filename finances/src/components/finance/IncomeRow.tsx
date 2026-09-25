import type { Income } from '@/types'
import { INCOME_TYPE_LABELS } from '@/types/income'
import { formatCents } from '@/utils/money'
import { CategoryIcon } from './CategoryIcon'
import styles from './TransactionRow.module.css'

export function IncomeRow({ income, onClick }: { income: Income; onClick: () => void }) {
  const day = income.date.toDate().toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' })
  return (
    <button type="button" className={styles.row} onClick={onClick}>
      <CategoryIcon icon="banknote" color="income" />
      <span className={styles.info}>
        <strong>{income.label || INCOME_TYPE_LABELS[income.type]}</strong>
        <span className="subtle">
          {day} · {INCOME_TYPE_LABELS[income.type]}
        </span>
      </span>
      <span className={`${styles.amount} num`} style={{ color: 'var(--income)' }}>
        +{formatCents(income.amountCents)}
      </span>
    </button>
  )
}
