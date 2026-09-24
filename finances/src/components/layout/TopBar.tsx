import { Link } from 'react-router-dom'
import { Menu } from 'lucide-react'
import { useHousehold } from '@/hooks/useHousehold'
import { useAuth } from '@/hooks/useAuth'
import { Logo } from './Logo'
import styles from './TopBar.module.css'

/** Barre supérieure mobile : logo, foyer actif, accès au menu secondaire. */
export function TopBar() {
  const { household } = useHousehold()
  const { profile } = useAuth()
  const initial = (profile?.displayName ?? '?').charAt(0).toUpperCase()
  return (
    <header className={styles.bar}>
      <Logo size={28} />
      <span className={styles.household} title={household.name}>
        {household.name}
      </span>
      <Link to="/plus" className={styles.avatar} aria-label="Menu et paramètres">
        <span aria-hidden>{initial}</span>
        <Menu size={14} className={styles.menuBadge} aria-hidden />
      </Link>
    </header>
  )
}
