import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { FullPageSpinner, Notice } from '@/components/ui'
import { useAuth } from '@/hooks/useAuth'
import { useHouseholdState } from '@/hooks/useHousehold'
import { safeNext } from '@/pages/auth/redirect'
import { toUserMessage } from '@/utils/firebaseErrors'

/** Pages publiques (connexion…) : un utilisateur connecté est redirigé. */
export function PublicOnly() {
  const { user } = useAuth()
  const location = useLocation()
  if (user === undefined) return <FullPageSpinner />
  if (user) return <Navigate to={safeNext(new URLSearchParams(location.search).get('next'))} replace />
  return <Outlet />
}

/** Aucune donnée n'est chargée tant que l'utilisateur n'est pas authentifié. */
export function RequireAuth() {
  const { user, profile, error } = useAuth()
  const location = useLocation()
  if (user === undefined) return <FullPageSpinner />
  if (user === null) {
    const next = encodeURIComponent(location.pathname + location.search)
    return <Navigate to={`/connexion?next=${next}`} replace />
  }
  if (error) {
    return (
      <div style={{ padding: 16 }}>
        <Notice tone="danger">{toUserMessage(error)}</Notice>
      </div>
    )
  }
  if (profile === undefined) return <FullPageSpinner />
  return <Outlet />
}

/** Les pages financières exigent un foyer actif. */
export function RequireHousehold() {
  const { household } = useHouseholdState()
  if (household === undefined) return <FullPageSpinner />
  if (household === null) return <Navigate to="/bienvenue" replace />
  return <Outlet />
}
