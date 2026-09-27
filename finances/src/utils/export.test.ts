import { Timestamp } from 'firebase/firestore'
import { describe, expect, it } from 'vitest'
import type { Category, Debt, Expense, Income, SavingsGoal, Subscription } from '@/types'
import { buildFinancialSummaryText, buildTransactionsCsv } from './export'

const normalize = (s: string) => s.replace(/[\u00a0\u202f]/g, ' ')

function expense(overrides: Partial<Expense> = {}): Expense {
  return {
    id: 'e', householdId: 'h', amountCents: 4200, date: Timestamp.fromDate(new Date('2026-09-05')), categoryId: 'alimentation',
    merchant: 'Leclerc', paymentMethod: 'card', memberId: null, scope: 'shared', kind: 'one_off', receiptPath: null, note: null,
    createdBy: 'u', createdAt: Timestamp.now(), updatedBy: 'u', updatedAt: Timestamp.now(), ...overrides,
  }
}

function income(overrides: Partial<Income> = {}): Income {
  return {
    id: 'i', householdId: 'h', amountCents: 300_000, date: Timestamp.fromDate(new Date('2026-09-01')), type: 'salary', label: 'Salaire',
    memberId: null, scope: 'shared', frequency: 'monthly', note: null,
    createdBy: 'u', createdAt: Timestamp.now(), updatedBy: 'u', updatedAt: Timestamp.now(), ...overrides,
  }
}

const categories: Category[] = [
  { id: 'alimentation', householdId: 'h', name: 'Alimentation', kind: 'expense', parentId: null, icon: 'shopping-cart', color: 'coral', order: 0, archived: false, createdBy: 'u', createdAt: Timestamp.now(), updatedBy: 'u', updatedAt: Timestamp.now() },
]

describe('buildTransactionsCsv', () => {
  it('inclut un en-tête et une ligne par dépense/revenu, triées', () => {
    const csv = buildTransactionsCsv([expense()], [income()], categories)
    const rows = csv.split('\n')
    expect(rows[0]).toBe('Date;Type;Catégorie;Montant (€);Libellé;Mode de paiement;Portée')
    expect(rows).toHaveLength(3)
    expect(csv).toContain('Alimentation')
    expect(csv).toContain('42.00')
    expect(csv).toContain('3000.00')
  })

  it('échappe les champs contenant un point-virgule ou des guillemets', () => {
    const csv = buildTransactionsCsv([expense({ merchant: 'Café "Le Central"; centre-ville' })], [], categories)
    expect(csv).toContain('"Café ""Le Central""; centre-ville"')
  })
})

describe('buildFinancialSummaryText', () => {
  const debts: Debt[] = [
    { id: 'd', householdId: 'h', type: 'mortgage', name: 'Prêt maison', lender: null, contractNumber: null, principalCents: 20_000_000, outstandingCents: 15_000_000, annualRate: 2, startDate: Timestamp.now(), termMonths: 240, monthlyPaymentCents: 90_000, insuranceCents: 0, feesCents: 0, archived: false, createdBy: 'u', createdAt: Timestamp.now(), updatedBy: 'u', updatedAt: Timestamp.now() },
  ]
  const savingsGoals: SavingsGoal[] = [
    { id: 'g', householdId: 'h', name: 'Vacances', icon: 'plane', color: 'mint', targetCents: 200_000, currentCents: 50_000, targetDate: null, plannedMonthlyCents: 10_000, archived: false, createdBy: 'u', createdAt: Timestamp.now(), updatedBy: 'u', updatedAt: Timestamp.now() },
  ]
  const subscriptions: Subscription[] = [
    { id: 's', householdId: 'h', name: 'Netflix', amountCents: 1500, period: 'monthly', categoryId: null, nextDate: null, usage: 'frequent', archived: false, createdBy: 'u', createdAt: Timestamp.now(), updatedBy: 'u', updatedAt: Timestamp.now() },
  ]

  it("calcule les totaux et le taux d'épargne, sans jamais inventer de valeur absente", () => {
    const text = normalize(
      buildFinancialSummaryText({
        periodLabel: 'septembre 2026',
        expenses: [expense()],
        incomes: [income()],
        categories,
        debts,
        savingsGoals,
        subscriptions,
      }),
    )
    expect(text).toContain('septembre 2026')
    expect(text).toContain('Revenus totaux : 3 000,00 €')
    expect(text).toContain('Dépenses totales : 42,00 €')
    expect(text).toContain("taux d'épargne : 98.6 %")
    expect(text).toContain('Alimentation : 42,00 €')
    expect(text).toContain('Prêt maison')
    expect(text).toContain('Vacances')
    expect(text).toContain('Netflix')
  })

  it('omet les sections vides plutôt que d\'afficher des tableaux vides', () => {
    const text = buildFinancialSummaryText({
      periodLabel: 'septembre 2026',
      expenses: [],
      incomes: [],
      categories,
      debts: [],
      savingsGoals: [],
      subscriptions: [],
    })
    expect(text).not.toContain('Dépenses par catégorie')
    expect(text).not.toContain('Dettes en cours')
    expect(text).not.toContain("Objectifs d'épargne")
    expect(text).not.toContain('Abonnements')
  })
})
