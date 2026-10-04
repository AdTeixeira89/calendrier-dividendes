import { EmailAuthProvider, reauthenticateWithCredential, signOut, type User } from 'firebase/auth'
import { FirebaseError } from 'firebase/app'
import { httpsCallable } from 'firebase/functions'
import { auth, functions } from '@/firebase/client'

/**
 * Levé pendant la suppression : l'app recrée sinon un profil « manquant »
 * (filet de sécurité de l'inscription) au moment précis où on l'efface.
 */
export const accountDeletion = { inProgress: false }

const deleteAccountCallable = httpsCallable<void, { householdsDeleted: number; householdsLeft: number }>(functions, 'deleteAccount')

/** Supprime définitivement le compte et ses données ; exige le mot de passe (reconnexion récente). */
export async function deleteMyAccount(user: User, password: string): Promise<void> {
  accountDeletion.inProgress = true
  try {
    try {
      await reauthenticateWithCredential(user, EmailAuthProvider.credential(user.email ?? '', password))
    } catch (error) {
      if (error instanceof FirebaseError && (error.code === 'auth/wrong-password' || error.code === 'auth/invalid-credential')) {
        throw new Error('Mot de passe incorrect.', { cause: error })
      }
      throw error
    }
    await user.getIdToken(true)
    await deleteAccountCallable()
    await signOut(auth).catch(() => undefined)
  } catch (error) {
    accountDeletion.inProgress = false
    throw error
  }
}
