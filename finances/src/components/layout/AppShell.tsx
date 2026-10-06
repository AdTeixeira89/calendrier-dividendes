import { useState } from 'react'
import { Outlet } from 'react-router-dom'
import { useAutoIncomes } from '@/hooks/useAutoIncomes'
import { useMonthlyCopies } from '@/hooks/useMonthlyCopies'
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
  useAutoIncomes()
  useMonthlyCopies()
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
      <BottomNav />
      <QuickAddSheet open={quickAddOpen} onClose={() => setQuickAddOpen(false)} />
      <StatusBanners />
    </div>
  )
}
