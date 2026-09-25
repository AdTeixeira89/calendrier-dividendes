import { useState } from 'react'
import { Card } from '@/components/ui'
import { useCurrentUser } from '@/hooks/useAuth'
import { useHousehold } from '@/hooks/useHousehold'
import { setBudgetLine } from '@/services/budgetService'
import type { Budget, Category, Expense } from '@/types'
import type { MonthKey } from '@/utils/month'
import { totalsByCategory } from '@/utils/monthlyStats'
import { formatCents, parseAmountToCents } from '@/utils/money'
import { CategoryIcon } from './CategoryIcon'
import styles from './BudgetSection.module.css'

interface BudgetSectionProps {
  month: MonthKey
  categories: Category[]
  expenses: Expense[]
  budget: Budget | null | undefined
}

/** « Budget prévu / Réel / Écart » par catégorie, pour le mois affiché (cahier des charges §6). */
export function BudgetSection({ month, categories, expenses, budget }: BudgetSectionProps) {
  const user = useCurrentUser()
  const { household, canWrite } = useHousehold()
  const actualByCategory = new Map(totalsByCategory(expenses).map((t) => [t.categoryId, t.amountCents]))
  const roots = categories.filter((c) => !c.parentId && !c.archived)

  return (
    <Card title="Budget du mois" subtitle="Prévu, réel et écart par catégorie">
      <ul className={styles.list}>
        {roots.map((category) => (
          <BudgetRow
            key={category.id}
            category={category}
            plannedCents={budget?.lines[category.id] ?? 0}
            actualCents={actualByCategory.get(category.id) ?? 0}
            editable={canWrite}
            onSave={(cents) => void setBudgetLine(household.id, month, category.id, cents, user)}
          />
        ))}
      </ul>
    </Card>
  )
}

function BudgetRow({
  category,
  plannedCents,
  actualCents,
  editable,
  onSave,
}: {
  category: Category
  plannedCents: number
  actualCents: number
  editable: boolean
  onSave: (cents: number) => void
}) {
  const [editing, setEditing] = useState(false)
  const [raw, setRaw] = useState(plannedCents > 0 ? String(plannedCents / 100).replace('.', ',') : '')
  const variance = actualCents - plannedCents

  function commit() {
    const cents = parseAmountToCents(raw)
    if (cents !== null && cents >= 0) onSave(cents)
    setEditing(false)
  }

  return (
    <li className={styles.row}>
      <div className={styles.rowHead}>
        <CategoryIcon icon={category.icon} color={category.color} size="sm" />
        <span className={styles.name}>{category.name}</span>
      </div>
      <div className={styles.figures}>
        <span className={styles.figure}>
          <span className={styles.figureLabel}>Budget</span>
          {editing ? (
            <input
              className={styles.input}
              autoFocus
              inputMode="decimal"
              value={raw}
              onChange={(e) => setRaw(e.target.value)}
              onBlur={commit}
              onKeyDown={(e) => e.key === 'Enter' && commit()}
            />
          ) : (
            <button type="button" className={styles.planned} disabled={!editable} onClick={() => setEditing(true)}>
              {plannedCents > 0 ? formatCents(plannedCents, 'EUR', { compact: true }) : 'Définir'}
            </button>
          )}
        </span>
        <span className={styles.figure}>
          <span className={styles.figureLabel}>Réel</span>
          <span className="num">{formatCents(actualCents, 'EUR', { compact: true })}</span>
        </span>
        <span className={styles.figure}>
          <span className={styles.figureLabel}>Écart</span>
          <span className={`num ${styles.variance} ${variance > 0 ? styles.over : variance < 0 ? styles.under : ''}`}>
            {variance === 0 ? '—' : `${variance > 0 ? '+' : ''}${formatCents(variance, 'EUR', { compact: true })}`}
          </span>
        </span>
      </div>
    </li>
  )
}
