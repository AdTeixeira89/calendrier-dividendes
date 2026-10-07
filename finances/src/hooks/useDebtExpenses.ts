import { useEffect, useRef } from 'react'
import { useCurrentUser } from '@/hooks/useAuth'
import { useCategories } from '@/hooks/useCategories'
import { useDebts } from '@/hooks/useDebts'
import { useHousehold } from '@/hooks/useHousehold'
import { useOnlineStatus } from '@/hooks/useOnlineStatus'
import { createDueDebtExpenses } from '@/services/recurringExpenseService'
import { reportSyncError } from '@/services/repository'
import { dueDebtPayments } from '@/utils/debtExpenses'

/**
 * Inscrit chaque mensualité de prêt dans les dépenses communes à son jour
 * (« le 5 de chaque mois »). À monter une fois, dans la coque de l'application.
 */
export function useDebtExpenses(): void {
  const user = useCurrentUser()
  const { household, canWrite } = useHousehold()
  const online = useOnlineStatus()
  const debts = useDebts(household.id)
  const categories = useCategories(household.id)
  const handled = useRef(new Set<string>())

  useEffect(() => {
    if (!canWrite || !online || !debts || !categories) return
    const today = new Date()
    const due = debts.flatMap((d) => dueDebtPayments(d, today)).filter((p) => !handled.current.has(p.id))
    if (due.length === 0) return
    due.forEach((p) => handled.current.add(p.id))
    createDueDebtExpenses(household.id, due, categories, user).catch((error) => {
      due.forEach((p) => handled.current.delete(p.id))
      reportSyncError(error)
    })
  }, [canWrite, online, debts, categories, household.id, user])
}
