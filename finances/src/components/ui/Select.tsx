import { useId, type ReactNode, type SelectHTMLAttributes } from 'react'
import styles from './TextField.module.css'

interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label: string
  children: ReactNode
}

export function Select({ label, id, className, children, ...rest }: SelectProps) {
  const autoId = useId()
  const inputId = id ?? autoId
  return (
    <div className={[styles.field, className].filter(Boolean).join(' ')}>
      <label htmlFor={inputId} className={styles.label}>
        {label}
      </label>
      <div className={styles.control} style={{ paddingRight: 8 }}>
        <select id={inputId} className={styles.input} {...rest}>
          {children}
        </select>
      </div>
    </div>
  )
}
