import { useContext } from 'react'
import { HouseholdContext, type HouseholdState } from '@/contexts/HouseholdContext'
import type { Household } from '@/types'

export function useHouseholdState(): HouseholdState {
  const ctx = useContext(HouseholdContext)
  if (!ctx) throw new Error('useHousehold doit être utilisé dans <HouseholdProvider>')
  return ctx
}

/** Foyer actif garanti (à utiliser sous une route qui exige un foyer). */
export function useHousehold(): HouseholdState & { household: Household } {
  const state = useHouseholdState()
  if (!state.household) throw new Error('Aucun foyer actif')
  return state as HouseholdState & { household: Household }
}
