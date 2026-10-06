import { TREND_PERIODS, type TrendPeriod } from '@/utils/trendPeriod'
import styles from './PeriodFilter.module.css'

/** Choix de la période du graphique : discret (petites pastilles), mais chaque bouton fait 44 px de haut. */
export function PeriodFilter({ value, onChange }: { value: TrendPeriod; onChange: (period: TrendPeriod) => void }) {
  return (
    <div className={styles.group} role="radiogroup" aria-label="Période du graphique">
      {TREND_PERIODS.map((p) => (
        <button
          key={p.value}
          type="button"
          role="radio"
          aria-checked={value === p.value}
          aria-label={p.full}
          title={p.full}
          className={[styles.option, value === p.value && styles.selected].filter(Boolean).join(' ')}
          onClick={() => onChange(p.value)}
        >
          <span className={styles.pill}>{p.label}</span>
        </button>
      ))}
    </div>
  )
}
