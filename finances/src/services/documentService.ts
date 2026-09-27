import { onSnapshot, orderBy, query } from 'firebase/firestore'
import { householdCol } from '@/firebase/paths'
import type { AppDocument, EntityInput } from '@/types'
import { createItem, deleteItem } from './repository'
import { deleteHouseholdFile } from './storageService'

interface Actor {
  uid: string
}

export type DocumentInput = EntityInput<AppDocument>

export function createDocument(householdId: string, data: DocumentInput, actor: Actor): Promise<string> {
  return createItem(householdId, 'documents', data, actor)
}

export async function deleteDocument(householdId: string, id: string, storagePath: string, actor: Actor): Promise<void> {
  await deleteHouseholdFile(storagePath).catch(() => undefined)
  await deleteItem(householdId, 'documents', id, actor)
}

export function watchDocuments(householdId: string, onChange: (documents: AppDocument[]) => void, onError: (error: Error) => void): () => void {
  return onSnapshot(
    query(householdCol(householdId, 'documents'), orderBy('createdAt', 'desc')),
    (snap) => onChange(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as AppDocument)),
    onError,
  )
}
