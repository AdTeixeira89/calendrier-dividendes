import { describe, expect, it } from 'vitest'
import { aggregateDebts, debtProgress, estimatedPayoffDate, monthsRemaining, projectCombinedYearlyBalances, projectYearlyBalances } from './debt'
import type { Debt } from '@/types/debt'
import { Timestamp } from 'firebase/firestore'

function debt(overrides: Partial<Debt>): Debt {
  return {
    id: 'd', householdId: 'h', type: 'mortgage', name: 'Prêt', lender: null, contractNumber: null,
    principalCents: 200_000_00, outstandingCents: 44_000_00, annualRate: 1.5, startDate: Timestamp.now(),
    termMonths: 240, monthlyPaymentCents: 900_00, insuranceCents: 20_00, feesCents: 0, archived: false,
    createdBy: 'u', createdAt: Timestamp.now(), updatedBy: 'u', updatedAt: Timestamp.now(),
    ...overrides,
  }
}

describe('debtProgress', () => {
  it('calcule le pourcentage remboursé', () => {
    expect(debtProgress(200_000_00, 44_000_00)).toBeCloseTo(78)
  })
  it('borne entre 0 et 100', () => {
    expect(debtProgress(0, 0)).toBe(0)
    expect(debtProgress(1000, 2000)).toBe(0)
  })
})

describe('monthsRemaining', () => {
  it('arrondit au mois supérieur', () => {
    expect(monthsRemaining(48_00, 10_00)).toBe(5)
  })
  it('0 si déjà soldé, null sans mensualité', () => {
    expect(monthsRemaining(0, 500)).toBe(0)
    expect(monthsRemaining(1000, 0)).toBeNull()
  })
})

describe('estimatedPayoffDate', () => {
  it('projette la date de fin', () => {
    const from = new Date(2026, 8, 24)
    expect(estimatedPayoffDate(48_00, 10_00, from)).toEqual(new Date(2027, 1, 24))
  })
})

describe('projectYearlyBalances', () => {
  it('diminue chaque année et ne descend jamais sous zéro', () => {
    const from = new Date(2026, 0, 1)
    const points = projectYearlyBalances(100_000, 5_000, 3, from)
    expect(points.map((p) => p.year)).toEqual([2026, 2027, 2028, 2029])
    expect(points[0]!.outstandingCents).toBe(100_000)
    expect(points[1]!.outstandingCents).toBe(40_000)
    expect(points[2]!.outstandingCents).toBe(0)
    expect(points[3]!.outstandingCents).toBe(0)
  })
})

describe('aggregateDebts', () => {
  it('agrège plusieurs prêts', () => {
    const debts = [debt({ principalCents: 200_000_00, outstandingCents: 44_000_00, monthlyPaymentCents: 900_00, insuranceCents: 20_00 }), debt({ principalCents: 15_000_00, outstandingCents: 5_000_00, monthlyPaymentCents: 300_00, insuranceCents: 0 })]
    const agg = aggregateDebts(debts, new Date(2026, 8, 24))
    expect(agg.totalPrincipalCents).toBe(215_000_00)
    expect(agg.totalOutstandingCents).toBe(49_000_00)
    expect(agg.totalPaidCents).toBe(166_000_00)
    expect(agg.percentPaid).toBeCloseTo((166_000_00 / 215_000_00) * 100)
    expect(agg.totalMonthlyCents).toBe(900_00 + 20_00 + 300_00)
    expect(agg.debtFreeDate).not.toBeNull()
  })
  it('gère une liste vide', () => {
    const agg = aggregateDebts([])
    expect(agg.totalPrincipalCents).toBe(0)
    expect(agg.percentPaid).toBe(0)
    expect(agg.debtFreeDate).toBeNull()
  })
})

describe('projectCombinedYearlyBalances', () => {
  it('additionne la projection de chaque prêt', () => {
    const from = new Date(2026, 0, 1)
    const debts = [debt({ outstandingCents: 100_000, monthlyPaymentCents: 5_000 }), debt({ outstandingCents: 50_000, monthlyPaymentCents: 5_000 })]
    const points = projectCombinedYearlyBalances(debts, 2, from)
    expect(points[0]!.outstandingCents).toBe(150_000)
    // Prêt 1 : 100 000 − 60 000 = 40 000 ; prêt 2 : 50 000 − 60 000 → plafonné à 0.
    expect(points[1]!.outstandingCents).toBe(40_000)
  })
})
