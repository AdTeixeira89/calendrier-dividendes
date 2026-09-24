import { createContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { onAuthStateChanged, type User } from 'firebase/auth'
import { auth } from '@/firebase/client'
import { createUserProfile, watchUserProfile } from '@/services/userService'
import type { UserProfile } from '@/types'

export interface AuthState {
  /** undefined = état d'authentification pas encore connu */
  user: User | null | undefined
  profile: UserProfile | null | undefined
  error: Error | null
}

export const AuthContext = createContext<AuthState | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null | undefined>(undefined)
  const [profile, setProfile] = useState<UserProfile | null | undefined>(undefined)
  const [error, setError] = useState<Error | null>(null)

  useEffect(
    () =>
      onAuthStateChanged(auth, (next) => {
        setUser(next)
        setProfile(next ? undefined : null)
        setError(null)
      }),
    [],
  )

  useEffect(() => {
    if (!user) return
    return watchUserProfile(
      user.uid,
      (next) => {
        // Filet de sécurité : profil absent (ex. inscription interrompue) → on le recrée.
        if (next === null) {
          const displayName = user.displayName?.trim() || user.email?.split('@')[0] || 'Moi'
          createUserProfile(user.uid, { displayName, email: user.email ?? '' }).catch(setError)
          return
        }
        setProfile(next)
      },
      setError,
    )
  }, [user])

  const value = useMemo(() => ({ user, profile, error }), [user, profile, error])
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
