import { watchCategories } from '@/services/categoryService'
import { reportSyncError } from '@/services/repository'
import type { Category, CategoryWithChildren } from '@/types'
import { useKeyedSnapshot } from './useKeyedSnapshot'

export function useCategories(householdId: string, kind?: Category['kind']): Category[] | undefined {
  return useKeyedSnapshot<Category[]>(`${householdId}:${kind ?? 'all'}`, (onChange) =>
    watchCategories(
      householdId,
      (all) => onChange(kind ? all.filter((c) => c.kind === kind) : all),
      (error) => {
        reportSyncError(error)
        onChange([])
      },
    ),
  )
}

/** Catégories actives regroupées par parent, pour l'affichage en arbre et les sélecteurs. */
export function groupByParent(categories: Category[]): CategoryWithChildren[] {
  const roots = categories.filter((c) => !c.parentId && !c.archived)
  return roots.map((root) => ({
    ...root,
    children: categories.filter((c) => c.parentId === root.id && !c.archived),
  }))
}
