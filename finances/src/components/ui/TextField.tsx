import { useId, type InputHTMLAttributes, type ReactNode } from 'react'
import styles from './TextField.module.css'

interface TextFieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string
  hint?: ReactNode
  error?: string | null
  trailing?: ReactNode
}

export function TextField({ label, hint, error, trailing, id, className, ...rest }: TextFieldProps) {
  const autoId = useId()
  const inputId = id ?? autoId
  const describedBy = error ? `${inputId}-error` : hint ? `${inputId}-hint` : undefined
  return (
    <div className={[styles.field, className].filter(Boolean).join(' ')}>
      <label htmlFor={inputId} className={styles.label}>
        {label}
      </label>
      <div className={[styles.control, error && styles.invalid].filter(Boolean).join(' ')}>
        <input id={inputId} className={styles.input} aria-invalid={Boolean(error)} aria-describedby={describedBy} {...rest} />
        {trailing}
      </div>
      {error ? (
        <p id={`${inputId}-error`} className={styles.error} role="alert">
          {error}
        </p>
      ) : (
        hint && (
          <p id={`${inputId}-hint`} className={styles.hint}>
            {hint}
          </p>
        )
      )}
    </div>
  )
}
