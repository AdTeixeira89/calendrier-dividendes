import { useState } from 'react'
import { TextField } from '@/components/ui'
import type { Cents } from '@/types'
import { parseAmountToCents } from '@/utils/money'

interface AmountFieldProps {
  label?: string
  value: Cents | null
  onChange: (cents: Cents | null) => void
  autoFocus?: boolean
}

/** Champ montant : saisie libre ("87,42", "12 €"), converti en centimes ; rejette une saisie invalide sans bloquer la frappe. */
export function AmountField({ label = 'Montant', value, onChange, autoFocus }: AmountFieldProps) {
  const [raw, setRaw] = useState(value !== null ? String(value / 100).replace('.', ',') : '')
  const [touched, setTouched] = useState(false)
  const invalid = touched && raw.trim() !== '' && parseAmountToCents(raw) === null

  return (
    <TextField
      label={label}
      inputMode="decimal"
      placeholder="0,00"
      required
      autoFocus={autoFocus}
      value={raw}
      onChange={(e) => {
        const next = e.target.value
        setRaw(next)
        onChange(parseAmountToCents(next))
      }}
      onBlur={() => setTouched(true)}
      error={invalid ? 'Montant invalide' : null}
      trailing={<span className="subtle">€</span>}
    />
  )
}
