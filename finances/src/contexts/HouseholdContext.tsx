import { createContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { FirebaseError } from 'firebase/app'
import { useAuth } from '@/hooks/useAuth'
import { recoverActiveHousehold, watchHousehold, watchMembers } from '@/services/householdService'
import type { Household, HouseholdMember, HouseholdRole } from '@/types'

export interface HouseholdState {
  /** undefined = chargement ; null = aucun foyer actif */
  household: Household | null | undefined
  members: HouseholdMember[]
  role: HouseholdRole | null
  canWrite: boolean
}

const EMPTY: HouseholdMember[] = []
const RETRY_DELAY_MS = 3000

export const HouseholdContext = createContext<HouseholdState | null>(null)

export function HouseholdProvider({ children }: { children: ReactNode }) {
  const { user, profile } = useAuth()
  const uid = user?.uid ?? null
  const householdId = profile?.activeHouseholdId ?? null
  const profileLoaded = profile !== undefined
  // Les instantanés sont indexés par foyer : un changement de foyer actif
  // invalide immédiatement les données précédentes (état « chargement »).
  const [snapshot, setSnapshot] = useState<{ id: string; household: Household | null } | null>(null)
  const [memberSnapshot, setMemberSnapshot] = useState<{ id: string; members: HouseholdMember[] } | null>(null)
  const [retry, setRetry] = useState(0)
  // Utilisateurs dont on a vérifié côté serveur qu'ils n'ont réellement aucun foyer.
  const [noHouseholdFor, setNoHouseholdFor] = useState<string | null>(null)

  useEffect(() => {
    if (!householdId) return
    let retryTimer: ReturnType<typeof setTimeout> | undefined
    const stopHousehold = watchHousehold(
      householdId,
      (next) => setSnapshot({ id: householdId, household: next }),
      (error) => {
        // Accès refusé = l'utilisateur n'est plus membre : « aucun foyer ».
        // Toute autre erreur (réseau, serveur) est passagère : on réessaie
        // au lieu d'envoyer l'utilisateur vers la création de foyer.
        if (error instanceof FirebaseError && error.code === 'permission-denied') {
          setSnapshot({ id: householdId, household: null })
        } else {
          retryTimer = setTimeout(() => setRetry((n) => n + 1), RETRY_DELAY_MS)
        }
      },
    )
    const stopMembers = watchMembers(
      householdId,
      (members) => setMemberSnapshot({ id: householdId, members }),
      () => setMemberSnapshot({ id: householdId, members: [] }),
    )
    return () => {
      clearTimeout(retryTimer)
      stopHousehold()
      stopMembers()
    }
  }, [householdId, retry])

  // Profil sans foyer actif : si l'utilisateur est membre d'un foyer (il l'a
  // créé ou rejoint), on le réactive au lieu de proposer d'en créer un.
  useEffect(() => {
    if (!uid || !profileLoaded || householdId) return
    let cancelled = false
    recoverActiveHousehold(uid)
      .then((recovered) => {
        if (!cancelled && recovered === null) setNoHouseholdFor(uid)
      })
      .catch(() => {
        if (!cancelled) setNoHouseholdFor(uid)
      })
    return () => {
      cancelled = true
    }
  }, [uid, profileLoaded, householdId])

  let household: Household | null | undefined
  if (!householdId) household = !profileLoaded ? undefined : uid === null || noHouseholdFor === uid ? null : undefined
  else household = snapshot?.id === householdId ? snapshot.household : undefined
  const members = householdId && memberSnapshot?.id === householdId ? memberSnapshot.members : EMPTY

  const value = useMemo<HouseholdState>(() => {
    const role = (user && household?.roles[user.uid]) || null
    return { household, members, role, canWrite: role === 'owner' || role === 'member' }
  }, [household, members, user])

  return <HouseholdContext.Provider value={value}>{children}</HouseholdContext.Provider>
}
