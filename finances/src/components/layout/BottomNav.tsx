import { NavLink } from 'react-router-dom'
import { PRIMARY_NAV } from './navigation'
import styles from './BottomNav.module.css'

export function BottomNav() {
  return (
    <nav className={styles.nav} aria-label="Navigation principale">
      {PRIMARY_NAV.map((item) => (
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
