import styles from './SegmentedControl.module.css'

interface Option<T extends string> {
  value: T
  label: string
}

interface SegmentedControlProps<T extends string> {
  label: string
  value: T
  onChange: (value: T) => void
  options: Option<T>[]
}

export function SegmentedControl<T extends string>({ label, value, onChange, options }: SegmentedControlProps<T>) {
  return (
    <div className={styles.field}>
      <span className={styles.label}>{label}</span>
      <div className={styles.segmented} role="radiogroup" aria-label={label}>
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={value === option.value}
            className={[styles.segment, value === option.value && styles.selected].filter(Boolean).join(' ')}
            onClick={() => onChange(option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  )
}
