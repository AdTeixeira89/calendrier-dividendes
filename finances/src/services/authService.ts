import {
  createUserWithEmailAndPassword,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signOut,
  updateProfile,
  type User,
} from 'firebase/auth'
import { auth } from '@/firebase/client'
import { createUserProfile } from './userService'

export async function register(params: { displayName: string; email: string; password: string }): Promise<User> {
  const { user } = await createUserWithEmailAndPassword(auth, params.email.trim(), params.password)
  const displayName = params.displayName.trim()
  await updateProfile(user, { displayName })
  await createUserProfile(user.uid, { displayName, email: user.email ?? params.email.trim() })
  return user
}

export async function login(email: string, password: string): Promise<User> {
  const { user } = await signInWithEmailAndPassword(auth, email.trim(), password)
  return user
}

export function logout(): Promise<void> {
  return signOut(auth)
}

export function resetPassword(email: string): Promise<void> {
  return sendPasswordResetEmail(auth, email.trim())
}
