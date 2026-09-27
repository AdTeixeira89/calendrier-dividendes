import { watchSavingsGoals } from '@/services/savingsGoalService'
import type { SavingsGoal } from '@/types'
import { useKeyedSnapshot } from './useKeyedSnapshot'

export function useSavingsGoals(householdId: string): SavingsGoal[] | undefined {
  return useKeyedSnapshot<SavingsGoal[]>(householdId, (onChange) => watchSavingsGoals(householdId, onChange, () => onChange([])))
}
