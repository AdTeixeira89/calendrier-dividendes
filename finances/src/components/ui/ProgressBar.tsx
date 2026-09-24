import { toneColor, type Tone } from './tone'
import styles from './ProgressBar.module.css'


interface ProgressBarProps {
  /** Valeur en pourcentage (bornée entre 0 et 100 à l'affichage). */
  value: number
  tone?: Tone
  label: string
  size?: 'sm' | 'md' | 'lg'
}

export function ProgressBar({ value, tone = 'accent', label, size = 'md' }: ProgressBarProps) {
  const clamped = Math.max(0, Math.min(100, value))
  return (
    <div
      className={[styles.track, styles[size]].join(' ')}
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(clamped)}
    >
      <div className={styles.fill} style={{ width: `${clamped}%`, background: toneColor(tone) }} />
    </div>
  )
}
