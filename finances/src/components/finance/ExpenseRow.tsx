import type { Category, Expense } from '@/types'
import { formatCents } from '@/utils/money'
import { CategoryIcon } from './CategoryIcon'
import styles from './TransactionRow.module.css'

export function ExpenseRow({ expense, category, onClick }: { expense: Expense; category: Category | undefined; onClick: () => void }) {
  const day = expense.date.toDate().toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' })
  return (
    <button type="button" className={styles.row} onClick={onClick}>
      <CategoryIcon icon={category?.icon ?? 'more-horizontal'} color={category?.color ?? 'expense'} />
      <span className={styles.info}>
        <strong>{expense.merchant || category?.name || 'Dépense'}</strong>
        <span className="subtle">
          {day} · {category?.name ?? 'Sans catégorie'}
          {expense.scope === 'personal' && ' · Personnelle'}
        </span>
      </span>
      <span className={`${styles.amount} num`}>−{formatCents(expense.amountCents)}</span>
    </button>
  )
}
