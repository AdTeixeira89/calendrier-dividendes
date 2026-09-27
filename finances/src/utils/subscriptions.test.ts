import { describe, expect, it } from 'vitest'
import { annualCost, monthlyCost, totalAnnualCost, totalMonthlyCost } from './subscriptions'

describe('coûts d’abonnement', () => {
  it('convertit annuel en mensuel et inversement', () => {
    expect(monthlyCost({ amountCents: 1200, period: 'yearly' })).toBe(100)
    expect(monthlyCost({ amountCents: 999, period: 'monthly' })).toBe(999)
    expect(annualCost({ amountCents: 999, period: 'monthly' })).toBe(999 * 12)
    expect(annualCost({ amountCents: 1200, period: 'yearly' })).toBe(1200)
  })
  it('additionne plusieurs abonnements', () => {
    const subs = [
      { amountCents: 999, period: 'monthly' as const },
      { amountCents: 1200, period: 'yearly' as const },
    ]
    expect(totalMonthlyCost(subs)).toBe(999 + 100)
    expect(totalAnnualCost(subs)).toBe(999 * 12 + 1200)
  })
})
