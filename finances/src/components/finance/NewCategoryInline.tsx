import { useState } from 'react'
import { Plus } from 'lucide-react'
import { Button, Notice, TextField } from '@/components/ui'
import { useCurrentUser } from '@/hooks/useAuth'
import { useHousehold } from '@/hooks/useHousehold'
import { createCategory } from '@/services/categoryService'
import { CATEGORY_ICON_NAMES } from '@/utils/categoryIcons'
import { toUserMessage } from '@/utils/firebaseErrors'

/**
 * Création d'une catégorie sans quitter le formulaire de dépense : un nom suffit
 * (icône et couleur par défaut, modifiables ensuite dans Catégories). La nouvelle
 * catégorie est aussitôt sélectionnée.
 */
export function NewCategoryInline({ onCreated }: { onCreated: (categoryId: string) => void }) {
  const user = useCurrentUser()
  const { household } = useHousehold()
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function create() {
    if (!name.trim()) return setError('Donnez un nom à la catégorie.')
    setError(null)
    setLoading(true)
    try {
      const id = await createCategory(household.id, { name: name.trim(), kind: 'expense', parentId: null, icon: CATEGORY_ICON_NAMES[0]!, color: 'accent', order: 999, archived: false }, user)
      onCreated(id)
      setName('')
      setOpen(false)
    } catch (err) {
      setError(toUserMessage(err))
    } finally {
      setLoading(false)
    }
  }

  if (!open) {
    return (
      <Button variant="ghost" size="sm" icon={<Plus size={16} />} onClick={() => setOpen(true)} style={{ alignSelf: 'flex-start' }}>
        Nouvelle catégorie
      </Button>
    )
  }

  return (
    <div className="stack" role="group" aria-label="Nouvelle catégorie">
      {error && <Notice tone="danger">{error}</Notice>}
      <TextField
        label="Nom de la nouvelle catégorie"
        maxLength={60}
        value={name}
        autoFocus
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            void create()
          }
        }}
      />
      <div className="row">
        <Button variant="secondary" block loading={loading} onClick={() => void create()}>
          Créer la catégorie
        </Button>
        <Button variant="ghost" block onClick={() => setOpen(false)}>
          Annuler
        </Button>
      </div>
    </div>
  )
}
