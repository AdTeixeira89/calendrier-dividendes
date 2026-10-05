import type { Cents } from '@/types'
import type { Expense } from '@/types/expense'
import type { Income } from '@/types/income'
import { sumCents } from './monthlyStats'

/** Répartition mensuelle choisie par une personne : ce qu'elle met de côté avant son reste personnel. */
export interface MemberPlan {
  commonCents: Cents
  savingsCents: Cents
  investCents: Cents
}

/** households/{id}/settings/budgetSplit : un plan par membre (uid). */
export interface BudgetSplitSettings {
  plans: Record<string, MemberPlan>
}

export const EMPTY_PLAN: MemberPlan = { commonCents: 0, savingsCents: 0, investCents: 0 }

export interface MemberSplit extends MemberPlan {
  memberId: string
  /** Revenus du mois reçus par cette personne. */
  salaryCents: Cents
  /** Salaire − commun − épargne − investissement (négatif = répartition supérieure au salaire). */
  remainingCents: Cents
}

export interface HouseholdSplit {
  members: MemberSplit[]
  incomeCents: Cents
  commonCents: Cents
  savingsCents: Cents
  investCents: Cents
  personalCents: Cents
  /** Dépensé sur l'enveloppe commune : dépenses communes + mensualités de prêts. */
  commonSpentCents: Cents
  /** Enveloppe commune − dépensé (négatif = dépassement). */
  commonRemainingCents: Cents
}

export function planIsEmpty(plan: MemberPlan | undefined): boolean {
  return !plan || (plan.commonCents <= 0 && plan.savingsCents <= 0 && plan.investCents <= 0)
}

export function memberSplit(memberId: string, salaryCents: Cents, plan: MemberPlan = EMPTY_PLAN): MemberSplit {
  return {
    memberId,
    salaryCents,
    commonCents: plan.commonCents,
    savingsCents: plan.savingsCents,
    investCents: plan.investCents,
    remainingCents: salaryCents - plan.commonCents - plan.savingsCents - plan.investCents,
  }
}

/**
 * Suit le chemin de l'argent du mois : revenus → budget commun / épargne /
 * investissement / reste personnel, puis dépenses communes → reste de l'enveloppe.
 * Seules les dépenses « communes » (et les prêts) sont prélevées sur l'enveloppe commune.
 */
export function householdSplit(
  memberIds: string[],
  settings: BudgetSplitSettings,
  incomes: Income[],
  expenses: Expense[],
  debtMonthlyCents: Cents,
): HouseholdSplit {
  const members = memberIds.map((id) =>
    memberSplit(
      id,
      sumCents(incomes.filter((i) => i.memberId === id)),
      settings.plans[id],
    ),
  )
  const commonCents = members.reduce((t, m) => t + m.commonCents, 0)
  const commonSpentCents = sumCents(expenses.filter((e) => e.scope === 'shared')) + debtMonthlyCents
  return {
    members,
    incomeCents: sumCents(incomes),
    commonCents,
    savingsCents: members.reduce((t, m) => t + m.savingsCents, 0),
    investCents: members.reduce((t, m) => t + m.investCents, 0),
    personalCents: members.reduce((t, m) => t + m.remainingCents, 0),
    commonSpentCents,
    commonRemainingCents: commonCents - commonSpentCents,
  }
}
