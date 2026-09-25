import {
  Timestamp,
  arrayRemove,
  arrayUnion,
  deleteDoc,
  deleteField,
  doc,
  getDoc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  writeBatch,
} from 'firebase/firestore'
import type { User } from 'firebase/auth'
import { db } from '@/firebase/client'
import { householdCol, householdDoc, householdItemDoc, householdsCol, inviteDoc, userDoc } from '@/firebase/paths'
import type { Household, HouseholdInvite, HouseholdMember } from '@/types'
import { generateInviteCode } from '@/utils/inviteCode'
import { seedDefaultCategories } from './categoryService'

const INVITE_VALIDITY_DAYS = 7

function memberName(user: User): string {
  return user.displayName?.trim() || user.email?.split('@')[0] || 'Membre'
}

/** Crée un foyer dont l'utilisateur est propriétaire, et l'active. */
export async function createHousehold(user: User, name: string): Promise<string> {
  const ref = doc(householdsCol())
  const batch = writeBatch(db)
  batch.set(ref, {
    name: name.trim(),
    currency: 'EUR',
    ownerId: user.uid,
    memberIds: [user.uid],
    roles: { [user.uid]: 'owner' },
    createdAt: serverTimestamp(),
    createdBy: user.uid,
    updatedAt: serverTimestamp(),
    updatedBy: user.uid,
  })
  batch.set(householdItemDoc(ref.id, 'members', user.uid), {
    uid: user.uid,
    displayName: memberName(user),
    email: user.email ?? '',
    role: 'owner',
    joinedAt: serverTimestamp(),
  })
  await batch.commit()
  // Séparé du batch précédent : les règles de sécurité des catégories exigent
  // que le foyer existe déjà (elles ne voient pas les autres écritures du même batch).
  seedDefaultCategories(ref.id, user)
  await activateHousehold(user.uid, ref.id)
  return ref.id
}

/** Génère une invitation à usage unique valable 7 jours. */
export async function createInvite(user: User, household: Pick<Household, 'id' | 'name'>): Promise<HouseholdInvite> {
  const code = generateInviteCode()
  const expiresAt = Timestamp.fromMillis(Date.now() + INVITE_VALIDITY_DAYS * 24 * 3600 * 1000 - 60_000)
  const data = {
    householdId: household.id,
    householdName: household.name,
    createdBy: user.uid,
    createdAt: serverTimestamp(),
    expiresAt,
    usedBy: null,
    usedAt: null,
  }
  await setDoc(inviteDoc(code), data)
  return { code, ...data, createdAt: Timestamp.now() }
}

/** Lit une invitation (pour afficher le nom du foyer avant de rejoindre). */
export async function getInvite(code: string): Promise<HouseholdInvite | null> {
  const snap = await getDoc(inviteDoc(code))
  if (!snap.exists()) return null
  return { code: snap.id, ...snap.data() } as HouseholdInvite
}

export function isInviteUsable(invite: HouseholdInvite): boolean {
  return invite.usedBy === null && invite.expiresAt.toMillis() > Date.now()
}

/**
 * Rejoint un foyer avec un code d'invitation. Toutes les écritures sont
 * atomiques et vérifiées par les Security Rules (invitation valide et consommée).
 */
export async function joinHousehold(user: User, invite: HouseholdInvite): Promise<void> {
  const hid = invite.householdId
  const batch = writeBatch(db)
  batch.set(householdItemDoc(hid, 'members', user.uid), {
    uid: user.uid,
    displayName: memberName(user),
    email: user.email ?? '',
    role: 'member',
    joinedAt: serverTimestamp(),
    inviteCode: invite.code,
  })
  // On ne peut pas lire le foyer avant d'en être membre : arrayUnion ajoute
  // l'utilisateur en fin de liste côté serveur (les règles exigent memberIds + [uid]).
  batch.update(householdDoc(hid), {
    memberIds: arrayUnion(user.uid),
    [`roles.${user.uid}`]: 'member',
    updatedAt: serverTimestamp(),
    updatedBy: user.uid,
  })
  batch.update(inviteDoc(invite.code), { usedBy: user.uid, usedAt: serverTimestamp() })
  await batch.commit()
  await activateHousehold(user.uid, hid)
}

/**
 * Le foyer n'est activé qu'une fois son adhésion confirmée par le serveur :
 * sinon les écoutes temps réel démarreraient avant que les règles de sécurité
 * ne reconnaissent l'utilisateur comme membre (refus de lecture).
 */
function activateHousehold(uid: string, householdId: string): Promise<void> {
  return updateDoc(userDoc(uid), { activeHouseholdId: householdId, updatedAt: serverTimestamp() })
}

/** Quitte un foyer (impossible pour le propriétaire). */
export async function leaveHousehold(user: User, householdId: string): Promise<void> {
  const batch = writeBatch(db)
  batch.update(householdDoc(householdId), {
    memberIds: arrayRemove(user.uid),
    [`roles.${user.uid}`]: deleteField(),
    updatedAt: serverTimestamp(),
    updatedBy: user.uid,
  })
  batch.delete(householdItemDoc(householdId, 'members', user.uid))
  batch.update(userDoc(user.uid), { activeHouseholdId: null, updatedAt: serverTimestamp() })
  await batch.commit()
}

/** Le propriétaire retire un membre du foyer. */
export async function removeMember(owner: User, householdId: string, memberId: string): Promise<void> {
  const batch = writeBatch(db)
  batch.update(householdDoc(householdId), {
    memberIds: arrayRemove(memberId),
    [`roles.${memberId}`]: deleteField(),
    updatedAt: serverTimestamp(),
    updatedBy: owner.uid,
  })
  batch.delete(householdItemDoc(householdId, 'members', memberId))
  await batch.commit()
}

export function renameHousehold(user: User, householdId: string, name: string): Promise<void> {
  return updateDoc(householdDoc(householdId), { name: name.trim(), updatedAt: serverTimestamp(), updatedBy: user.uid })
}

export function revokeInvite(code: string): Promise<void> {
  return deleteDoc(inviteDoc(code))
}

export function watchHousehold(
  householdId: string,
  onChange: (household: Household | null) => void,
  onError: (error: Error) => void,
): () => void {
  return onSnapshot(
    householdDoc(householdId),
    (snap) => onChange(snap.exists() ? ({ id: snap.id, ...snap.data() } as Household) : null),
    onError,
  )
}

export function watchMembers(
  householdId: string,
  onChange: (members: HouseholdMember[]) => void,
  onError: (error: Error) => void,
): () => void {
  return onSnapshot(
    query(householdCol(householdId, 'members'), orderBy('joinedAt', 'asc')),
    (snap) => onChange(snap.docs.map((d) => d.data() as HouseholdMember)),
    onError,
  )
}
