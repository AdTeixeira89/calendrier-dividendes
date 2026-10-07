import { Timestamp } from 'firebase/firestore'
import { describe, expect, it } from 'vitest'
import type { Category, Debt } from '@/types'
import { dueDebtPayments, findCreditsCategory, monthlyDebit } from './debtExpenses'

const at = (y: number, m: number, d: number) => Timestamp.fromDate(new Date(y, m - 1, d, 12))
function debt(overrides: Partial<Debt> = {}): Debt {
  return {
    id: 'pret', householdId: 'h', createdBy: 'u', createdAt: at(2026, 10, 2), updatedBy: 'u', updatedAt: at(2026, 10, 2),
    type: 'mortgage', name: 'Prêt maison', lender: null, contractNumber: null, principalCents: 20000000, outstandingCents: 15000000, annualRate: 3,
    startDate: at(2026, 10, 5), termMonths: 240, monthlyPaymentCents: 90000, insuranceCents: 5000, feesCents: 0, archived: false, ...overrides,
  }
}

describe('mensualités de prêt en dépenses', () => {
  it('comptabilise mensualité + assurance le jour indiqué (le 5)', () => {
    expect(monthlyDebit(debt())).toBe(95000)
    expect(dueDebtPayments(debt(), new Date(2026, 9, 4))).toEqual([])
    const [p] = dueDebtPayments(debt(), new Date(2026, 9, 5, 9))
    expect(p).toMatchObject({ id: 'pret_2026-10', month: '2026-10', amountCents: 95000, merchant: 'Prêt maison' })
    expect(p!.date).toEqual(new Date(2026, 9, 5, 12))
  })

  it('continue chaque mois, au même jour', () => {
    const dates = dueDebtPayments(debt(), new Date(2026, 11, 20)).map((p) => p.date.getDate() + '/' + (p.date.getMonth() + 1))
    expect(dates).toEqual(['5/10', '5/11', '5/12'])
  })

  it('ne rattrape pas les années d’un prêt ancien : le suivi part de la saisie', () => {
    const old = debt({ startDate: at(2019, 3, 15), createdAt: at(2026, 9, 20), termMonths: 300 })
    expect(dueDebtPayments(old, new Date(2026, 9, 20)).map((p) => p.month)).toEqual(['2026-09', '2026-10'])
  })

  it('borne le jour à la fin du mois (31 → 30)', () => {
    const d = debt({ startDate: at(2026, 8, 31), createdAt: at(2026, 8, 31) })
    expect(dueDebtPayments(d, new Date(2026, 10, 30)).map((p) => p.date.getDate())).toEqual([31, 30, 31, 30])
  })

  it('s’arrête en fin de durée, si soldé, archivé, ou mois supprimé à la main', () => {
    const short = debt({ termMonths: 2, startDate: at(2026, 8, 5), createdAt: at(2026, 8, 5) })
    expect(dueDebtPayments(short, new Date(2026, 11, 20)).map((p) => p.month)).toEqual(['2026-08', '2026-09'])
    expect(dueDebtPayments(debt({ outstandingCents: 0 }), new Date(2026, 9, 20))).toEqual([])
    expect(dueDebtPayments(debt({ archived: true }), new Date(2026, 9, 20))).toEqual([])
    expect(dueDebtPayments({ ...debt(), skippedMonths: ['2026-10'] } as Debt, new Date(2026, 9, 20))).toEqual([])
  })

  it('retrouve une catégorie « Crédits »', () => {
    const base = { householdId: 'h', createdBy: 'u', createdAt: at(2026, 1, 1), updatedBy: 'u', updatedAt: at(2026, 1, 1), kind: 'expense', parentId: null, icon: 'x', color: 'debt', order: 0, archived: false } as const
    const cats: Category[] = [{ ...base, id: 'a', name: 'Logement' }, { ...base, id: 'b', name: 'Crédits' }]
    expect(findCreditsCategory(cats)?.id).toBe('b')
    expect(findCreditsCategory([cats[0]!])).toBeUndefined()
  })
})
