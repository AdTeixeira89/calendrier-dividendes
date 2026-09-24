import { readFileSync } from 'node:fs'
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing'
import { Timestamp, doc, setDoc, type Firestore } from 'firebase/firestore'
import { getBytes, ref, uploadBytes, type FirebaseStorage } from 'firebase/storage'
import { afterAll, beforeAll, describe, it } from 'vitest'

const HID = 'foyer-alice'
let env: RulesTestEnvironment

const storage = (uid: string) => env.authenticatedContext(uid).storage() as unknown as FirebaseStorage
const image = new Uint8Array([137, 80, 78, 71])

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-finances',
    firestore: { rules: readFileSync('firestore.rules', 'utf8') },
    storage: { rules: readFileSync('storage.rules', 'utf8') },
  })
  await env.clearFirestore()
  await env.withSecurityRulesDisabled(async (ctx) => {
    const now = Timestamp.now()
    await setDoc(doc(ctx.firestore() as unknown as Firestore, `households/${HID}`), {
      name: 'Famille',
      currency: 'EUR',
      ownerId: 'alice',
      memberIds: ['alice'],
      roles: { alice: 'owner' },
      createdAt: now,
      createdBy: 'alice',
      updatedAt: now,
      updatedBy: 'alice',
    })
  })
})

afterAll(() => env.cleanup())

describe('stockage des tickets', () => {
  it('un membre dépose et relit un ticket', async () => {
    const r = ref(storage('alice'), `households/${HID}/receipts/ticket.png`)
    await assertSucceeds(uploadBytes(r, image, { contentType: 'image/png' }))
    await assertSucceeds(getBytes(r))
  })

  it("un non-membre n'accède pas aux tickets", async () => {
    await assertFails(getBytes(ref(storage('mallory'), `households/${HID}/receipts/ticket.png`)))
    await assertFails(uploadBytes(ref(storage('mallory'), `households/${HID}/receipts/x.png`), image, { contentType: 'image/png' }))
  })

  it('seuls les images et PDF sont acceptés, dans les dossiers prévus', async () => {
    await assertSucceeds(uploadBytes(ref(storage('alice'), `households/${HID}/documents/facture.pdf`), image, { contentType: 'application/pdf' }))
    await assertFails(uploadBytes(ref(storage('alice'), `households/${HID}/receipts/virus.exe`), image, { contentType: 'application/x-msdownload' }))
    await assertFails(uploadBytes(ref(storage('alice'), `households/${HID}/autre/x.png`), image, { contentType: 'image/png' }))
  })
})
