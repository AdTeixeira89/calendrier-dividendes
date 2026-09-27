import { onSnapshot, orderBy, query, where } from 'firebase/firestore'
import { householdCol } from '@/firebase/paths'
import type { EntityInput, SavingsGoal } from '@/types'
import { createItem, deleteItem, updateItem } from './repository'

interface Actor {
  uid: string
}

export type SavingsGoalInput = EntityInput<SavingsGoal>

export function createSavingsGoal(householdId: string, data: SavingsGoalInput, actor: Actor): Promise<string> {
  return createItem(householdId, 'savingsGoals', data, actor)
}

export function updateSavingsGoal(householdId: string, id: string, changes: Partial<SavingsGoalInput>, actor: Actor): Promise<void> {
  return updateItem(householdId, 'savingsGoals', id, changes, actor)
}

export function deleteSavingsGoal(householdId: string, id: string, actor: Actor): Promise<void> {
  return deleteItem(householdId, 'savingsGoals', id, actor)
}

export function watchSavingsGoals(householdId: string, onChange: (goals: SavingsGoal[]) => void, onError: (error: Error) => void): () => void {
  return onSnapshot(
    query(householdCol(householdId, 'savingsGoals'), where('archived', '==', false), orderBy('createdAt', 'asc')),
    (snap) => onChange(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as SavingsGoal)),
    onError,
  )
}
