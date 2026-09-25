import { createElement } from 'react'
import { categoryIcon } from '@/utils/categoryIcons'
import { toneColor, type Tone } from '@/components/ui/tone'
import styles from './CategoryIcon.module.css'

export function CategoryIcon({ icon, color, size = 'md' }: { icon: string; color: string; size?: 'sm' | 'md' }) {
  const tone = (color as Tone) || 'accent'
  return (
    <span className={[styles.icon, styles[size]].join(' ')} style={{ background: toneColor(tone), color: 'var(--accent-contrast)' }}>
      {createElement(categoryIcon(icon), { size: size === 'sm' ? 14 : 18, 'aria-hidden': true })}
    </span>
  )
}
