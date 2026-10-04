import type { Auth } from 'firebase-admin/auth'
import { FieldValue, type DocumentSnapshot, type Firestore } from 'firebase-admin/firestore'

/** Fichiers d'un foyer dans Storage : seul `deleteFiles` de l'API Cloud Storage est utilisé. */
export interface FileBucket {
  deleteFiles(options: { prefix: string; force?: boolean }): Promise<unknown>
}

export interface DeletionReport {
  /** Foyers dont l'utilisateur était le seul membre : supprimés en entier. */
  householdsDeleted: number
  /** Foyers quittés : conservés pour les autres membres. */
  householdsLeft: number
}

/**
 * Successeur du propriétaire quand il supprime son compte : un membre avec
 * droit d'écriture plutôt qu'un lecteur, puis le plus ancien dans le foyer.
 */
export function pickSuccessor(others: string[], roles: Record<string, string>, joinedAt: Record<string, number>): string {
  const rank = (uid: string) => (roles[uid] === 'viewer' ? 1 : 0)
  return [...others].sort((a, b) => rank(a) - rank(b) || (joinedAt[a] ?? Infinity) - (joinedAt[b] ?? Infinity))[0]!
}

async function deleteHousehold(db: Firestore, bucket: FileBucket, household: DocumentSnapshot): Promise<void> {
  const invites = await db.collection('invites').where('householdId', '==', household.id).get()
  await Promise.all(invites.docs.map((invite) => invite.ref.delete()))
  await bucket.deleteFiles({ prefix: `households/${household.id}/`, force: true })
  await db.recursiveDelete(household.ref)
}

async function leaveHousehold(db: Firestore, household: DocumentSnapshot, uid: string, others: string[]): Promise<void> {
  const data = household.data()!
  const roles = (data.roles ?? {}) as Record<string, string>
  const changes: Record<string, unknown> = {
    memberIds: FieldValue.arrayRemove(uid),
    [`roles.${uid}`]: FieldValue.delete(),
    updatedAt: FieldValue.serverTimestamp(),
    updatedBy: 'system',
  }
  if (data.ownerId === uid) {
    const members = await household.ref.collection('members').get()
    const joinedAt = Object.fromEntries(members.docs.map((m) => [m.id, (m.data().joinedAt?.toMillis?.() as number | undefined) ?? Infinity]))
    const successor = pickSuccessor(others, roles, joinedAt)
    changes.ownerId = successor
    changes[`roles.${successor}`] = 'owner'
  }
  const batch = db.batch()
  batch.update(household.ref, changes)
  batch.delete(household.ref.collection('members').doc(uid))
  await batch.commit()
}

/**
 * Efface un compte et ses données personnelles. Seul dans son foyer : le foyer
 * disparaît avec tout son contenu. Avec d'autres membres : il leur est conservé
 * (c'est leur budget aussi) et la propriété passe à l'un d'eux. Peut être
 * relancée sans risque si elle a été interrompue en cours de route.
 */
export async function deleteAccountData(db: Firestore, auth: Auth, bucket: FileBucket, uid: string): Promise<DeletionReport> {
  const report: DeletionReport = { householdsDeleted: 0, householdsLeft: 0 }

  const households = await db.collection('households').where('memberIds', 'array-contains', uid).get()
  for (const household of households.docs) {
    const others = ((household.data().memberIds ?? []) as string[]).filter((id) => id !== uid)
    if (others.length === 0) {
      await deleteHousehold(db, bucket, household)
      report.householdsDeleted++
    } else {
      await leaveHousehold(db, household, uid, others)
      report.householdsLeft++
    }
  }

  // Invitations encore ouvertes émises par cette personne.
  const invites = await db.collection('invites').where('createdBy', '==', uid).get()
  await Promise.all(invites.docs.map((invite) => invite.ref.delete()))

  const profile = db.collection('users').doc(uid)
  await db.recursiveDelete(profile)
  await auth.deleteUser(uid).catch((error: { code?: string }) => {
    if (error.code !== 'auth/user-not-found') throw error
  })
  // L'app recrée un profil manquant : on repasse une fois le compte supprimé pour effacer un éventuel résidu.
  await db.recursiveDelete(profile)
  return report
}
