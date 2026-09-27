import { watchSubscriptions } from '@/services/subscriptionService'
import { reportSyncError } from '@/services/repository'
import type { Subscription } from '@/types'
import { useKeyedSnapshot } from './useKeyedSnapshot'

export function useSubscriptions(householdId: string): Subscription[] | undefined {
  return useKeyedSnapshot<Subscription[]>(householdId, (onChange) =>
    watchSubscriptions(householdId, onChange, (error) => {
      reportSyncError(error)
      onChange([])
    }),
  )
}
