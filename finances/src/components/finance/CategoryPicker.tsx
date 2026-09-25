import { useId } from 'react'
import type { Category } from '@/types'
import { groupByParent } from '@/hooks/useCategories'
import styles from './CategoryPicker.module.css'

interface CategoryPickerProps {
  categories: Category[]
  value: string
  onChange: (categoryId: string) => void
  label?: string
}

/** Liste déroulante hiérarchique : catégories racines, sous-catégories indentées. */
export function CategoryPicker({ categories, value, onChange, label = 'Catégorie' }: CategoryPickerProps) {
  const id = useId()
  const groups = groupByParent(categories)
  return (
    <div className={styles.field}>
      <label htmlFor={id} className={styles.label}>
        {label}
      </label>
      <select id={id} className={styles.select} value={value} onChange={(e) => onChange(e.target.value)} required>
        <option value="" disabled>
          Choisir…
        </option>
        {groups.map((group) => (
          <optgroup key={group.id} label={group.name}>
            <option value={group.id}>{group.name}</option>
            {group.children.map((child) => (
              <option key={child.id} value={child.id}>
                {'  ↳ '}
                {child.name}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
    </div>
  )
}
