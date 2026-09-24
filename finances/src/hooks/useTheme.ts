import { useContext } from 'react'
import { ThemeContext, type ThemeState } from '@/contexts/ThemeContext'

export function useTheme(): ThemeState {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error('useTheme doit être utilisé dans <ThemeProvider>')
  return ctx
}
