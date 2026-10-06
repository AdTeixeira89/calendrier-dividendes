import { Timestamp } from 'firebase/firestore'
import { describe, expect, it } from 'vitest'
import type { Expense } from '@/types'
import { dueCopies, recurrenceRoot } from './recurringCopies'

const stamp = Timestamp.now()
function exp(overrides: Partial<Expense> = {}): Expense {
  return {
    id: 'loyer', householdId: 'h', createdBy: 'adao', createdAt: stamp, updatedBy: 'adao', updatedAt: stamp,
    amountCents: 90000, date: Timestamp.fromDate(new Date(2026, 9, 5, 12)), categoryId: 'logement', merchant: 'Loyer', paymentMethod: 'transfer',
    memberId: 'adao', scope: 'shared', kind: 'recurring', note: 'x', receiptPath: 'tickets/a.png', ...overrides,
  }
}
const nov10 = new Date(2026, 10, 10)

describe('reprise des dépenses récurrentes', () => {
  it('reprend montant, catégorie, libellé, type, espace et jour ; pas le justificatif', () => {
    const [c] = dueCopies([exp()], 'adao', nov10)
    expect(c!.id).toBe('loyer_2026-11')
    expect(c!.data).toMatchObject({ amountCents: 90000, categoryId: 'logement', merchant: 'Loyer', kind: 'recurring', scope: 'shared', memberId: 'adao', recurringDay: 5, autoCopy: true, recurrenceId: 'loyer', receiptPath: null })
    expect(c!.data.date).toEqual(new Date(2026, 10, 5, 12))
  })

  it('ne reprend pas les dépenses non récurrentes', () => {
    expect(dueCopies([exp({ kind: 'one_off' }), exp({ id: 'b', kind: 'exceptional' })], 'adao', nov10)).toEqual([])
  })

  it('ignore celles déjà gérées par un abonnement', () => {
    expect(dueCopies([exp({ recurrenceId: 'abo-eau' })], 'adao', nov10)).toEqual([])
  })

  it('continue la chaîne : une reprise est reprise avec la même origine et le même jour', () => {
    const copy = exp({ id: 'loyer_2026-10', recurrenceId: 'loyer', autoCopy: true, recurringDay: 31, date: Timestamp.fromDate(new Date(2026, 9, 31, 12)) })
    expect(recurrenceRoot(copy)).toBe('loyer')
    const [c] = dueCopies([copy], 'adao', new Date(2026, 11, 31))
    expect(c!.id).toBe('loyer_2026-12')
    expect(c!.data.date).toEqual(new Date(2026, 11, 31, 12))
  })

  it('respecte les reprises supprimées et les jours à venir', () => {
    expect(dueCopies([exp()], 'adao', nov10, ['loyer_2026-11'])).toEqual([])
    expect(dueCopies([exp({ date: Timestamp.fromDate(new Date(2026, 9, 25, 12)) })], 'adao', nov10)).toEqual([])
  })

  it('ne reprend que le commun et ses propres dépenses personnelles ; garde le caractère privé', () => {
    const mine = exp({ id: 'a', scope: 'personal', memberId: 'adao', private: true })
    const hers = exp({ id: 'b', scope: 'personal', memberId: 'angelique', createdBy: 'angelique' })
    const out = dueCopies([mine, hers, exp({ id: 'c' })], 'adao', nov10)
    expect(out.map((c) => c.id).sort()).toEqual(['a_2026-11', 'c_2026-11'])
    expect(out.find((c) => c.id === 'a_2026-11')!.private).toBe(true)
  })
})
