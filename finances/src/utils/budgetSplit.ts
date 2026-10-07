import type { Cents } from '@/types'
import type { Expense } from '@/types/expense'
import type { Income } from '@/types/income'
import { commonBudgetCents } from '@shared/budget'
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
  /** Revenus du mois reçus par cette personne (information : jamais utilisés pour le suivi du budget commun). */
  salaryCents: Cents
  /** Sa part des dépenses communes du mois, proportionnelle à ce qu'elle a versé. */
  spentShareCents: Cents
  /** Ce qu'il reste de sa contribution : versé − sa part des dépenses communes (négatif = part dépassée). */
  leftCents: Cents
}

export interface HouseholdSplit {
  members: MemberSplit[]
  incomeCents: Cents
  /** Total versé au budget commun par l'ensemble des personnes. */
  commonCents: Cents
  /** Budget global des dépenses communes : celui inscrit, sinon le total versé. */
  budgetCents: Cents
  savingsCents: Cents
  investCents: Cents
  /** Dépensé sur le budget commun : dépenses communes (mensualités de prêts comprises, inscrites à leur date). */
  commonSpentCents: Cents
  /** Budget global − dépensé (négatif = dépassement). */
  commonRemainingCents: Cents
}

export function planIsEmpty(plan: MemberPlan | undefined): boolean {
  return !plan || (plan.commonCents <= 0 && plan.savingsCents <= 0 && plan.investCents <= 0)
}

/**
 * Suit le chemin de l'argent du mois, côté budget commun : ce que chacun a versé,
 * le budget global, ce qui est dépensé (dépenses communes et prêts) et ce qu'il reste,
 * pour le foyer et pour chaque personne. Le reste du salaire n'entre pas dans ce suivi.
 */
export function householdSplit(
  memberIds: string[],
  settings: BudgetSplitSettings,
  incomes: Income[],
  expenses: Expense[],
  budgetOverrideCents: Cents | null = null,
): HouseholdSplit {
  const commonCents = memberIds.reduce((t, id) => t + (settings.plans[id]?.commonCents ?? 0), 0)
  const commonSpentCents = sumCents(expenses.filter((e) => e.scope === 'shared'))
  const budgetCents = commonBudgetCents(budgetOverrideCents, Object.fromEntries(memberIds.map((id) => [id, settings.plans[id] ?? EMPTY_PLAN])))
  const members = memberIds.map((id): MemberSplit => {
    const plan = settings.plans[id] ?? EMPTY_PLAN
    const spentShareCents = commonCents > 0 ? Math.round((commonSpentCents * plan.commonCents) / commonCents) : 0
    return {
      memberId: id,
      salaryCents: sumCents(incomes.filter((i) => i.memberId === id)),
      commonCents: plan.commonCents,
      savingsCents: plan.savingsCents,
      investCents: plan.investCents,
      spentShareCents,
      leftCents: plan.commonCents - spentShareCents,
    }
  })
  return {
    members,
    incomeCents: sumCents(incomes),
    commonCents,
    budgetCents,
    savingsCents: members.reduce((t, m) => t + m.savingsCents, 0),
    investCents: members.reduce((t, m) => t + m.investCents, 0),
    commonSpentCents,
    commonRemainingCents: budgetCents - commonSpentCents,
  }
}
