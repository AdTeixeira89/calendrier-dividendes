import { budgetMonthBounds } from './shared/budgetMonth.js'
import type { Firestore } from 'firebase-admin/firestore'
import { sumCents, savingsRatePercent, type Cents } from './money.js'

export interface FactItem {
  /** Identifiant stable référencé par l'IA dans ses réponses (`source`). */
  key: string
  label: string
  value: string
}

export interface HouseholdFacts {
  month: string
  items: FactItem[]
}

function monthRange(monthKey: string): { start: Date; end: Date } {
  const [year, month] = monthKey.split('-').map(Number)
  const start = new Date(Date.UTC(year!, month! - 1, 1))
  const end = new Date(Date.UTC(year!, month!, 1))
  return { start, end }
}

function formatCents(cents: Cents): string {
  return `${(cents / 100).toFixed(2)} €`
}

/**
 * Calcule les faits financiers d'un foyer pour un mois donné, à partir des
 * données Firestore. Chaque fait porte une `key` stable : l'IA ne peut citer
 * comme source que des clés présentes ici, jamais inventer un chiffre.
 */
export async function computeHouseholdFacts(db: Firestore, householdId: string, monthKey: string): Promise<HouseholdFacts> {
  const { start, end } = monthRange(monthKey)
  // Dépenses : mois budgétaire (du 6 au 5) ; revenus : mois civil.
  const cycle = budgetMonthBounds(monthKey)
  const householdRef = db.collection('households').doc(householdId)

  const [allExpensesSnap, incomesSnap, debtsSnap, goalsSnap, subscriptionsSnap, categoriesSnap] = await Promise.all([
    householdRef.collection('expenses').where('date', '>=', cycle.start).where('date', '<', cycle.end).get(),
    householdRef.collection('incomes').where('date', '>=', start).where('date', '<', end).get(),
    householdRef.collection('debts').where('archived', '==', false).get(),
    householdRef.collection('savingsGoals').where('archived', '==', false).get(),
    householdRef.collection('subscriptions').where('archived', '==', false).get(),
    householdRef.collection('categories').get(),
  ])

  // Dépenses communes seulement : les dépenses personnelles ne se mélangent pas aux suivis du foyer.
  const expensesSnap = { docs: allExpensesSnap.docs.filter((d) => d.data().scope !== 'personal') }

  const categoryNames = new Map(categoriesSnap.docs.map((d) => [d.id, (d.data().name as string) ?? d.id]))

  const totalIncomeCents = sumCents(incomesSnap.docs.map((d) => d.data().amountCents as Cents))
  const totalExpensesCents = sumCents(expensesSnap.docs.map((d) => d.data().amountCents as Cents))
  const rate = savingsRatePercent(totalIncomeCents, totalExpensesCents)

  const items: FactItem[] = [
    { key: 'total_income', label: 'Revenus du mois', value: formatCents(totalIncomeCents) },
    { key: 'total_expenses', label: 'Dépenses du mois', value: formatCents(totalExpensesCents) },
    { key: 'savings_rate', label: "Taux d'épargne du mois", value: rate === null ? 'non calculable (aucun revenu)' : `${rate} %` },
  ]

  const byCategory = new Map<string, Cents>()
  for (const doc of expensesSnap.docs) {
    const data = doc.data()
    const categoryId = data.categoryId as string
    byCategory.set(categoryId, (byCategory.get(categoryId) ?? 0) + (data.amountCents as Cents))
  }
  for (const [categoryId, cents] of byCategory) {
    items.push({
      key: `expense_category_${categoryId}`,
      label: `Dépenses — ${categoryNames.get(categoryId) ?? categoryId}`,
      value: formatCents(cents),
    })
  }

  const totalDebtOutstandingCents = sumCents(debtsSnap.docs.map((d) => d.data().outstandingCents as Cents))
  const totalMonthlyDebtPaymentsCents = sumCents(debtsSnap.docs.map((d) => d.data().monthlyPaymentCents as Cents))
  items.push(
    { key: 'debt_outstanding_total', label: 'Capital restant dû (toutes dettes)', value: formatCents(totalDebtOutstandingCents) },
    { key: 'debt_monthly_total', label: 'Mensualités totales', value: formatCents(totalMonthlyDebtPaymentsCents) },
  )
  for (const doc of debtsSnap.docs) {
    const data = doc.data()
    items.push({
      key: `debt_${doc.id}`,
      label: `Dette — ${data.name as string}`,
      value: `${formatCents(data.outstandingCents as Cents)} restant, mensualité ${formatCents(data.monthlyPaymentCents as Cents)}`,
    })
  }

  for (const doc of goalsSnap.docs) {
    const data = doc.data()
    const target = data.targetCents as Cents
    const current = data.currentCents as Cents
    const progress = target > 0 ? Math.round((current / target) * 1000) / 10 : null
    items.push({
      key: `savings_goal_${doc.id}`,
      label: `Objectif d'épargne — ${data.name as string}`,
      value: `${formatCents(current)} sur ${formatCents(target)}${progress !== null ? ` (${progress} %)` : ''}`,
    })
  }

  const totalSubscriptionsMonthlyCents = sumCents(
    subscriptionsSnap.docs.map((d) => {
      const data = d.data()
      const amount = data.amountCents as Cents
      return data.period === 'yearly' ? Math.round(amount / 12) : amount
    }),
  )
  items.push({ key: 'subscriptions_monthly_total', label: 'Coût mensuel total des abonnements', value: formatCents(totalSubscriptionsMonthlyCents) })

  return { month: monthKey, items }
}
