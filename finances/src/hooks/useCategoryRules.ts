import { watchCategoryRules } from '@/services/categoryRulesService'
import { reportSyncError } from '@/services/repository'
import type { CategoryRules } from '@/utils/categorize'
import { useKeyedSnapshot } from './useKeyedSnapshot'

/** Catégories mémorisées par les imports précédents (undefined pendant le chargement). */
export function useCategoryRules(householdId: string): CategoryRules | undefined {
  return useKeyedSnapshot<CategoryRules>(householdId, (onChange) =>
    watchCategoryRules(householdId, onChange, (error) => {
      reportSyncError(error)
      onChange({})
    }),
  )
}
