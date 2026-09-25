import { describe, expect, it } from 'vitest'
import { DEFAULT_CATEGORIES } from './defaultCategories'

describe('catégories par défaut', () => {
  it('couvre les postes du cahier des charges, sans doublon', () => {
    const names = DEFAULT_CATEGORIES.map((c) => c.name)
    expect(new Set(names).size).toBe(names.length)
    expect(names).toEqual(
      expect.arrayContaining(['Logement', 'Énergie', 'Alimentation', 'Transport', 'Enfants', 'Impôts', 'Loisirs', 'Finances']),
    )
  })
  it('sont toutes des catégories de dépenses', () => {
    expect(DEFAULT_CATEGORIES.every((c) => c.kind === 'expense')).toBe(true)
  })
})
