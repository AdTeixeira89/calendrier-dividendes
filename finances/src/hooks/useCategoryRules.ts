import { watchCategoryRules, type StatementMemory } from '@/services/categoryRulesService'
import { reportSyncError } from '@/services/repository'
import { useKeyedSnapshot } from './useKeyedSnapshot'

/** Catégories et frais d'entreprise mémorisés par les imports précédents (undefined pendant le chargement). */
export function useCategoryRules(householdId: string): StatementMemory | undefined {
  return useKeyedSnapshot<StatementMemory>(householdId, (onChange) =>
    watchCategoryRules(householdId, onChange, (error) => {
      reportSyncError(error)
      onChange({ rules: {}, business: {} })
    }),
  )
}
