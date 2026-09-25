import { Timestamp } from 'firebase/firestore'
import { describe, expect, it } from 'vitest'
import { buildBudgetLines, sumCents, summarizeMonth, totalsByCategory } from './monthlyStats'
import type { Expense } from '@/types/expense'
import type { Income } from '@/types/income'

function expense(amountCents: number, categoryId: string, kind: Expense['kind'] = 'one_off'): Expense {
  return {
    id: 'e', householdId: 'h', amountCents, date: Timestamp.now(), categoryId, merchant: null,
    paymentMethod: 'card', memberId: null, scope: 'shared', kind, note: null,
    createdBy: 'u', createdAt: Timestamp.now(), updatedBy: 'u', updatedAt: Timestamp.now(),
  }
}

function income(amountCents: number): Income {
  return {
    id: 'i', householdId: 'h', amountCents, date: Timestamp.now(), type: 'salary', label: null,
    memberId: null, scope: 'shared', frequency: 'monthly', note: null,
    createdBy: 'u', createdAt: Timestamp.now(), updatedBy: 'u', updatedAt: Timestamp.now(),
  }
}

describe('sumCents', () => {
  it('additionne les montants', () => {
    expect(sumCents([{ amountCents: 100 }, { amountCents: 250 }])).toBe(350)
    expect(sumCents([])).toBe(0)
  })
})

describe('summarizeMonth', () => {
  it('calcule épargne, taux et reste à vivre (hors charges fixes)', () => {
    const expenses = [expense(200_000, 'logement', 'recurring'), expense(50_000, 'loisirs', 'one_off')]
    const incomes = [income(500_000)]
    const summary = summarizeMonth(expenses, incomes)
    expect(summary.incomeCents).toBe(500_000)
    expect(summary.expenseCents).toBe(250_000)
    expect(summary.savingsCents).toBe(250_000)
    expect(summary.savingsRate).toBeCloseTo(50)
    expect(summary.livingAllowanceCents).toBe(300_000)
  })
  it('taux d’épargne null sans revenu', () => {
    expect(summarizeMonth([], []).savingsRate).toBeNull()
  })
})

describe('totalsByCategory', () => {
  it('agrège par catégorie et trie du plus gros au plus petit', () => {
    const expenses = [expense(1000, 'a'), expense(5000, 'b'), expense(2000, 'a')]
    expect(totalsByCategory(expenses)).toEqual([
      { categoryId: 'b', amountCents: 5000 },
      { categoryId: 'a', amountCents: 3000 },
    ])
  })
})

describe('buildBudgetLines', () => {
  it('fusionne prévu et réel, calcule l’écart', () => {
    const lines = buildBudgetLines({ courses: 60_000, loisirs: 10_000 }, [expense(64_700, 'courses')])
    const courses = lines.find((l) => l.categoryId === 'courses')!
    expect(courses).toEqual({ categoryId: 'courses', plannedCents: 60_000, actualCents: 64_700, varianceCents: 4_700 })
    const loisirs = lines.find((l) => l.categoryId === 'loisirs')!
    expect(loisirs.actualCents).toBe(0)
    expect(loisirs.varianceCents).toBe(-10_000)
  })
  it('inclut une catégorie sans budget mais avec des dépenses', () => {
    const lines = buildBudgetLines({}, [expense(500, 'imprevu')])
    expect(lines).toEqual([{ categoryId: 'imprevu', plannedCents: 0, actualCents: 500, varianceCents: 500 }])
  })
})
