import styles from './Spinner.module.css'

export function Spinner({ size = 20, label }: { size?: number; label?: string }) {
  return (
    <span className={styles.spinner} style={{ width: size, height: size }} role={label ? 'status' : undefined}>
      {label && <span className="sr-only">{label}</span>}
    </span>
  )
}

export function FullPageSpinner({ label = 'Chargement…' }: { label?: string }) {
  return (
    <div className={styles.fullPage}>
      <Spinner size={32} label={label} />
    </div>
  )
}
