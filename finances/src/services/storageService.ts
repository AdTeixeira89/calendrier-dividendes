import { deleteObject, getDownloadURL, ref, uploadBytes } from 'firebase/storage'
import { storage } from '@/firebase/client'

export type StorageFolder = 'receipts' | 'documents'

const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'application/pdf']
const MAX_SIZE_BYTES = 15 * 1024 * 1024

export function assertUploadable(file: File): void {
  if (file.size > MAX_SIZE_BYTES) throw new Error('Fichier trop volumineux (15 Mo maximum).')
  if (!ALLOWED_TYPES.includes(file.type) && !file.type.startsWith('image/')) {
    throw new Error('Format non pris en charge : utilisez une photo ou un PDF.')
  }
}

/** Dépose un fichier dans households/{householdId}/{folder}/ et renvoie son chemin Storage. */
export async function uploadHouseholdFile(householdId: string, folder: StorageFolder, file: File): Promise<string> {
  assertUploadable(file)
  const extension = file.name.includes('.') ? file.name.split('.').pop() : file.type.split('/')[1]
  const path = `households/${householdId}/${folder}/${crypto.randomUUID()}.${extension}`
  await uploadBytes(ref(storage, path), file, { contentType: file.type })
  return path
}

export function getFileUrl(path: string): Promise<string> {
  return getDownloadURL(ref(storage, path))
}

export function deleteHouseholdFile(path: string): Promise<void> {
  return deleteObject(ref(storage, path))
}
