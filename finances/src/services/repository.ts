import { FirebaseError } from 'firebase/app'
import { doc, getDoc, serverTimestamp, writeBatch, type DocumentData, type WriteBatch } from 'firebase/firestore'
import { db } from '@/firebase/client'
import { householdCol, householdItemDoc, type HouseholdCollection } from '@/firebase/paths'
import type { AuditAction } from '@/types'
import { changedFields, pick } from '@/utils/diff'

/**
 * Dépôt générique des données financières d'un foyer.
 *
 * Chaque écriture est accompagnée, dans le même batch atomique, d'une entrée
 * dans households/{hid}/auditLog : qui, quand, quels champs, anciennes et
 * nouvelles valeurs. Les pages n'écrivent jamais directement dans Firestore.
 */
type FinancialCollection = Exclude<HouseholdCollection, 'members' | 'auditLog'>

interface Actor {
  uid: string
}

export const SYNC_ERROR_EVENT = 'app:sync-error'

/**
 * Hors-ligne, commit() ne se résout qu'à la synchronisation : on n'attend pas
 * pour garder l'interface réactive (l'écriture est déjà dans le cache local).
 * Un refus serveur est signalé à l'interface via un événement global.
 */
function commitInBackground(batch: WriteBatch): void {
  batch.commit().catch(reportSyncError)
}

/**
 * Signale une erreur de lecture ou d'écriture Firestore à l'interface (bandeau
 * global) : un `onSnapshot` en échec (ex. index manquant, droits refusés) ne
 * doit jamais se traduire par une liste vide affichée en silence.
 */
export function reportSyncError(error: unknown): void {
  console.error(error)
  window.dispatchEvent(new CustomEvent(SYNC_ERROR_EVENT, { detail: error }))
}

function auditEntry(
  householdId: string,
  entityType: FinancialCollection,
  entityId: string,
  action: AuditAction,
  before: DocumentData | null,
  after: DocumentData | null,
  actor: Actor,
) {
  const fields = changedFields(before, after)
  return {
    householdId,
    entityType,
    entityId,
    action,
    before: pick(before, fields),
    after: pick(after, fields),
    changedFields: fields,
    by: actor.uid,
    at: serverTimestamp(),
  }
}

export async function createItem(
  householdId: string,
  collectionName: FinancialCollection,
  data: DocumentData,
  actor: Actor,
): Promise<string> {
  const ref = doc(householdCol(householdId, collectionName))
  const batch = writeBatch(db)
  batch.set(ref, {
    ...data,
    householdId,
    createdBy: actor.uid,
    createdAt: serverTimestamp(),
    updatedBy: actor.uid,
    updatedAt: serverTimestamp(),
  })
  batch.set(doc(householdCol(householdId, 'auditLog')), auditEntry(householdId, collectionName, ref.id, 'create', null, data, actor))
  commitInBackground(batch)
  return ref.id
}

/**
 * Crée un document à identifiant imposé, une seule fois : ne fait rien (et
 * retourne false) s'il existe déjà. Sert aux dépenses automatiques, que
 * plusieurs appareils peuvent tenter de créer en même temps.
 */
export async function createItemOnce(
  householdId: string,
  collectionName: FinancialCollection,
  id: string,
  data: DocumentData,
  actor: Actor,
): Promise<boolean> {
  const ref = householdItemDoc(householdId, collectionName, id)
  if ((await getDoc(ref)).exists()) return false
  const batch = writeBatch(db)
  batch.set(ref, {
    ...data,
    householdId,
    createdBy: actor.uid,
    createdAt: serverTimestamp(),
    updatedBy: actor.uid,
    updatedAt: serverTimestamp(),
  })
  batch.set(doc(householdCol(householdId, 'auditLog')), auditEntry(householdId, collectionName, id, 'create', null, data, actor))
  try {
    await batch.commit()
    return true
  } catch (error) {
    // Refus des règles = le document vient d'être créé par un autre appareil.
    if (error instanceof FirebaseError && error.code === 'permission-denied') return false
    throw error
  }
}

export async function updateItem(
  householdId: string,
  collectionName: FinancialCollection,
  id: string,
  changes: DocumentData,
  actor: Actor,
): Promise<void> {
  const ref = householdItemDoc(householdId, collectionName, id)
  const before = (await getDoc(ref)).data() ?? null
  const after = { ...before, ...changes }
  const batch = writeBatch(db)
  batch.update(ref, { ...changes, updatedBy: actor.uid, updatedAt: serverTimestamp() })
  batch.set(doc(householdCol(householdId, 'auditLog')), auditEntry(householdId, collectionName, id, 'update', before, after, actor))
  commitInBackground(batch)
}

export async function deleteItem(
  householdId: string,
  collectionName: FinancialCollection,
  id: string,
  actor: Actor,
): Promise<void> {
  const ref = householdItemDoc(householdId, collectionName, id)
  const before = (await getDoc(ref)).data() ?? null
  const batch = writeBatch(db)
  batch.delete(ref)
  batch.set(doc(householdCol(householdId, 'auditLog')), auditEntry(householdId, collectionName, id, 'delete', before, null, actor))
  commitInBackground(batch)
}
