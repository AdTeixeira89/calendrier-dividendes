import type { HomeView } from '@/services/homePrefsService'
import styles from './PeriodFilter.module.css'

const OPTIONS: { value: HomeView; label: string; full: string }[] = [
  { value: 'common', label: 'Communes', full: 'Dépenses et épargne communes' },
  { value: 'personal', label: 'Perso', full: 'Mes finances personnelles' },
]

/** Bascule Communes / Perso, discrète (mêmes pastilles que le choix de période), mémorisée par compte. */
export function ScopeFilter({ label, value, onChange, communeLabel, align = 'end' }: { label: string; value: HomeView; onChange: (view: HomeView) => void; communeLabel?: string; align?: 'start' | 'end' }) {
  return (
    <div className={styles.group} style={{ margin: 0, justifyContent: align === 'start' ? 'flex-start' : 'flex-end' }} role="radiogroup" aria-label={label}>
      {OPTIONS.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          aria-label={`${label} : ${o.value === 'common' ? (communeLabel ?? o.full) : o.full}`}
          className={[styles.option, value === o.value && styles.selected].filter(Boolean).join(' ')}
          onClick={(e) => {
            // Dans une carte cliquable : changer l'affichage ne doit pas ouvrir la page.
            e.preventDefault()
            e.stopPropagation()
            onChange(o.value)
          }}
        >
          <span className={styles.pill}>{o.label}</span>
        </button>
      ))}
    </div>
  )
}
