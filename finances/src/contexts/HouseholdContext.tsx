import { createContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useAuth } from '@/hooks/useAuth'
import { watchHousehold, watchMembers } from '@/services/householdService'
import type { Household, HouseholdMember, HouseholdRole } from '@/types'

export interface HouseholdState {
  /** undefined = chargement ; null = aucun foyer actif */
  household: Household | null | undefined
  members: HouseholdMember[]
  role: HouseholdRole | null
  canWrite: boolean
}

const EMPTY: HouseholdMember[] = []

export const HouseholdContext = createContext<HouseholdState | null>(null)

export function HouseholdProvider({ children }: { children: ReactNode }) {
  const { user, profile } = useAuth()
  const householdId = profile?.activeHouseholdId ?? null
  const profileLoaded = profile !== undefined
  // Les instantanés sont indexés par foyer : un changement de foyer actif
  // invalide immédiatement les données précédentes (état « chargement »).
  const [snapshot, setSnapshot] = useState<{ id: string; household: Household | null } | null>(null)
  const [memberSnapshot, setMemberSnapshot] = useState<{ id: string; members: HouseholdMember[] } | null>(null)

  useEffect(() => {
    if (!householdId) return
    // Un foyer illisible (membre retiré, foyer supprimé) est traité comme « aucun foyer ».
    const stopHousehold = watchHousehold(
      householdId,
      (next) => setSnapshot({ id: householdId, household: next }),
      () => setSnapshot({ id: householdId, household: null }),
    )
    const stopMembers = watchMembers(
      householdId,
      (members) => setMemberSnapshot({ id: householdId, members }),
      () => setMemberSnapshot({ id: householdId, members: [] }),
    )
    return () => {
      stopHousehold()
      stopMembers()
    }
  }, [householdId])

  let household: Household | null | undefined
  if (!householdId) household = profileLoaded ? null : undefined
  else household = snapshot?.id === householdId ? snapshot.household : undefined
  const members = householdId && memberSnapshot?.id === householdId ? memberSnapshot.members : EMPTY

  const value = useMemo<HouseholdState>(() => {
    const role = (user && household?.roles[user.uid]) || null
    return { household, members, role, canWrite: role === 'owner' || role === 'member' }
  }, [household, members, user])

  return <HouseholdContext.Provider value={value}>{children}</HouseholdContext.Provider>
}
