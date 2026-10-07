import type { SavingsGoal } from '@/types'

export type SavingsView = 'common' | 'personal'

/** Épargne commune : objectifs « en couple » (et anciens objectifs, sans espace). Personnelle : ceux de `uid`. */
export function savingsTotal(goals: Pick<SavingsGoal, 'scope' | 'memberId' | 'currentCents'>[], view: SavingsView, uid: string): number {
  return goals
    .filter((g) => (view === 'personal' ? g.scope === 'personal' && g.memberId === uid : g.scope !== 'personal'))
    .reduce((total, g) => total + g.currentCents, 0)
}
