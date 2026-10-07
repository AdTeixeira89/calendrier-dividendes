import type { Category, Cents, Expense } from '@/types'

export interface BreakdownSlice {
  /** Catégorie principale (les sous-catégories sont regroupées dans leur parent) ; null pour « Autres ». */
  categoryId: string | null
  name: string
  color: string
  amountCents: Cents
  /** Part du total, en %, arrondie à 0,1. */
  percent: number
}

export interface Breakdown {
  totalCents: Cents
  slices: BreakdownSlice[]
}

/**
 * Lit les dépenses et leurs catégories et calcule la répartition : chaque dépense est rattachée à
 * sa catégorie principale (une sous-catégorie compte pour son parent), les montants sont additionnés,
 * triés du plus gros au plus petit, et les plus petits postes regroupés en « Autres » au-delà de
 * `maxSlices`. Une dépense dont la catégorie a disparu est rangée en « Sans catégorie ».
 */
export function categoryBreakdown(expenses: Pick<Expense, 'categoryId' | 'amountCents'>[], categories: Category[], maxSlices = 7): Breakdown {
  const byId = new Map(categories.map((c) => [c.id, c]))
  const totals = new Map<string, Cents>()
  for (const expense of expenses) {
    const category = byId.get(expense.categoryId)
    const rootId = category ? (category.parentId && byId.has(category.parentId) ? category.parentId : category.id) : ''
    totals.set(rootId, (totals.get(rootId) ?? 0) + expense.amountCents)
  }

  const totalCents = [...totals.values()].reduce((sum, cents) => sum + cents, 0)
  const percentOf = (cents: Cents) => (totalCents > 0 ? Math.round((cents / totalCents) * 1000) / 10 : 0)
  const all: BreakdownSlice[] = [...totals.entries()]
    .map(([id, amountCents]) => {
      const category = byId.get(id)
      return { categoryId: category ? id : null, name: category?.name ?? 'Sans catégorie', color: category?.color ?? 'accent', amountCents, percent: percentOf(amountCents) }
    })
    .filter((slice) => slice.amountCents > 0)
    .sort((a, b) => b.amountCents - a.amountCents)

  if (all.length <= maxSlices) return { totalCents, slices: all }
  const top = all.slice(0, maxSlices - 1)
  const restCents = all.slice(maxSlices - 1).reduce((sum, slice) => sum + slice.amountCents, 0)
  return { totalCents, slices: [...top, { categoryId: null, name: 'Autres', color: 'warning', amountCents: restCents, percent: percentOf(restCents) }] }
}
