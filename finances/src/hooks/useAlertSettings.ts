import { withDefaultSettings, type AlertSettings } from '@shared/alerts'
import { watchAlertSettings } from '@/services/alertSettingsService'
import { reportSyncError } from '@/services/repository'
import { useKeyedSnapshot } from './useKeyedSnapshot'

export function useAlertSettings(householdId: string): AlertSettings | undefined {
  return useKeyedSnapshot<AlertSettings>(householdId, (onChange) =>
    watchAlertSettings(householdId, onChange, (error) => {
      reportSyncError(error)
      onChange(withDefaultSettings(null))
    }),
  )
}
