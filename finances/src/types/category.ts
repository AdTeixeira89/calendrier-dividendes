import type { BaseEntity } from './common'

export type CategoryKind = 'expense' | 'income'

/** households/{householdId}/categories/{id} */
export interface Category extends BaseEntity {
  name: string
  kind: CategoryKind
  /** null = catégorie racine ; sinon identifiant de la catégorie parente. */
  parentId: string | null
  /** Nom d'icône lucide-react (voir utils/categoryIcons.ts). */
  icon: string
  /** Teinte du design system (voir components/ui/tone.ts). */
  color: string
  order: number
  archived: boolean
}

/** Catégorie avec ses éventuelles sous-catégories, pour l'affichage en arbre. */
export interface CategoryWithChildren extends Category {
  children: Category[]
}
