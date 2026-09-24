import { Link } from 'react-router-dom'
import { ChevronRight, LogOut } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { SECONDARY_NAV } from '@/components/layout/navigation'
import { Button, Card } from '@/components/ui'
import { useAuth } from '@/hooks/useAuth'
import { logout } from '@/services/authService'
import styles from './MorePage.module.css'

/** Menu secondaire (mobile). */
export function MorePage() {
  const { profile, user } = useAuth()
  return (
    <div className="stack animate-in">
      <PageHeader title="Plus" subtitle={profile ? `${profile.displayName} · ${user?.email ?? ''}` : undefined} />
      <Card padded={false}>
        <ul className={styles.list}>
          {SECONDARY_NAV.map(({ to, label, icon: Icon }) => (
            <li key={to}>
              <Link to={to} className={styles.item}>
                <span className={styles.icon}>
                  <Icon size={19} aria-hidden />
                </span>
                {label}
                <ChevronRight size={18} className={styles.chevron} aria-hidden />
              </Link>
            </li>
          ))}
        </ul>
      </Card>
      <Button variant="danger" block icon={<LogOut size={18} />} onClick={() => void logout()}>
        Se déconnecter
      </Button>
    </div>
  )
}
