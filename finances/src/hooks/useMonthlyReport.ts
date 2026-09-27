import { onSnapshot } from 'firebase/firestore'
import { householdItemDoc } from '@/firebase/paths'
import { reportSyncError } from '@/services/repository'
import type { MonthlyReport } from '@/types'
import type { MonthKey } from '@/utils/month'
import { useKeyedSnapshot } from './useKeyedSnapshot'

/** null = pas encore de bilan généré pour ce mois (généré le 1er du mois suivant). */
export function useMonthlyReport(householdId: string, month: MonthKey): MonthlyReport | null | undefined {
  return useKeyedSnapshot<MonthlyReport | null>(`${householdId}/${month}`, (onChange) =>
    onSnapshot(
      householdItemDoc(householdId, 'reports', month),
      (snap) => onChange(snap.exists() ? (snap.data() as MonthlyReport) : null),
      (error) => {
        reportSyncError(error)
        onChange(null)
      },
    ),
  )
}
