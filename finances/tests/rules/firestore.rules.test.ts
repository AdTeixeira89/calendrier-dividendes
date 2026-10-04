import { readFileSync } from 'node:fs'
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing'
import {
  Timestamp,
  arrayRemove,
  arrayUnion,
  collection,
  deleteDoc,
  deleteField,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
  type Firestore,
} from 'firebase/firestore'
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest'

const HID = 'foyer-alice'
let env: RulesTestEnvironment

const db = (uid: string | null) =>
  (uid ? env.authenticatedContext(uid).firestore() : env.unauthenticatedContext().firestore()) as unknown as Firestore

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-finances',
    firestore: { rules: readFileSync('firestore.rules', 'utf8') },
  })
})

afterAll(() => env.cleanup())

/** Alice a créé le foyer ; Victor y est « viewer ». */
beforeEach(async () => {
  await env.clearFirestore()
  await env.withSecurityRulesDisabled(async (ctx) => {
    const admin = ctx.firestore() as unknown as Firestore
    const now = Timestamp.now()
    await setDoc(doc(admin, 'users/alice'), { displayName: 'Alice', email: 'a@x.fr', activeHouseholdId: HID, createdAt: now, updatedAt: now })
    await setDoc(doc(admin, `households/${HID}`), {
      name: 'Famille',
      currency: 'EUR',
      ownerId: 'alice',
      memberIds: ['alice', 'victor'],
      roles: { alice: 'owner', victor: 'viewer' },
      createdAt: now,
      createdBy: 'alice',
      updatedAt: now,
      updatedBy: 'alice',
    })
    await setDoc(doc(admin, `households/${HID}/members/alice`), { uid: 'alice', displayName: 'Alice', email: 'a@x.fr', role: 'owner', joinedAt: now })
    await setDoc(doc(admin, `households/${HID}/expenses/e1`), { householdId: HID, amountCents: 1000, createdBy: 'alice', createdAt: now, updatedBy: 'alice', updatedAt: now })
    await setDoc(doc(admin, 'invites/VALIDCODE23'), {
      householdId: HID,
      householdName: 'Famille',
      createdBy: 'alice',
      createdAt: now,
      expiresAt: Timestamp.fromMillis(Date.now() + 86_400_000),
      usedBy: null,
      usedAt: null,
    })
    await setDoc(doc(admin, 'invites/EXPIREDCODE'), {
      householdId: HID,
      householdName: 'Famille',
      createdBy: 'alice',
      createdAt: now,
      expiresAt: Timestamp.fromMillis(Date.now() - 1000),
      usedBy: null,
      usedAt: null,
    })
  })
})

const expense = (uid: string, extra: Record<string, unknown> = {}) => ({
  householdId: HID,
  amountCents: 8742,
  scope: 'shared',
  createdBy: uid,
  createdAt: serverTimestamp(),
  updatedBy: uid,
  updatedAt: serverTimestamp(),
  ...extra,
})

function joinBatch(firestore: Firestore, uid: string, code: string, hid = HID) {
  const batch = writeBatch(firestore)
  batch.set(doc(firestore, `households/${hid}/members/${uid}`), {
    uid,
    displayName: uid,
    email: `${uid}@x.fr`,
    role: 'member',
    joinedAt: serverTimestamp(),
    inviteCode: code,
  })
  batch.update(doc(firestore, `households/${hid}`), {
    memberIds: arrayUnion(uid),
    [`roles.${uid}`]: 'member',
    updatedAt: serverTimestamp(),
    updatedBy: uid,
  })
  batch.update(doc(firestore, `invites/${code}`), { usedBy: uid, usedAt: serverTimestamp() })
  return batch
}

describe('profils utilisateurs', () => {
  it('un visiteur non connecté ne lit rien', async () => {
    await assertFails(getDoc(doc(db(null), 'users/alice')))
    await assertFails(getDoc(doc(db(null), `households/${HID}`)))
  })

  it('chacun lit et crée uniquement son profil', async () => {
    await assertSucceeds(getDoc(doc(db('alice'), 'users/alice')))
    await assertFails(getDoc(doc(db('bob'), 'users/alice')))
    const profile = { displayName: 'Bob', email: 'b@x.fr', activeHouseholdId: null, createdAt: serverTimestamp(), updatedAt: serverTimestamp() }
    await assertSucceeds(setDoc(doc(db('bob'), 'users/bob'), profile))
    await assertFails(setDoc(doc(db('bob'), 'users/mallory'), profile))
  })

  it("on ne peut pas activer un foyer dont on n'est pas membre", async () => {
    await assertSucceeds(
      setDoc(doc(db('bob'), 'users/bob'), { displayName: 'Bob', email: 'b@x.fr', activeHouseholdId: null, createdAt: serverTimestamp(), updatedAt: serverTimestamp() }),
    )
    await assertFails(updateDoc(doc(db('bob'), 'users/bob'), { activeHouseholdId: HID, updatedAt: serverTimestamp() }))
  })
})

describe('création de foyer', () => {
  it('crée foyer + membre propriétaire dans un batch', async () => {
    const f = db('bob')
    const batch = writeBatch(f)
    batch.set(doc(f, 'households/foyer-bob'), {
      name: 'Chez Bob',
      currency: 'EUR',
      ownerId: 'bob',
      memberIds: ['bob'],
      roles: { bob: 'owner' },
      createdAt: serverTimestamp(),
      createdBy: 'bob',
      updatedAt: serverTimestamp(),
      updatedBy: 'bob',
    })
    batch.set(doc(f, 'households/foyer-bob/members/bob'), { uid: 'bob', displayName: 'Bob', email: 'b@x.fr', role: 'owner', joinedAt: serverTimestamp() })
    await assertSucceeds(batch.commit())
  })

  it('refuse un foyer incluant quelqu’un d’autre', async () => {
    await assertFails(
      setDoc(doc(db('bob'), 'households/foyer-bob'), {
        name: 'Chez Bob',
        currency: 'EUR',
        ownerId: 'bob',
        memberIds: ['bob', 'alice'],
        roles: { bob: 'owner', alice: 'member' },
        createdAt: serverTimestamp(),
        createdBy: 'bob',
        updatedAt: serverTimestamp(),
        updatedBy: 'bob',
      }),
    )
  })

  it('refuse de se déclarer propriétaire d’un foyer existant', async () => {
    await assertFails(
      setDoc(doc(db('mallory'), `households/${HID}/members/mallory`), {
        uid: 'mallory',
        displayName: 'M',
        email: 'm@x.fr',
        role: 'owner',
        joinedAt: serverTimestamp(),
      }),
    )
  })
})

describe('isolation entre foyers', () => {
  it("un non-membre ne lit ni le foyer, ni les membres, ni les données", async () => {
    const f = db('mallory')
    await assertFails(getDoc(doc(f, `households/${HID}`)))
    await assertFails(getDocs(collection(f, `households/${HID}/members`)))
    await assertFails(getDoc(doc(f, `households/${HID}/expenses/e1`)))
    await assertFails(getDocs(collection(f, `households/${HID}/expenses`)))
  })

  it("un non-membre n'écrit rien", async () => {
    await assertFails(setDoc(doc(db('mallory'), `households/${HID}/expenses/x`), expense('mallory')))
    await assertFails(updateDoc(doc(db('mallory'), `households/${HID}`), { name: 'Piraté', updatedAt: serverTimestamp(), updatedBy: 'mallory' }))
  })

  it("un non-membre ne peut pas s'ajouter sans invitation", async () => {
    await assertFails(
      updateDoc(doc(db('mallory'), `households/${HID}`), {
        memberIds: arrayUnion('mallory'),
        'roles.mallory': 'member',
        updatedAt: serverTimestamp(),
        updatedBy: 'mallory',
      }),
    )
  })

  it('les sous-collections inconnues sont interdites', async () => {
    await assertFails(setDoc(doc(db('alice'), `households/${HID}/secrets/x`), expense('alice')))
  })
})

describe('données financières', () => {
  it('un membre lit et crée avec les métadonnées correctes', async () => {
    await assertSucceeds(getDocs(collection(db('alice'), `households/${HID}/expenses`)))
    await assertSucceeds(setDoc(doc(db('alice'), `households/${HID}/expenses/e2`), expense('alice')))
  })

  it('refuse des métadonnées falsifiées ou invalides', async () => {
    const f = db('alice')
    await assertFails(setDoc(doc(f, `households/${HID}/expenses/e2`), expense('alice', { createdBy: 'victor' })))
    await assertFails(setDoc(doc(f, `households/${HID}/expenses/e2`), expense('alice', { householdId: 'autre' })))
    await assertFails(setDoc(doc(f, `households/${HID}/expenses/e2`), expense('alice', { amountCents: 87.42 })))
    await assertFails(setDoc(doc(f, `households/${HID}/expenses/e2`), expense('alice', { scope: 'public' })))
    await assertFails(setDoc(doc(f, `households/${HID}/expenses/e2`), expense('alice', { memberId: 'mallory' })))
  })

  it('une mise à jour conserve l’auteur et la date de création', async () => {
    const ref = doc(db('alice'), `households/${HID}/expenses/e1`)
    await assertSucceeds(updateDoc(ref, { amountCents: 1200, updatedBy: 'alice', updatedAt: serverTimestamp() }))
    await assertFails(updateDoc(ref, { createdBy: 'victor', updatedBy: 'alice', updatedAt: serverTimestamp() }))
  })

  it('un membre en lecture seule ne peut pas écrire', async () => {
    await assertSucceeds(getDoc(doc(db('victor'), `households/${HID}/expenses/e1`)))
    await assertFails(setDoc(doc(db('victor'), `households/${HID}/expenses/e3`), expense('victor')))
    await assertFails(deleteDoc(doc(db('victor'), `households/${HID}/expenses/e1`)))
  })

  it('les revenus fixes suivent les mêmes règles (lecture membre, écriture réservée, métadonnées vérifiées)', async () => {
    const fixed = (by: string, extra: Record<string, unknown> = {}) => ({
      householdId: HID, label: 'Salaire', amountCents: 215000, type: 'salary', memberId: by, scope: 'personal', dayOfMonth: 1, startMonth: '2026-10', archived: false,
      createdBy: by, createdAt: serverTimestamp(), updatedBy: by, updatedAt: serverTimestamp(), ...extra,
    })
    const ref = doc(db('alice'), `households/${HID}/recurringIncomes/r1`)
    await assertSucceeds(setDoc(ref, fixed('alice')))
    await assertSucceeds(getDoc(doc(db('victor'), `households/${HID}/recurringIncomes/r1`)))
    await assertFails(setDoc(doc(db('victor'), `households/${HID}/recurringIncomes/r2`), fixed('victor')))
    await assertFails(setDoc(doc(db('alice'), `households/${HID}/recurringIncomes/r3`), fixed('alice', { amountCents: 21.5 })))
    await assertFails(setDoc(doc(db('alice'), `households/${HID}/recurringIncomes/r4`), fixed('alice', { memberId: 'mallory' })))
    await assertFails(getDoc(doc(db('bob'), `households/${HID}/recurringIncomes/r1`)))
  })

  it('le journal des modifications est en ajout seul', async () => {
    const f = db('alice')
    const entry = {
      householdId: HID,
      entityType: 'expenses',
      entityId: 'e1',
      action: 'update',
      before: { amountCents: 1000 },
      after: { amountCents: 1200 },
      changedFields: ['amountCents'],
      by: 'alice',
      at: serverTimestamp(),
    }
    await assertSucceeds(setDoc(doc(f, `households/${HID}/auditLog/a1`), entry))
    await assertFails(setDoc(doc(f, `households/${HID}/auditLog/a2`), { ...entry, by: 'victor' }))
    await assertFails(updateDoc(doc(f, `households/${HID}/auditLog/a1`), { action: 'delete' }))
    await assertFails(deleteDoc(doc(f, `households/${HID}/auditLog/a1`)))
  })
})

describe('invitations', () => {
  it('un membre crée une invitation ; un non-membre non', async () => {
    const invite = (uid: string) => ({
      householdId: HID,
      householdName: 'Famille',
      createdBy: uid,
      createdAt: serverTimestamp(),
      expiresAt: Timestamp.fromMillis(Date.now() + 3 * 86_400_000),
      usedBy: null,
      usedAt: null,
    })
    await assertSucceeds(setDoc(doc(db('alice'), 'invites/NEWCODE234'), invite('alice')))
    await assertFails(setDoc(doc(db('mallory'), 'invites/EVILCODE23'), invite('mallory')))
    // Validité plafonnée à 7 jours.
    await assertFails(setDoc(doc(db('alice'), 'invites/LONGCODE23'), { ...invite('alice'), expiresAt: Timestamp.fromMillis(Date.now() + 30 * 86_400_000) }))
  })

  it("on lit une invitation par son code mais on ne peut pas les lister", async () => {
    await assertSucceeds(getDoc(doc(db('bob'), 'invites/VALIDCODE23')))
    await assertFails(getDocs(collection(db('bob'), 'invites')))
  })

  it('rejoindre avec une invitation valide, puis accéder aux données', async () => {
    const f = db('bob')
    await assertSucceeds(joinBatch(f, 'bob', 'VALIDCODE23').commit())
    await assertSucceeds(getDoc(doc(f, `households/${HID}`)))
    await assertSucceeds(setDoc(doc(f, `households/${HID}/expenses/e9`), expense('bob')))
  })

  it("une invitation ne sert qu'une fois", async () => {
    await assertSucceeds(joinBatch(db('bob'), 'bob', 'VALIDCODE23').commit())
    await assertFails(joinBatch(db('carol'), 'carol', 'VALIDCODE23').commit())
  })

  it('une invitation expirée est refusée', async () => {
    await assertFails(joinBatch(db('bob'), 'bob', 'EXPIREDCODE').commit())
  })

  it("rejoindre en s'attribuant le rôle propriétaire est refusé", async () => {
    const f = db('bob')
    const batch = joinBatch(f, 'bob', 'VALIDCODE23')
    batch.update(doc(f, `households/${HID}`), { 'roles.bob': 'owner' })
    await assertFails(batch.commit())
  })

  it('un membre peut quitter le foyer', async () => {
    await assertSucceeds(joinBatch(db('bob'), 'bob', 'VALIDCODE23').commit())
    const f = db('bob')
    const batch = writeBatch(f)
    batch.update(doc(f, `households/${HID}`), {
      memberIds: arrayRemove('bob'),
      'roles.bob': deleteField(),
      updatedAt: serverTimestamp(),
      updatedBy: 'bob',
    })
    batch.delete(doc(f, `households/${HID}/members/bob`))
    await assertSucceeds(batch.commit())
    await assertFails(getDoc(doc(f, `households/${HID}/expenses/e1`)))
  })

  it('un membre ne peut pas modifier les rôles', async () => {
    await assertSucceeds(joinBatch(db('bob'), 'bob', 'VALIDCODE23').commit())
    await assertFails(updateDoc(doc(db('bob'), `households/${HID}`), { 'roles.victor': 'member', updatedAt: serverTimestamp(), updatedBy: 'bob' }))
    await assertFails(updateDoc(doc(db('bob'), `households/${HID}`), { ownerId: 'bob', updatedAt: serverTimestamp(), updatedBy: 'bob' }))
  })
})

describe('appareils abonnés aux notifications push', () => {
  const sub = () => ({
    endpoint: 'https://web.push.apple.com/abc123',
    p256dh: 'BKey',
    auth: 'AuthSecret',
    userAgent: 'iPhone',
    createdAt: serverTimestamp(),
  })

  it("chacun enregistre, lit et supprime ses propres appareils", async () => {
    const ref = doc(db('alice'), 'users/alice/pushSubscriptions/device1')
    await assertSucceeds(setDoc(ref, sub()))
    await assertSucceeds(getDoc(ref))
    await assertSucceeds(deleteDoc(ref))
  })

  it("personne ne lit ni n'ajoute d'appareil chez quelqu'un d'autre", async () => {
    await assertSucceeds(setDoc(doc(db('alice'), 'users/alice/pushSubscriptions/device1'), sub()))
    await assertFails(getDoc(doc(db('victor'), 'users/alice/pushSubscriptions/device1')))
    await assertFails(getDocs(collection(db('victor'), 'users/alice/pushSubscriptions')))
    await assertFails(setDoc(doc(db('victor'), 'users/alice/pushSubscriptions/device2'), sub()))
    await assertFails(setDoc(doc(db(null), 'users/alice/pushSubscriptions/device3'), sub()))
  })

  it('refuse un abonnement mal formé', async () => {
    const ref = doc(db('alice'), 'users/alice/pushSubscriptions/bad')
    await assertFails(setDoc(ref, { ...sub(), endpoint: 'http://non-securise.example' }))
    await assertFails(setDoc(ref, { ...sub(), extra: 'champ inconnu' }))
    await assertFails(setDoc(ref, { ...sub(), auth: '' }))
  })
})

describe('retrouver son foyer (profil sans foyer actif)', () => {
  it('un membre peut lister les foyers dont il fait partie', async () => {
    await assertSucceeds(getDocs(query(collection(db('alice'), 'households'), where('memberIds', 'array-contains', 'alice'))))
  })

  it("personne ne peut lister les foyers des autres", async () => {
    await assertFails(getDocs(query(collection(db('bob'), 'households'), where('memberIds', 'array-contains', 'alice'))))
    await assertFails(getDocs(collection(db('bob'), 'households')))
  })
})
