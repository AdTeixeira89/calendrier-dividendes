import { useEffect, useRef } from 'react'
import { useCurrentUser } from '@/hooks/useAuth'
import { useHousehold } from '@/hooks/useHousehold'
import { useOnlineStatus } from '@/hooks/useOnlineStatus'
import { useRecurringIncomes } from '@/hooks/useRecurringIncomes'
import { createDueIncomes } from '@/services/recurringIncomeService'
import { reportSyncError } from '@/services/repository'
import { dueIncomes } from '@/utils/recurringIncomes'

/**
 * Crée, à l'ouverture de l'app, les revenus fixes (salaires…) du mois en cours
 * et des mois manqués depuis leur départ. À monter une fois, dans la coque.
 */
export function useAutoIncomes(): void {
  const user = useCurrentUser()
  const { household, members, canWrite } = useHousehold()
  const online = useOnlineStatus()
  const recurring = useRecurringIncomes(household.id)
  const handled = useRef(new Set<string>())

  useEffect(() => {
    if (!canWrite || !online || !recurring) return
    const memberIds = members.map((m) => m.uid)
    const due = recurring.flatMap((r) => dueIncomes(r, memberIds)).filter((o) => !handled.current.has(o.id))
    if (due.length === 0) return
    due.forEach((o) => handled.current.add(o.id))
    createDueIncomes(household.id, due, user).catch((error) => {
      due.forEach((o) => handled.current.delete(o.id))
      reportSyncError(error)
    })
  }, [canWrite, online, recurring, members, household.id, user])
}
