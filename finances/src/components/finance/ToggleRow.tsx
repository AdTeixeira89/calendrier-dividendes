import styles from './ToggleRow.module.css'

/** Interrupteur avec titre et explication ; toute la ligne se touche (cible ≥ 44 px). */
export function ToggleRow({ label, description, checked, onChange }: { label: string; description: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <label className={styles.row}>
      <span className={styles.text}>
        <strong>{label}</strong>
        <span className="subtle">{description}</span>
      </span>
      <input type="checkbox" role="switch" className={styles.switch} checked={checked} onChange={(e) => onChange(e.target.checked)} />
    </label>
  )
}
