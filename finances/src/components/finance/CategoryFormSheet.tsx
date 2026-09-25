import { useState, type FormEvent } from 'react'
import { Trash2 } from 'lucide-react'
import { Button, Notice, Select, Sheet, TextField } from '@/components/ui'
import { useCurrentUser } from '@/hooks/useAuth'
import { useHousehold } from '@/hooks/useHousehold'
import { createCategory, deleteCategory, updateCategory } from '@/services/categoryService'
import type { Category } from '@/types'
import { CATEGORY_ICON_NAMES, categoryIcon } from '@/utils/categoryIcons'
import { toUserMessage } from '@/utils/firebaseErrors'
import { toneColor, type Tone } from '@/components/ui/tone'

const COLORS: Tone[] = ['accent', 'income', 'expense', 'saving', 'debt', 'warning', 'danger']

interface CategoryFormSheetProps {
  open: boolean
  onClose: () => void
  roots: Category[]
  category?: Category
  /** Catégorie parente présélectionnée, pour « Ajouter une sous-catégorie ». */
  defaultParentId?: string | null
}

export function CategoryFormSheet({ open, onClose, roots, category, defaultParentId = null }: CategoryFormSheetProps) {
  const user = useCurrentUser()
  const { household } = useHousehold()
  const [name, setName] = useState(category?.name ?? '')
  const [icon, setIcon] = useState(category?.icon ?? CATEGORY_ICON_NAMES[0]!)
  const [color, setColor] = useState<Tone>((category?.color as Tone) ?? 'accent')
  const [parentId, setParentId] = useState<string>(category?.parentId ?? defaultParentId ?? '')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    if (!name.trim()) return setError('Donnez un nom à la catégorie.')
    setError(null)
    setLoading(true)
    const data = { name: name.trim(), kind: 'expense' as const, parentId: parentId || null, icon, color, order: category?.order ?? 999, archived: false }
    try {
      if (category) await updateCategory(household.id, category.id, data, user)
      else await createCategory(household.id, data, user)
      onClose()
    } catch (err) {
      setError(toUserMessage(err))
    } finally {
      setLoading(false)
    }
  }

  async function onDelete() {
    if (!category || !confirm(`Supprimer « ${category.name} » ? Les dépenses déjà enregistrées la garderont en référence, mais elle disparaîtra des listes.`)) return
    setLoading(true)
    try {
      await deleteCategory(household.id, category.id, user)
      onClose()
    } catch (err) {
      setError(toUserMessage(err))
      setLoading(false)
    }
  }

  return (
    <Sheet open={open} onClose={onClose} title={category ? 'Modifier la catégorie' : 'Nouvelle catégorie'}>
      <form className="stack" onSubmit={onSubmit} noValidate>
        {error && <Notice tone="danger">{error}</Notice>}
        <TextField label="Nom" maxLength={60} value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        <Select label="Catégorie parente (facultatif)" value={parentId} onChange={(e) => setParentId(e.target.value)}>
          <option value="">Aucune (catégorie principale)</option>
          {roots
            .filter((r) => r.id !== category?.id)
            .map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
        </Select>
        <div>
          <p className="muted" style={{ fontSize: 'var(--text-sm)', fontWeight: 550, marginBottom: 8 }}>
            Icône
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 8 }}>
            {CATEGORY_ICON_NAMES.map((iconName) => {
              const Icon = categoryIcon(iconName)
              const selected = icon === iconName
              return (
                <button
                  key={iconName}
                  type="button"
                  onClick={() => setIcon(iconName)}
                  style={{
                    display: 'grid',
                    placeItems: 'center',
                    height: 40,
                    borderRadius: 'var(--radius-sm)',
                    border: selected ? '2px solid var(--accent)' : '1px solid var(--border)',
                    background: selected ? 'color-mix(in srgb, var(--accent) 14%, transparent)' : 'var(--surface-solid)',
                    color: 'var(--text)',
                    cursor: 'pointer',
                  }}
                  aria-label={iconName}
                  aria-pressed={selected}
                >
                  <Icon size={18} />
                </button>
              )
            })}
          </div>
        </div>
        <div>
          <p className="muted" style={{ fontSize: 'var(--text-sm)', fontWeight: 550, marginBottom: 8 }}>
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
                  background: toneColor(tone),
                  border: color === tone ? '3px solid var(--text)' : '2px solid transparent',
                  cursor: 'pointer',
                }}
              />
            ))}
          </div>
        </div>
        <Button type="submit" size="lg" block loading={loading}>
          {category ? 'Enregistrer' : 'Créer la catégorie'}
        </Button>
        {category && (
          <Button type="button" variant="danger" icon={<Trash2 size={18} />} onClick={() => void onDelete()}>
            Supprimer
          </Button>
        )}
      </form>
    </Sheet>
  )
}
