import { describe, expect, it } from 'vitest'
import type { Expense } from '@/types/expense'
import type { Income } from '@/types/income'
import { householdSplit, memberSplit, planIsEmpty } from './budgetSplit'

const income = (memberId: string, amountCents: number) => ({ memberId, amountCents }) as Income
const expense = (amountCents: number, scope: 'shared' | 'personal') => ({ amountCents, scope }) as Expense

describe('budgetSplit', () => {
  it('calcule le reste personnel d’une personne', () => {
    const split = memberSplit('a', 350_000, { commonCents: 150_000, savingsCents: 80_000, investCents: 50_000 })
    expect(split.remainingCents).toBe(70_000)
  })

  it('reproduit l’exemple du foyer (2 800 € commun, 2 300 € dépensés)', () => {
    const settings = {
      plans: {
        a: { commonCents: 150_000, savingsCents: 80_000, investCents: 50_000 },
        b: { commonCents: 130_000, savingsCents: 50_000, investCents: 30_000 },
      },
    }
    const result = householdSplit(['a', 'b'], settings, [income('a', 350_000), income('b', 250_000)], [expense(180_000, 'shared'), expense(20_000, 'personal')], 50_000)
    expect(result.incomeCents).toBe(600_000)
    expect(result.commonCents).toBe(280_000)
    expect(result.savingsCents).toBe(130_000)
    expect(result.investCents).toBe(80_000)
    expect(result.personalCents).toBe(110_000)
    expect(result.commonSpentCents).toBe(230_000) // dépense personnelle exclue, prêts inclus
    expect(result.commonRemainingCents).toBe(50_000)
  })

  it('signale un dépassement par un reste négatif', () => {
    const result = householdSplit(['a'], { plans: { a: { commonCents: 100_000, savingsCents: 0, investCents: 0 } } }, [], [expense(120_000, 'shared')], 0)
    expect(result.commonRemainingCents).toBe(-20_000)
  })

  it('reconnaît un plan vide', () => {
    expect(planIsEmpty(undefined)).toBe(true)
    expect(planIsEmpty({ commonCents: 0, savingsCents: 0, investCents: 0 })).toBe(true)
    expect(planIsEmpty({ commonCents: 1, savingsCents: 0, investCents: 0 })).toBe(false)
  })
})
