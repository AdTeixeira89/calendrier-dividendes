import { useEffect, useRef } from 'react'
import { useCurrentUser } from '@/hooks/useAuth'
import { useHousehold } from '@/hooks/useHousehold'
import { useCalendarMonthExpenses } from '@/hooks/useMonthlyExpenses'
import { useOnlineStatus } from '@/hooks/useOnlineStatus'
import { createDueCopies } from '@/services/recurringExpenseService'
import { reportSyncError } from '@/services/repository'
import { skippedCopies } from '@/services/expenseService'
import { currentMonthKey, previousMonthKey } from '@/utils/month'
import { dueCopies } from '@/utils/recurringCopies'

/**
 * Au début d'un mois, reprend les dépenses « Récurrentes » du mois précédent (avec
 * leur montant, catégorie, libellé, espace et jour) ; les autres ne sont pas copiées.
 * À monter une fois, dans la coque de l'application.
 */
export function useMonthlyCopies(): void {
  const user = useCurrentUser()
  const { household, canWrite } = useHousehold()
  const online = useOnlineStatus()
  const previous = useCalendarMonthExpenses(household.id, previousMonthKey(currentMonthKey()))
  const handled = useRef(new Set<string>())

  useEffect(() => {
    if (!canWrite || !online || !previous) return
    const candidates = dueCopies(previous, user.uid, new Date()).filter((c) => !handled.current.has(c.id))
    if (candidates.length === 0) return
    candidates.forEach((c) => handled.current.add(c.id))
    void (async () => {
      try {
        const skipped = await skippedCopies(household.id)
        const copies = candidates.filter((c) => !skipped.includes(c.id))
        await createDueCopies(household.id, copies, user)
      } catch (error) {
        candidates.forEach((c) => handled.current.delete(c.id))
        reportSyncError(error)
      }
    })()
  }, [canWrite, online, previous, household.id, user])
}
