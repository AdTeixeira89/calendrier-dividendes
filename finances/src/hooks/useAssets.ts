import { watchAssets } from '@/services/assetService'
import { reportSyncError } from '@/services/repository'
import type { Asset } from '@/types'
import { useKeyedSnapshot } from './useKeyedSnapshot'

export function useAssets(householdId: string): Asset[] | undefined {
  return useKeyedSnapshot<Asset[]>(householdId, (onChange) =>
    watchAssets(householdId, onChange, (error) => {
      reportSyncError(error)
      onChange([])
    }),
  )
}
