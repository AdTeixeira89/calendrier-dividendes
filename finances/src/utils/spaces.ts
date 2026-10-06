import type { Expense } from '@/types'

/** Espace de dépenses : « commun » (le foyer) ou l'uid d'un membre (ses dépenses personnelles). */
export type Space = string

export const COMMON_SPACE: Space = 'commun'

/** Espace d'une dépense : commun si partagée, sinon celui du membre concerné (à défaut, de son auteur). */
export function expenseSpace(expense: Pick<Expense, 'scope' | 'memberId' | 'createdBy'>): Space {
  return expense.scope === 'shared' ? COMMON_SPACE : (expense.memberId ?? expense.createdBy)
}

export function inSpace<T extends Pick<Expense, 'scope' | 'memberId' | 'createdBy'>>(expenses: T[], space: Space): T[] {
  return expenses.filter((e) => expenseSpace(e) === space)
}

/** Dépenses communes uniquement : base de tous les totaux et suivis du foyer. */
export function commonExpenses<T extends Pick<Expense, 'scope'>>(expenses: T[]): T[] {
  return expenses.filter((e) => e.scope === 'shared')
}

/** Valeurs `scope` / `memberId` à enregistrer pour un espace choisi. */
export function spaceFields(space: Space, fallbackMemberId: string | null): { scope: 'shared' | 'personal'; memberId: string | null } {
  return space === COMMON_SPACE ? { scope: 'shared', memberId: fallbackMemberId } : { scope: 'personal', memberId: space }
}
