import { NavLink } from 'react-router-dom'
import { Plus } from 'lucide-react'
import { Logo } from './Logo'
import { PRIMARY_NAV, SECONDARY_NAV, type NavItem } from './navigation'
import styles from './SideNav.module.css'

/** Rail de navigation latéral (desktop uniquement). */
export function SideNav({ onQuickAdd }: { onQuickAdd: () => void }) {
  return (
    <aside className={styles.side}>
      <Logo />
      <button type="button" className={styles.add} onClick={onQuickAdd}>
        <Plus size={18} strokeWidth={2.5} /> Ajouter
      </button>
      <nav aria-label="Navigation principale" className={styles.group}>
        {PRIMARY_NAV.map((item) => (
          <SideLink key={item.to} {...item} />
        ))}
      </nav>
      <nav aria-label="Navigation secondaire" className={styles.group}>
        <p className={styles.groupLabel}>Plus</p>
        {SECONDARY_NAV.map((item) => (
          <SideLink key={item.to} {...item} />
        ))}
      </nav>
    </aside>
  )
}

function SideLink({ to, label, icon: Icon }: NavItem) {
  return (
    <NavLink to={to} end={to === '/'} className={({ isActive }) => [styles.link, isActive && styles.active].filter(Boolean).join(' ')}>
      <Icon size={19} aria-hidden />
      {label}
    </NavLink>
  )
}
