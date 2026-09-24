import { describe, expect, it } from 'vitest'
import { changedFields, pick } from './diff'

describe('journal des modifications', () => {
  it('détecte les champs modifiés en ignorant les champs techniques', () => {
    const before = { amountCents: 1000, label: 'Courses', updatedAt: 1, tags: ['a'] }
    const after = { amountCents: 1200, label: 'Courses', updatedAt: 2, tags: ['a'], note: 'x' }
    expect(changedFields(before, after)).toEqual(['amountCents', 'note'])
  })
  it('gère création et suppression', () => {
    expect(changedFields(null, { a: 1 })).toEqual(['a'])
    expect(changedFields({ a: 1 }, null)).toEqual(['a'])
  })
  it('extrait anciennes et nouvelles valeurs', () => {
    expect(pick({ a: 1, b: 2 }, ['a', 'c'])).toEqual({ a: 1 })
    expect(pick(null, ['a'])).toBeNull()
  })
})
