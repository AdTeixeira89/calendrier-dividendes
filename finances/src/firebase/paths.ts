import { collection, doc } from 'firebase/firestore'
import { db } from './client'

/** Sous-collections d'un foyer (doit rester aligné avec firestore.rules). */
export type HouseholdCollection =
  | 'members'
  | 'auditLog'
  | 'incomes'
  | 'recurringIncomes'
  | 'expenses'
  | 'categories'
  | 'budgets'
  | 'debts'
  | 'savingsGoals'
  | 'goals'
  | 'assets'
  | 'subscriptions'
  | 'documents'
  | 'receipts'
  | 'alerts'
  | 'reports'
  | 'settings'

export const userDoc = (uid: string) => doc(db, 'users', uid)
export const householdsCol = () => collection(db, 'households')
export const householdDoc = (householdId: string) => doc(db, 'households', householdId)
export const inviteDoc = (code: string) => doc(db, 'invites', code)

export const householdCol = (householdId: string, name: HouseholdCollection) =>
  collection(db, 'households', householdId, name)

export const householdItemDoc = (householdId: string, name: HouseholdCollection, id: string) =>
  doc(db, 'households', householdId, name, id)
