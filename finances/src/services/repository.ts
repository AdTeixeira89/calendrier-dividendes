import { FirebaseError } from 'firebase/app'
import { doc, getDoc, getDocFromCache, serverTimestamp, writeBatch, type DocumentData, type DocumentReference, type WriteBatch } from 'firebase/firestore'
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

const READ_TIMEOUT_MS = 4000

/**
 * Lecture « avant modification » qui ne doit jamais bloquer l'interface : le
 * cache local d'abord (les listes affichées y sont déjà), sinon le serveur,
 * mais au plus quelques secondes (réseau mobile instable) — le journal
 * d'audit perd alors l'ancienne valeur plutôt que de laisser l'app figée.
 */
export async function readBefore(ref: DocumentReference): Promise<DocumentData | null> {
  try {
    const cached = await getDocFromCache(ref)
    if (cached.exists()) return cached.data()
  } catch {
    // Pas dans le cache : on tente le serveur.
  }
  const server = getDoc(ref).then((snap) => snap.data() ?? null)
  const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), READ_TIMEOUT_MS))
  return Promise.race([server, timeout]).catch(() => null)
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

const CHUNK = 100

/**
 * Crée plusieurs documents à identifiant imposé, ignorant ceux qui existent
 * déjà (réimport d'un même relevé). Par lots de 100 : 2 écritures chacun
 * (document + journal), sous la limite de 500 d'un batch Firestore.
 * Retourne le nombre de documents réellement créés.
 */
export async function createItemsOnce(
  householdId: string,
  collectionName: FinancialCollection,
  items: { id: string; data: DocumentData }[],
  actor: Actor,
): Promise<number> {
  let created = 0
  for (let start = 0; start < items.length; start += CHUNK) {
    const chunk = items.slice(start, start + CHUNK)
    const existing = await Promise.all(chunk.map((item) => getDoc(householdItemDoc(householdId, collectionName, item.id))))
    const fresh = chunk.filter((_, i) => !existing[i]!.exists())
    if (fresh.length === 0) continue
    const batch = writeBatch(db)
    for (const item of fresh) {
      batch.set(householdItemDoc(householdId, collectionName, item.id), {
        ...item.data,
        householdId,
        createdBy: actor.uid,
        createdAt: serverTimestamp(),
        updatedBy: actor.uid,
        updatedAt: serverTimestamp(),
      })
      batch.set(doc(householdCol(householdId, 'auditLog')), auditEntry(householdId, collectionName, item.id, 'create', null, item.data, actor))
    }
    try {
      await batch.commit()
      created += fresh.length
    } catch (error) {
      if (!(error instanceof FirebaseError && error.code === 'permission-denied')) throw error
      // Un autre appareil a créé l'un d'eux entre-temps : on reprend un par un.
      for (const item of fresh) if (await createItemOnce(householdId, collectionName, item.id, item.data, actor)) created++
    }
  }
  return created
}

/**
 * Crée ou remplace les champs d'un document à identifiant imposé (réglages) :
 * création complète s'il n'existe pas, sinon mise à jour. Journalisé, sans
 * attendre l'accusé serveur.
 */
export async function upsertItem(
  householdId: string,
  collectionName: FinancialCollection,
  id: string,
  data: DocumentData,
  actor: Actor,
): Promise<void> {
  const ref = householdItemDoc(householdId, collectionName, id)
  const before = await readBefore(ref)
  const batch = writeBatch(db)
  if (before) {
    batch.update(ref, { ...data, updatedBy: actor.uid, updatedAt: serverTimestamp() })
    batch.set(doc(householdCol(householdId, 'auditLog')), auditEntry(householdId, collectionName, id, 'update', before, { ...before, ...data }, actor))
  } else {
    batch.set(ref, { ...data, householdId, createdBy: actor.uid, createdAt: serverTimestamp(), updatedBy: actor.uid, updatedAt: serverTimestamp() })
    batch.set(doc(householdCol(householdId, 'auditLog')), auditEntry(householdId, collectionName, id, 'create', null, data, actor))
  }
  commitInBackground(batch)
}

export async function updateItem(
  householdId: string,
  collectionName: FinancialCollection,
  id: string,
  changes: DocumentData,
  actor: Actor,
): Promise<void> {
  const ref = householdItemDoc(householdId, collectionName, id)
  const before = await readBefore(ref)
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
  const before = await readBefore(ref)
  const batch = writeBatch(db)
  batch.delete(ref)
  batch.set(doc(householdCol(householdId, 'auditLog')), auditEntry(householdId, collectionName, id, 'delete', before, null, actor))
  commitInBackground(batch)
}
