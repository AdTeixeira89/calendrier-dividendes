import { useEffect, useRef } from 'react'
import { useCurrentUser } from '@/hooks/useAuth'
import { useCategories } from '@/hooks/useCategories'
import { useHousehold } from '@/hooks/useHousehold'
import { useOnlineStatus } from '@/hooks/useOnlineStatus'
import { useSubscriptions } from '@/hooks/useSubscriptions'
import { reportSyncError } from '@/services/repository'
import { createDueExpenses } from '@/services/recurringExpenseService'
import { updateSubscription } from '@/services/subscriptionService'
import { monthKey } from '@/utils/month'
import { dueOccurrences } from '@/utils/recurringExpenses'

/**
 * Crée, à l'ouverture de l'app, les dépenses automatiques des abonnements et
 * charges fixes pour le mois en cours (et les mois manqués depuis leur départ).
 * À monter une fois, dans la coque de l'application.
 */
export function useRecurringExpenses(): void {
  const user = useCurrentUser()
  const { household, canWrite } = useHousehold()
  const online = useOnlineStatus()
  const subscriptions = useSubscriptions(household.id)
  const categories = useCategories(household.id)
  // Occurrences déjà traitées pendant cette session : évite de relire la base à chaque instantané.
  const handled = useRef(new Set<string>())

  useEffect(() => {
    if (!canWrite || !online || !subscriptions || !categories) return
    const today = new Date()

    // Abonnements antérieurs à cette fonction : le suivi démarre ce mois-ci, sans rattrapage du passé.
    for (const s of subscriptions) {
      if (!s.startMonth && !handled.current.has(`start:${s.id}`)) {
        handled.current.add(`start:${s.id}`)
        updateSubscription(household.id, s.id, { startMonth: monthKey(today) }, user).catch(reportSyncError)
      }
    }

    const due = subscriptions.flatMap((s) => dueOccurrences(s, categories, today)).filter((o) => !handled.current.has(o.id))
    if (due.length === 0) return
    due.forEach((o) => handled.current.add(o.id))
    createDueExpenses(household.id, due, user).catch((error) => {
      due.forEach((o) => handled.current.delete(o.id))
      reportSyncError(error)
    })
  }, [canWrite, online, subscriptions, categories, household.id, user])
}
