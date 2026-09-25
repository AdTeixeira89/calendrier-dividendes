import { ChevronLeft, ChevronRight } from 'lucide-react'
import { formatMonthKey, isCurrentMonth, previousMonthKey, shiftMonth, type MonthKey } from '@/utils/month'
import styles from './MonthNav.module.css'

export function MonthNav({ month, onChange }: { month: MonthKey; onChange: (month: MonthKey) => void }) {
  return (
    <div className={styles.nav}>
      <button type="button" className={styles.arrow} onClick={() => onChange(previousMonthKey(month))} aria-label="Mois précédent">
        <ChevronLeft size={20} />
      </button>
      <span className={styles.label}>
        {formatMonthKey(month)}
        {isCurrentMonth(month) && <span className={styles.badge}>en cours</span>}
      </span>
      <button type="button" className={styles.arrow} onClick={() => onChange(shiftMonth(month, 1))} aria-label="Mois suivant">
        <ChevronRight size={20} />
      </button>
    </div>
  )
}
