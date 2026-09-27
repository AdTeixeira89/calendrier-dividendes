import { watchDebts } from '@/services/debtService'
import type { Debt } from '@/types'
import { useKeyedSnapshot } from './useKeyedSnapshot'

export function useDebts(householdId: string): Debt[] | undefined {
  return useKeyedSnapshot<Debt[]>(householdId, (onChange) => watchDebts(householdId, onChange, () => onChange([])))
}
