import { Timestamp } from 'firebase/firestore'
import { describe, expect, it } from 'vitest'
import type { RecurringIncome } from '@/types'
import { dueIncomes } from './recurringIncomes'

const stamp = Timestamp.now()
function salary(overrides: Partial<RecurringIncome> = {}): RecurringIncome {
  return {
    id: 'sal', householdId: 'h', label: 'Salaire', amountCents: 215000, type: 'salary', memberId: 'adam', scope: 'personal', dayOfMonth: 28, startMonth: '2026-10', archived: false,
    createdBy: 'adam', createdAt: stamp, updatedBy: 'adam', updatedAt: stamp, ...overrides,
  }
}
const oct4 = new Date(2026, 9, 4)

describe('dueIncomes', () => {
  it('crée le versement du mois en cours, à la personne et au jour prévus', () => {
    const [o, ...rest] = dueIncomes(salary(), ['adam', 'lea'], oct4)
    expect(rest).toEqual([])
    expect(o).toMatchObject({ id: 'sal_2026-10', month: '2026-10', amountCents: 215000, type: 'salary', label: 'Salaire', memberId: 'adam', scope: 'personal' })
    expect(o!.date).toEqual(new Date(2026, 9, 28, 12))
  })

  it('rattrape les mois manqués, sans dépasser le mois en cours', () => {
    expect(dueIncomes(salary({ startMonth: '2026-07' }), ['adam'], oct4).map((o) => o.month)).toEqual(['2026-07', '2026-08', '2026-09', '2026-10'])
  })

  it('ne crée rien avant le mois de départ, pour un revenu arrêté, ni pour un mois supprimé à la main', () => {
    expect(dueIncomes(salary({ startMonth: '2026-11' }), ['adam'], oct4)).toEqual([])
    expect(dueIncomes(salary({ archived: true }), ['adam'], oct4)).toEqual([])
    expect(dueIncomes(salary({ startMonth: '2026-09', skippedMonths: ['2026-09'] }), ['adam'], oct4).map((o) => o.month)).toEqual(['2026-10'])
  })

  it('borne le jour à la fin du mois (versement le 31 → 28 en février)', () => {
    const days = dueIncomes(salary({ startMonth: '2026-01', dayOfMonth: 31 }), ['adam'], new Date(2026, 2, 5)).map((o) => o.date.getDate())
    expect(days).toEqual([31, 28, 31])
  })

  it('attribue au foyer le revenu d’une personne qui a quitté le foyer', () => {
    expect(dueIncomes(salary({ memberId: 'parti' }), ['adam'], oct4)[0]!.memberId).toBeNull()
  })
})
