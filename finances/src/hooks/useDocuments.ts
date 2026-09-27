import { watchDocuments } from '@/services/documentService'
import { reportSyncError } from '@/services/repository'
import type { AppDocument } from '@/types'
import { useKeyedSnapshot } from './useKeyedSnapshot'

export function useDocuments(householdId: string): AppDocument[] | undefined {
  return useKeyedSnapshot<AppDocument[]>(householdId, (onChange) =>
    watchDocuments(householdId, onChange, (error) => {
      reportSyncError(error)
      onChange([])
    }),
  )
}
