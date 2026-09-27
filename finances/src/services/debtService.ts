import { onSnapshot, orderBy, query, where } from 'firebase/firestore'
import { householdCol } from '@/firebase/paths'
import type { Debt, EntityInput } from '@/types'
import { createItem, deleteItem, updateItem } from './repository'

interface Actor {
  uid: string
}

export type DebtInput = EntityInput<Debt>

export function createDebt(householdId: string, data: DebtInput, actor: Actor): Promise<string> {
  return createItem(householdId, 'debts', data, actor)
}

export function updateDebt(householdId: string, id: string, changes: Partial<DebtInput>, actor: Actor): Promise<void> {
  return updateItem(householdId, 'debts', id, changes, actor)
}

export function deleteDebt(householdId: string, id: string, actor: Actor): Promise<void> {
  return deleteItem(householdId, 'debts', id, actor)
}

export function watchDebts(householdId: string, onChange: (debts: Debt[]) => void, onError: (error: Error) => void): () => void {
  return onSnapshot(
    query(householdCol(householdId, 'debts'), where('archived', '==', false), orderBy('createdAt', 'asc')),
    (snap) => onChange(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Debt)),
    onError,
  )
}
