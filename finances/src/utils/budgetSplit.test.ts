import { describe, expect, it } from 'vitest'
import type { Expense } from '@/types/expense'
import type { Income } from '@/types/income'
import { householdSplit, planIsEmpty } from './budgetSplit'

const income = (memberId: string, amountCents: number) => ({ memberId, amountCents }) as Income
const expense = (amountCents: number, scope: 'shared' | 'personal') => ({ amountCents, scope }) as Expense
const plans = {
  a: { commonCents: 150_000, savingsCents: 80_000, investCents: 50_000 },
  b: { commonCents: 130_000, savingsCents: 50_000, investCents: 30_000 },
}

describe('budget commun', () => {
  it('reproduit l’exemple du foyer (2 800 € versés, 2 300 € dépensés, 500 € restants)', () => {
    const result = householdSplit(['a', 'b'], { plans }, [income('a', 350_000), income('b', 250_000)], [expense(180_000, 'shared'), expense(20_000, 'personal')], 50_000)
    expect(result.incomeCents).toBe(600_000)
    expect(result.commonCents).toBe(280_000)
    expect(result.budgetCents).toBe(280_000)
    expect(result.savingsCents).toBe(130_000)
    expect(result.investCents).toBe(80_000)
    expect(result.commonSpentCents).toBe(230_000) // dépense personnelle exclue, prêts inclus
    expect(result.commonRemainingCents).toBe(50_000)
  })

  it('suit le reste de chaque personne à partir de ce qu’elle a versé, jamais de son salaire', () => {
    const result = householdSplit(['a', 'b'], { plans }, [income('a', 999_999), income('b', 1)], [expense(230_000, 'shared')], 0)
    const [a, b] = result.members
    expect(a!.spentShareCents).toBe(123_214) // 150 000 / 280 000 des 230 000
    expect(a!.leftCents).toBe(26_786)
    expect(b!.spentShareCents).toBe(106_786)
    expect(b!.leftCents).toBe(23_214)
    expect(a!.leftCents + b!.leftCents).toBe(result.commonRemainingCents)
  })

  it('un budget global inscrit remplace le total des versements', () => {
    const result = householdSplit(['a', 'b'], { plans }, [], [expense(100_000, 'shared')], 0, 270_000)
    expect(result.budgetCents).toBe(270_000)
    expect(result.commonRemainingCents).toBe(170_000)
  })

  it('signale un dépassement par un reste négatif', () => {
    const result = householdSplit(['a'], { plans: { a: { commonCents: 100_000, savingsCents: 0, investCents: 0 } } }, [], [expense(120_000, 'shared')], 0)
    expect(result.commonRemainingCents).toBe(-20_000)
    expect(result.members[0]!.leftCents).toBe(-20_000)
  })

  it('reconnaît un plan vide', () => {
    expect(planIsEmpty(undefined)).toBe(true)
    expect(planIsEmpty({ commonCents: 0, savingsCents: 0, investCents: 0 })).toBe(true)
    expect(planIsEmpty({ commonCents: 1, savingsCents: 0, investCents: 0 })).toBe(false)
  })
})
