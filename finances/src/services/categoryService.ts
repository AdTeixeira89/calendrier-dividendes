import { doc, onSnapshot, orderBy, query, serverTimestamp, writeBatch } from 'firebase/firestore'
import { db } from '@/firebase/client'
import { householdCol } from '@/firebase/paths'
import type { Category, EntityInput } from '@/types'
import { DEFAULT_CATEGORIES } from '@/utils/defaultCategories'
import { createItem, deleteItem, updateItem } from './repository'

interface Actor {
  uid: string
}

/** Crée les catégories de dépenses par défaut pour un foyer tout juste créé. */
export function seedDefaultCategories(householdId: string, actor: Actor): void {
  const batch = writeBatch(db)
  DEFAULT_CATEGORIES.forEach((category, index) => {
    batch.set(doc(householdCol(householdId, 'categories')), {
      name: category.name,
      kind: category.kind,
      parentId: null,
      icon: category.icon,
      color: category.color,
      order: index,
      archived: false,
      householdId,
      createdBy: actor.uid,
      createdAt: serverTimestamp(),
      updatedBy: actor.uid,
      updatedAt: serverTimestamp(),
    })
  })
  void batch.commit()
}

export type CategoryInput = EntityInput<Category>

export function createCategory(householdId: string, data: CategoryInput, actor: Actor): Promise<string> {
  return createItem(householdId, 'categories', data, actor)
}

export function updateCategory(householdId: string, id: string, changes: Partial<CategoryInput>, actor: Actor): Promise<void> {
  return updateItem(householdId, 'categories', id, changes, actor)
}

export function deleteCategory(householdId: string, id: string, actor: Actor): Promise<void> {
  return deleteItem(householdId, 'categories', id, actor)
}

export function watchCategories(householdId: string, onChange: (categories: Category[]) => void, onError: (error: Error) => void): () => void {
  return onSnapshot(
    query(householdCol(householdId, 'categories'), orderBy('order', 'asc')),
    (snap) => onChange(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Category)),
    onError,
  )
}
