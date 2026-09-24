import { onSnapshot, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore'
import { userDoc } from '@/firebase/paths'
import type { UserProfile } from '@/types'

export function createUserProfile(uid: string, data: { displayName: string; email: string }): Promise<void> {
  return setDoc(userDoc(uid), {
    displayName: data.displayName,
    email: data.email,
    activeHouseholdId: null,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  })
}

export function updateUserProfile(uid: string, data: Partial<Pick<UserProfile, 'displayName'>>): Promise<void> {
  return updateDoc(userDoc(uid), { ...data, updatedAt: serverTimestamp() })
}

/** Écoute temps réel du profil ; `null` si le document n'existe pas (encore). */
export function watchUserProfile(
  uid: string,
  onChange: (profile: UserProfile | null) => void,
  onError: (error: Error) => void,
): () => void {
  return onSnapshot(
    userDoc(uid),
    (snap) => onChange(snap.exists() ? ({ uid: snap.id, ...snap.data() } as UserProfile) : null),
    onError,
  )
}
