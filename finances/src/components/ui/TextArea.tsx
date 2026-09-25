import { useId, type TextareaHTMLAttributes } from 'react'
import styles from './TextField.module.css'

interface TextAreaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label: string
}

export function TextArea({ label, id, className, rows = 3, ...rest }: TextAreaProps) {
  const autoId = useId()
  const inputId = id ?? autoId
  return (
    <div className={[styles.field, className].filter(Boolean).join(' ')}>
      <label htmlFor={inputId} className={styles.label}>
        {label}
      </label>
      <div className={styles.control} style={{ height: 'auto', padding: 'var(--space-3) var(--space-4)' }}>
        <textarea id={inputId} className={styles.input} style={{ height: 'auto', resize: 'vertical' }} rows={rows} {...rest} />
      </div>
    </div>
  )
}
