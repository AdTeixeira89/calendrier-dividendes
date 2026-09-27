import { onSnapshot, orderBy, query, where } from 'firebase/firestore'
import { householdCol } from '@/firebase/paths'
import type { EntityInput, Subscription } from '@/types'
import { createItem, deleteItem, updateItem } from './repository'

interface Actor {
  uid: string
}

export type SubscriptionInput = EntityInput<Subscription>

export function createSubscription(householdId: string, data: SubscriptionInput, actor: Actor): Promise<string> {
  return createItem(householdId, 'subscriptions', data, actor)
}

export function updateSubscription(householdId: string, id: string, changes: Partial<SubscriptionInput>, actor: Actor): Promise<void> {
  return updateItem(householdId, 'subscriptions', id, changes, actor)
}

export function deleteSubscription(householdId: string, id: string, actor: Actor): Promise<void> {
  return deleteItem(householdId, 'subscriptions', id, actor)
}

export function watchSubscriptions(householdId: string, onChange: (subscriptions: Subscription[]) => void, onError: (error: Error) => void): () => void {
  return onSnapshot(
    query(householdCol(householdId, 'subscriptions'), where('archived', '==', false), orderBy('createdAt', 'asc')),
    (snap) => onChange(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Subscription)),
    onError,
  )
}
