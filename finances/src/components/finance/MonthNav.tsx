import { ChevronLeft, ChevronRight } from 'lucide-react'
import { currentBudgetMonthKey } from '@/utils/budgetMonth'
import { currentMonthKey, formatMonthKey, previousMonthKey, shiftMonth, type MonthKey } from '@/utils/month'
import styles from './MonthNav.module.css'

/** `budget` : le « en cours » suit le mois budgétaire (du 6 au 5) des pages de dépenses. */
export function MonthNav({ month, onChange, kind = 'calendar' }: { month: MonthKey; onChange: (month: MonthKey) => void; kind?: 'calendar' | 'budget' }) {
  const current = kind === 'budget' ? currentBudgetMonthKey() : currentMonthKey()
  return (
    <div className={styles.nav}>
      <button type="button" className={styles.arrow} onClick={() => onChange(previousMonthKey(month))} aria-label="Mois précédent">
        <ChevronLeft size={20} />
      </button>
      <span className={styles.label}>
        {formatMonthKey(month)}
        {month === current && <span className={styles.badge}>en cours</span>}
      </span>
      <button type="button" className={styles.arrow} onClick={() => onChange(shiftMonth(month, 1))} aria-label="Mois suivant">
        <ChevronRight size={20} />
      </button>
    </div>
  )
}
