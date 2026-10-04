import { createElement, useState, type FormEvent } from 'react'
import { Trash2 } from 'lucide-react'
import { Button, ConfirmButton, Notice, Select, Sheet, TextField } from '@/components/ui'
import { SegmentedControl } from '@/components/ui/SegmentedControl'
import { toneSolid, type Tone } from '@/components/ui/tone'
import { useCurrentUser } from '@/hooks/useAuth'
import { useHousehold } from '@/hooks/useHousehold'
import { createSavingsGoal, deleteSavingsGoal, updateSavingsGoal } from '@/services/savingsGoalService'
import type { SavingsGoal, Scope } from '@/types'
import { CATEGORY_ICON_NAMES, categoryIcon } from '@/utils/categoryIcons'
import { toUserMessage } from '@/utils/firebaseErrors'
import { fromTimestamp, toTimestamp } from '@/services/expenseService'

const COLORS: Tone[] = ['saving', 'accent', 'income', 'debt', 'warning', 'expense']

interface SavingsGoalFormSheetProps {
  open: boolean
  onClose: () => void
  goal?: SavingsGoal
}

export function SavingsGoalFormSheet({ open, onClose, goal }: SavingsGoalFormSheetProps) {
  const user = useCurrentUser()
  const { household, members } = useHousehold()
  const [name, setName] = useState(goal?.name ?? '')
  const [icon, setIcon] = useState(goal?.icon ?? 'piggy-bank')
  const [color, setColor] = useState<Tone>((goal?.color as Tone) ?? 'saving')
  const [target, setTarget] = useState(goal && goal.targetCents > 0 ? String(goal.targetCents / 100) : '')
  const [current, setCurrent] = useState(goal ? String(goal.currentCents / 100) : '0')
  const [monthly, setMonthly] = useState(goal ? String(goal.plannedMonthlyCents / 100) : '')
  const [targetDate, setTargetDate] = useState(goal?.targetDate ? fromTimestamp(goal.targetDate) : '')
  const [scope, setScope] = useState<Scope>(goal?.scope ?? 'shared')
  const [memberId, setMemberId] = useState(goal?.memberId ?? user.uid)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    // Cible facultative : 0 = épargne sans objectif chiffré (bourse, livret…).
    const targetCents = target.trim() ? Math.round(Number(target.replace(',', '.')) * 100) : 0
    if (!name.trim() || !Number.isFinite(targetCents) || targetCents < 0) return setError('Donnez un nom et un montant cible valide (ou laissez-le vide).')
    setError(null)
    setLoading(true)
    const data = {
      name: name.trim(),
      icon,
      color,
      targetCents,
      currentCents: Math.round(Number(current.replace(',', '.') || '0') * 100),
      plannedMonthlyCents: Math.round(Number(monthly.replace(',', '.') || '0') * 100),
      targetDate: targetCents > 0 && targetDate ? toTimestamp(targetDate) : null,
      archived: false,
      scope,
      memberId: scope === 'personal' ? memberId : null,
    }
    try {
      if (goal) await updateSavingsGoal(household.id, goal.id, data, user)
      else await createSavingsGoal(household.id, data, user)
      onClose()
    } catch (err) {
      setError(toUserMessage(err))
    } finally {
      setLoading(false)
    }
  }

  async function onDelete() {
    if (!goal) return
    setLoading(true)
    try {
      await deleteSavingsGoal(household.id, goal.id, user)
      onClose()
    } catch (err) {
      setError(toUserMessage(err))
      setLoading(false)
    }
  }

  return (
    <Sheet open={open} onClose={onClose} title={goal ? "Modifier l'objectif" : "Nouvel objectif d'épargne"}>
      <form className="stack" onSubmit={onSubmit} noValidate>
        {error && <Notice tone="danger">{error}</Notice>}
        <TextField label="Nom" placeholder="Ex. Vacances, Bourse, Sécurité…" maxLength={60} value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        <SegmentedControl
          label="Épargne"
          value={scope}
          onChange={setScope}
          options={[
            { value: 'personal', label: 'Solo' },
            { value: 'shared', label: 'En couple' },
          ]}
        />
        {scope === 'personal' && (
          <Select label="De qui ?" value={memberId} onChange={(e) => setMemberId(e.target.value)}>
            {members.map((m) => (
              <option key={m.uid} value={m.uid}>
                {m.displayName}
              </option>
            ))}
          </Select>
        )}
        <div className="row" style={{ alignItems: 'flex-start' }}>
          <TextField
            label="Montant cible (facultatif)"
            inputMode="decimal"
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            trailing={<span className="subtle">€</span>}
            hint="Vide = épargne sans objectif (ex. bourse)"
          />
          <TextField
            label="Montant actuel"
            inputMode="decimal"
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
            trailing={<span className="subtle">€</span>}
          />
        </div>
        <div className="row" style={{ alignItems: 'flex-start' }}>
          <TextField
            label="Versement mensuel prévu"
            inputMode="decimal"
            value={monthly}
            onChange={(e) => setMonthly(e.target.value)}
            trailing={<span className="subtle">€</span>}
            hint="Ce que vous mettez de côté chaque mois"
          />
          {target.trim() && <TextField label="Date objectif (facultatif)" type="date" value={targetDate} onChange={(e) => setTargetDate(e.target.value)} />}
        </div>
        <div>
          <p
            className="muted"
            style={{
              fontSize: 'var(--text-sm)',
              fontWeight: 550,
              marginBottom: 8,
            }}
          >
            Icône
          </p>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(7, 1fr)',
              gap: 8,
            }}
          >
            {CATEGORY_ICON_NAMES.map((iconName) => (
              <button
                key={iconName}
                type="button"
                onClick={() => setIcon(iconName)}
                aria-label={iconName}
                aria-pressed={icon === iconName}
                style={{
                  display: 'grid',
                  placeItems: 'center',
                  height: 40,
                  borderRadius: 'var(--radius-sm)',
                  border: icon === iconName ? '2px solid var(--accent)' : '1px solid var(--border)',
                  background: icon === iconName ? 'color-mix(in srgb, var(--accent) 14%, transparent)' : 'var(--surface-solid)',
                  color: 'var(--text)',
                  cursor: 'pointer',
                }}
              >
                {createElement(categoryIcon(iconName), { size: 18 })}
              </button>
            ))}
          </div>
        </div>
        <div>
          <p
            className="muted"
            style={{
              fontSize: 'var(--text-sm)',
              fontWeight: 550,
              marginBottom: 8,
            }}
          >
            Couleur
          </p>
          <div style={{ display: 'flex', gap: 8 }}>
            {COLORS.map((tone) => (
              <button
                key={tone}
                type="button"
                onClick={() => setColor(tone)}
                aria-label={tone}
                aria-pressed={color === tone}
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: '50%',
                  background: toneSolid(tone),
                  border: color === tone ? '3px solid var(--text)' : '2px solid transparent',
                  cursor: 'pointer',
                }}
              />
            ))}
          </div>
        </div>
        <Button type="submit" size="lg" block loading={loading}>
          {goal ? 'Enregistrer' : "Créer l'objectif"}
        </Button>
        {goal && (
          <ConfirmButton
            label="Supprimer"
            icon={<Trash2 size={18} />}
            question={`Supprimer l'objectif « ${goal.name} » ?`}
            onConfirm={() => void onDelete()}
            disabled={loading}
          />
        )}
      </form>
    </Sheet>
  )
}
