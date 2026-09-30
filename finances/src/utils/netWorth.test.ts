import { Timestamp } from 'firebase/firestore'
import { describe, expect, it } from 'vitest'
import type { Asset, Debt } from '@/types'
import { assetValueAt, netWorthCents, netWorthTrend, totalAssetsCents, totalDebtsOutstandingCents, totalsByAssetType } from './netWorth'

function asset(overrides: Partial<Asset> = {}): Asset {
  return {
    id: 'a', householdId: 'h', name: 'Livret A', type: 'savings', valueCents: 500_000,
    valuedAt: Timestamp.fromDate(new Date('2026-09-01')), history: [], archived: false,
    createdBy: 'u', createdAt: Timestamp.now(), updatedBy: 'u', updatedAt: Timestamp.now(), ...overrides,
  }
}

function debt(overrides: Partial<Debt> = {}): Debt {
  return {
    id: 'd', householdId: 'h', type: 'mortgage', name: 'Prêt maison', lender: null, contractNumber: null,
    principalCents: 20_000_000, outstandingCents: 15_000_000, annualRate: 2, startDate: Timestamp.now(),
    termMonths: 240, monthlyPaymentCents: 90_000, insuranceCents: 0, feesCents: 0, archived: false,
    createdBy: 'u', createdAt: Timestamp.now(), updatedBy: 'u', updatedAt: Timestamp.now(), ...overrides,
  }
}

describe('totalAssetsCents', () => {
  it('additionne les actifs actifs, ignore les archivés', () => {
    expect(totalAssetsCents([asset({ valueCents: 100 }), asset({ valueCents: 200, archived: true }), asset({ valueCents: 50 })])).toBe(150)
  })
})

describe('totalDebtsOutstandingCents', () => {
  it('additionne le capital restant dû des dettes actives', () => {
    expect(totalDebtsOutstandingCents([debt({ outstandingCents: 1000 }), debt({ outstandingCents: 500, archived: true })])).toBe(1000)
  })
})

describe('netWorthCents', () => {
  it('soustrait les dettes des actifs', () => {
    expect(netWorthCents([asset({ valueCents: 300_000 })], [debt({ outstandingCents: 100_000 })])).toBe(200_000)
  })
})

describe('totalsByAssetType', () => {
  it('regroupe par type, trié du plus gros au plus petit', () => {
    const totals = totalsByAssetType([asset({ type: 'savings', valueCents: 1000 }), asset({ type: 'investment', valueCents: 5000 }), asset({ type: 'savings', valueCents: 2000 })])
    expect(totals).toEqual([
      { type: 'investment', valueCents: 5000 },
      { type: 'savings', valueCents: 3000 },
    ])
  })
})

describe('assetValueAt', () => {
  const a = asset({
    valueCents: 5000,
    valuedAt: Timestamp.fromDate(new Date('2026-09-15')),
    history: [{ valueCents: 3000, date: Timestamp.fromDate(new Date('2026-07-01')) }],
  })

  it('retourne la valeur en vigueur à une date donnée', () => {
    expect(assetValueAt(a, new Date('2026-08-01'))).toBe(3000)
    expect(assetValueAt(a, new Date('2026-10-01'))).toBe(5000)
  })

  it("retourne null avant la première valorisation connue (jamais une valeur inventée)", () => {
    expect(assetValueAt(a, new Date('2026-06-01'))).toBeNull()
  })
})

describe('netWorthTrend', () => {
  it("reconstitue l'évolution mois par mois à partir de l'historique des actifs", () => {
    const a = asset({
      valueCents: 5000,
      valuedAt: Timestamp.fromDate(new Date('2026-09-15')),
      history: [{ valueCents: 3000, date: Timestamp.fromDate(new Date('2026-07-01')) }],
    })
    const trend = netWorthTrend([a], [debt({ outstandingCents: 1000 })], ['2026-07', '2026-08', '2026-09'])
    expect(trend).toEqual([
      { month: '2026-07', netWorthCents: 2000 },
      { month: '2026-08', netWorthCents: 2000 },
      { month: '2026-09', netWorthCents: 4000 },
    ])
  })

  it('omet les mois antérieurs à la première valorisation au lieu de montrer « dettes seules »', () => {
    const a = asset({ valueCents: 5000, valuedAt: Timestamp.fromDate(new Date('2026-09-15')), history: [] })
    const trend = netWorthTrend([a], [debt({ outstandingCents: 1000 })], ['2026-07', '2026-08', '2026-09'])
    expect(trend).toEqual([{ month: '2026-09', netWorthCents: 4000 }])
  })
})
