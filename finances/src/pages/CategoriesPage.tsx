import { useState } from 'react'
import { Plus, Tag } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { CategoryFormSheet } from '@/components/finance/CategoryFormSheet'
import { CategoryIcon } from '@/components/finance/CategoryIcon'
import { Button, Card, EmptyState } from '@/components/ui'
import { groupByParent, useCategories } from '@/hooks/useCategories'
import { useHousehold } from '@/hooks/useHousehold'
import type { Category } from '@/types'
import styles from './CategoriesPage.module.css'

export function CategoriesPage() {
  const { household, canWrite } = useHousehold()
  const categories = useCategories(household.id, 'expense')
  const [editing, setEditing] = useState<Category | undefined>(undefined)
  const [creatingUnder, setCreatingUnder] = useState<string | null | undefined>(undefined)

  const groups = categories ? groupByParent(categories) : []
  const roots = categories?.filter((c) => !c.parentId) ?? []
  const sheetOpen = Boolean(editing) || creatingUnder !== undefined

  return (
    <div className="stack animate-in">
      <PageHeader title="Catégories" subtitle="Personnalisez les postes de dépenses du foyer." />

      {canWrite && (
        <Button icon={<Plus size={18} />} onClick={() => setCreatingUnder(null)}>
          Nouvelle catégorie
        </Button>
      )}

      {categories === undefined ? null : groups.length === 0 ? (
        <EmptyState icon={<Tag size={28} />} title="Aucune catégorie" description="Créez votre première catégorie de dépenses." />
      ) : (
        <div className="stack">
          {groups.map((group) => (
            <Card key={group.id} padded={false}>
              <button type="button" className={styles.item} onClick={() => setEditing(group)}>
                <CategoryIcon icon={group.icon} color={group.color} />
                <span className={styles.name}>{group.name}</span>
              </button>
              {group.children.map((child) => (
                <button key={child.id} type="button" className={`${styles.item} ${styles.child}`} onClick={() => setEditing(child)}>
                  <CategoryIcon icon={child.icon} color={child.color} size="sm" />
                  <span className={styles.name}>{child.name}</span>
                </button>
              ))}
              {canWrite && (
                <button type="button" className={`${styles.item} ${styles.addChild}`} onClick={() => setCreatingUnder(group.id)}>
                  <Plus size={16} /> Ajouter une sous-catégorie
                </button>
              )}
            </Card>
          ))}
        </div>
      )}

      <CategoryFormSheet
        open={sheetOpen}
        onClose={() => {
          setEditing(undefined)
          setCreatingUnder(undefined)
        }}
        roots={roots}
        category={editing}
        defaultParentId={creatingUnder}
      />
    </div>
  )
}
