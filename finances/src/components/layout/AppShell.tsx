import { useState } from 'react'
import { Outlet } from 'react-router-dom'
import { useRecurringExpenses } from '@/hooks/useRecurringExpenses'
import { BottomNav } from './BottomNav'
import { QuickAddSheet } from './QuickAddSheet'
import { SideNav } from './SideNav'
import { StatusBanners } from './StatusBanners'
import { TopBar } from './TopBar'
import styles from './AppShell.module.css'

export function AppShell() {
  const [quickAddOpen, setQuickAddOpen] = useState(false)
  useRecurringExpenses()
  const openQuickAdd = () => setQuickAddOpen(true)
  return (
    <div className={styles.shell}>
      <SideNav onQuickAdd={openQuickAdd} />
      <div className={styles.main}>
        <TopBar />
        <main className={styles.content}>
          <Outlet />
        </main>
      </div>
      <BottomNav onQuickAdd={openQuickAdd} />
      <QuickAddSheet open={quickAddOpen} onClose={() => setQuickAddOpen(false)} />
      <StatusBanners />
    </div>
  )
}
