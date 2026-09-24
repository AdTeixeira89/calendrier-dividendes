import { useNavigate } from 'react-router-dom'
import { Sheet } from '@/components/ui'
import { QUICK_ACTIONS } from './navigation'
import styles from './QuickAddSheet.module.css'

export function QuickAddSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const navigate = useNavigate()
  return (
    <Sheet open={open} onClose={onClose} title="Ajouter">
      <div className={styles.grid}>
        {QUICK_ACTIONS.map(({ to, label, icon: Icon }) => (
          <button
            key={label}
            type="button"
            className={styles.action}
            onClick={() => {
              onClose()
              navigate(to)
            }}
          >
            <span className={styles.icon}>
              <Icon size={22} aria-hidden />
            </span>
            {label}
          </button>
        ))}
      </div>
    </Sheet>
  )
}
