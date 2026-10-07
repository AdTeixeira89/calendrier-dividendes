import { Timestamp } from 'firebase/firestore'
import { describe, expect, it } from 'vitest'
import type { Category } from '@/types'
import { categoryBreakdown } from './categoryBreakdown'

const stamp = Timestamp.now()
const cat = (id: string, name: string, parentId: string | null = null): Category => ({
  id, name, parentId, householdId: 'h', createdBy: 'u', createdAt: stamp, updatedBy: 'u', updatedAt: stamp, kind: 'expense', icon: 'x', color: 'accent', order: 0, archived: false,
})
const e = (categoryId: string, amountCents: number) => ({ categoryId, amountCents })
const categories = [cat('logement', 'Logement'), cat('loyer', 'Loyer', 'logement'), cat('alim', 'Alimentation'), cat('credits', 'Crédits')]

describe('répartition des dépenses par catégorie', () => {
  it('additionne par catégorie, regroupe les sous-catégories dans leur parent et trie', () => {
    const { totalCents, slices } = categoryBreakdown([e('alim', 30000), e('loyer', 70000), e('logement', 20000), e('credits', 100000), e('alim', 10000)], categories)
    expect(totalCents).toBe(230000)
    expect(slices.map((s) => [s.name, s.amountCents])).toEqual([['Crédits', 100000], ['Logement', 90000], ['Alimentation', 40000]])
    expect(slices.map((s) => s.percent)).toEqual([43.5, 39.1, 17.4])
  })

  it('range en « Sans catégorie » une dépense dont la catégorie a disparu', () => {
    const { slices } = categoryBreakdown([e('supprimee', 5000), e('alim', 5000)], categories)
    expect(slices.map((s) => s.name).sort()).toEqual(['Alimentation', 'Sans catégorie'])
  })

  it('regroupe les plus petits postes en « Autres »', () => {
    const many = Array.from({ length: 10 }, (_, i) => cat(`c${i}`, `Cat ${i}`))
    const { slices, totalCents } = categoryBreakdown(many.map((c, i) => e(c.id, (10 - i) * 1000)), many, 4)
    expect(slices).toHaveLength(4)
    expect(slices[3]!.name).toBe('Autres')
    expect(slices.reduce((t, s) => t + s.amountCents, 0)).toBe(totalCents)
  })

  it('renvoie une répartition vide sans dépense', () => {
    expect(categoryBreakdown([], categories)).toEqual({ totalCents: 0, slices: [] })
  })
})
