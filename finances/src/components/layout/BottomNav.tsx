import { NavLink } from 'react-router-dom'
import { Plus } from 'lucide-react'
import { PRIMARY_NAV } from './navigation'
import styles from './BottomNav.module.css'

export function BottomNav({ onQuickAdd }: { onQuickAdd: () => void }) {
  const [first, second, ...rest] = PRIMARY_NAV
  const left = [first, second].filter((item) => item !== undefined)
  return (
    <nav className={styles.nav} aria-label="Navigation principale">
      {left.map((item) => (
        <NavTab key={item.to} {...item} />
      ))}
      <button type="button" className={styles.fab} onClick={onQuickAdd} aria-label="Ajouter">
        <Plus size={26} strokeWidth={2.5} />
      </button>
      {rest.map((item) => (
        <NavTab key={item.to} {...item} />
      ))}
    </nav>
  )
}

function NavTab({ to, label, icon: Icon }: (typeof PRIMARY_NAV)[number]) {
  return (
    <NavLink to={to} end={to === '/'} className={({ isActive }) => [styles.tab, isActive && styles.active].filter(Boolean).join(' ')}>
      <Icon size={22} aria-hidden />
      <span>{label}</span>
    </NavLink>
  )
}
