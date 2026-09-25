import { useCallback, useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'
import { currentMonthKey, isValidMonthKey, type MonthKey } from '@/utils/month'

/** Mois sélectionné, piloté par le paramètre d'URL `?mois=AAAA-MM` (partageable, bouton retour fonctionnel). */
export function useMonthNav(): { month: MonthKey; setMonth: (month: MonthKey) => void } {
  const [params, setParams] = useSearchParams()
  const raw = params.get('mois')
  const month = raw && isValidMonthKey(raw) ? raw : currentMonthKey()

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
