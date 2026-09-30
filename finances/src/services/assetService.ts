import { onSnapshot, orderBy, query, Timestamp } from 'firebase/firestore'
import { householdCol } from '@/firebase/paths'
import type { Asset, EntityInput } from '@/types'
import { createItem, deleteItem, updateItem } from './repository'

interface Actor {
  uid: string
}

export type AssetInput = EntityInput<Asset>

export function createAsset(householdId: string, data: AssetInput, actor: Actor): Promise<string> {
  return createItem(householdId, 'assets', data, actor)
}

/** Modifie le nom/type d'un actif sans toucher à sa valeur ni à son historique. */
export function updateAsset(householdId: string, id: string, changes: Partial<Pick<AssetInput, 'name' | 'type' | 'archived'>>, actor: Actor): Promise<void> {
  return updateItem(householdId, 'assets', id, changes, actor)
}

/**
 * Enregistre une nouvelle valorisation : l'ancienne valeur part dans
 * `history` avant d'être remplacée, pour construire la courbe d'évolution.
 */
export async function recordAssetValuation(householdId: string, asset: Asset, valueCents: number, actor: Actor): Promise<void> {
  const history = [...asset.history, { valueCents: asset.valueCents, date: asset.valuedAt }]
  await updateItem(householdId, 'assets', asset.id, { valueCents, valuedAt: Timestamp.now(), history }, actor)
}

export function deleteAsset(householdId: string, id: string, actor: Actor): Promise<void> {
  return deleteItem(householdId, 'assets', id, actor)
}

export function watchAssets(householdId: string, onChange: (assets: Asset[]) => void, onError: (error: Error) => void): () => void {
  return onSnapshot(
    query(householdCol(householdId, 'assets'), orderBy('createdAt', 'asc')),
    (snap) => onChange(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Asset)),
    onError,
  )
}
