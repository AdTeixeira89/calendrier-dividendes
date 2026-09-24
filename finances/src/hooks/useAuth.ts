import { useContext } from 'react'
import { AuthContext, type AuthState } from '@/contexts/AuthContext'

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth doit être utilisé dans <AuthProvider>')
  return ctx
}

/** Utilisateur connecté garanti (à utiliser sous une route protégée). */
export function useCurrentUser() {
  const { user } = useAuth()
  if (!user) throw new Error('Aucun utilisateur connecté')
  return user
}
