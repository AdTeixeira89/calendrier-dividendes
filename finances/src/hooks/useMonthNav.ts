import { useCallback, useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'
import { currentBudgetMonthKey } from '@/utils/budgetMonth'
import { currentMonthKey, isValidMonthKey, type MonthKey } from '@/utils/month'

/**
 * Mois sélectionné, piloté par le paramètre d'URL `?mois=AAAA-MM` (partageable, bouton retour fonctionnel).
 * `budget` : mois budgétaire (du 6 au 5) pour les pages de dépenses — du 1er au 5, le mois en cours est encore le précédent.
 */
export function useMonthNav(kind: 'calendar' | 'budget' = 'calendar'): { month: MonthKey; setMonth: (month: MonthKey) => void } {
  const [params, setParams] = useSearchParams()
  const raw = params.get('mois')
  const month = raw && isValidMonthKey(raw) ? raw : kind === 'budget' ? currentBudgetMonthKey() : currentMonthKey()

  const setMonth = useCallback(
    (next: MonthKey) => {
      setParams(
        (prev) => {
          const copy = new URLSearchParams(prev)
          copy.set('mois', next)
          return copy
        },
        { replace: true },
      )
    },
    [setParams],
  )

  return useMemo(() => ({ month, setMonth }), [month, setMonth])
}
