import type { CategoryKind } from '@/types/category'
import type { Tone } from '@/components/ui/tone'

export interface DefaultCategory {
  name: string
  icon: string
  color: Tone
  kind: CategoryKind
}

/**
 * Catégories créées automatiquement à la création d'un foyer (cahier des
 * charges §7). L'utilisateur peut ensuite les renommer, en ajouter, en
 * archiver, ou créer des sous-catégories.
 */
export const DEFAULT_CATEGORIES: DefaultCategory[] = [
  { name: 'Logement', icon: 'home', color: 'saving', kind: 'expense' },
  { name: 'Énergie', icon: 'zap', color: 'warning', kind: 'expense' },
  { name: 'Communication', icon: 'wifi', color: 'accent', kind: 'expense' },
  { name: 'Alimentation', icon: 'shopping-cart', color: 'expense', kind: 'expense' },
  { name: 'Transport', icon: 'car', color: 'debt', kind: 'expense' },
  { name: 'Enfants', icon: 'baby', color: 'income', kind: 'expense' },
  { name: 'Impôts', icon: 'landmark', color: 'danger', kind: 'expense' },
  { name: 'Loisirs', icon: 'ticket', color: 'saving', kind: 'expense' },
  { name: 'Finances', icon: 'piggy-bank', color: 'accent', kind: 'expense' },
  { name: 'Autres', icon: 'more-horizontal', color: 'warning', kind: 'expense' },
]
