import { useState, type ReactNode } from 'react'
import { Button } from './Button'

interface ConfirmButtonProps {
  label: ReactNode
  confirmLabel?: ReactNode
  question: ReactNode
  icon?: ReactNode
  onConfirm: () => void
  disabled?: boolean
}

/**
 * Bouton de suppression à confirmation intégrée à l'app, en deux temps.
 *
 * N'utilise jamais `window.confirm()` : dans une feuille modale (<dialog>),
 * ce dialogue natif se comporte de façon peu fiable sur iOS Safari (peut ne
 * jamais s'afficher), rendant la suppression impossible pour l'utilisateur.
 */
export function ConfirmButton({ label, confirmLabel = 'Confirmer la suppression', question, icon, onConfirm, disabled }: ConfirmButtonProps) {
  const [confirming, setConfirming] = useState(false)

  if (!confirming) {
    return (
      <Button type="button" variant="danger" icon={icon} disabled={disabled} onClick={() => setConfirming(true)}>
        {label}
      </Button>
    )
  }

  return (
    <div className="stack" style={{ gap: 8 }}>
      <p className="subtle" style={{ fontSize: 'var(--text-sm)' }}>
        {question}
      </p>
      <div className="row">
        <Button type="button" variant="danger" onClick={onConfirm} disabled={disabled}>
          {confirmLabel}
        </Button>
        <Button type="button" variant="ghost" onClick={() => setConfirming(false)}>
          Annuler
        </Button>
      </div>
    </div>
  )
}
