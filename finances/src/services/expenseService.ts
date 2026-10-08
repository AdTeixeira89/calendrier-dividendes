import { Timestamp, onSnapshot, orderBy, query, where } from 'firebase/firestore'
import { auth } from '@/firebase/client'
import { householdCol, householdItemDoc, privateExpensesCol } from '@/firebase/paths'
import type { EntityInput, Expense } from '@/types'
import type { MonthKey } from '@/utils/month'
import { expenseBudgetMonth, expenseFetchTimestampRange } from '@/utils/budgetMonth'
import {
  createItem,
  createPrivateExpense,
  deleteItem,
  deletePrivateExpense,
  moveExpense,
  readBefore,
  updateItem,
  updatePrivateExpense,
  upsertItem,
} from './repository'

interface Actor {
  uid: string
}

export type ExpenseInput = EntityInput<Expense>

/** Données d'une dépense telles qu'enregistrées : jamais l'indicateur `private`, qui n'existe que côté appareil. */
function stored<T extends { private?: boolean }>(data: T): Omit<T, 'private'> {
  const { private: _private, ...rest } = data
  void _private
  return rest
}

/** Crée une dépense : dans l'espace privé de l'auteur si `isPrivate`, sinon dans les dépenses du foyer. */
export function createExpense(householdId: string, data: ExpenseInput, actor: Actor, isPrivate = false): Promise<string> {
  return isPrivate ? createPrivateExpense(householdId, stored(data), actor) : createItem(householdId, 'expenses', stored(data), actor)
}

/**
 * Modifie une dépense. Si sa confidentialité change (partagée ⇄ privée), elle est déplacée
 * d'un espace à l'autre avec son identifiant ; `expense` donne l'état actuel.
 */
export async function updateExpense(householdId: string, expense: Expense, changes: Partial<ExpenseInput>, actor: Actor, nextPrivate = Boolean(expense.private)): Promise<void> {
  const wasPrivate = Boolean(expense.private)
  if (wasPrivate === nextPrivate) {
    return wasPrivate ? updatePrivateExpense(householdId, expense.id, stored(changes), actor) : updateItem(householdId, 'expenses', expense.id, stored(changes), actor)
  }
  const { id: _id, private: _p, householdId: _h, createdBy: _c, createdAt: _ca, updatedBy: _u, updatedAt: _ua, ...current } = expense
  void [_id, _p, _h, _c, _ca, _u, _ua]
  return moveExpense(householdId, expense.id, { ...current, ...stored(changes) }, nextPrivate, actor)
}

export async function deleteExpense(householdId: string, expense: Expense, actor: Actor): Promise<void> {
  // Une dépense reprise automatiquement qu'on supprime ne doit pas revenir à la prochaine ouverture.
  if (expense.autoCopy) await skipCopy(householdId, expense.id, actor)
  if (expense.private) return deletePrivateExpense(householdId, expense.id, actor)
  return deleteItem(householdId, 'expenses', expense.id, actor)
}

/** Identifiants des reprises automatiques supprimées à la main (réglages du foyer : identifiants seulement). */
export async function skippedCopies(householdId: string): Promise<string[]> {
  const data = await readBefore(householdItemDoc(householdId, 'settings', 'recurringCopies'))
  return (data?.skipped as string[] | undefined) ?? []
}

async function skipCopy(householdId: string, expenseId: string, actor: Actor): Promise<void> {
  const skipped = await skippedCopies(householdId)
  if (skipped.includes(expenseId)) return
  await upsertItem(householdId, 'settings', 'recurringCopies', { skipped: [...skipped, expenseId] }, actor)
}

/**
 * Dépenses que l'utilisateur a le droit de voir, dont la date tombe dans [start, end), les
 * plus récentes en premier : celles du foyer (communes et personnelles visibles) et ses
 * propres dépenses privées, marquées `private`. Celles des autres membres ne sont jamais lues.
 */
export function watchExpensesRange(
  householdId: string,
  start: Timestamp,
  end: Timestamp,
  onChange: (expenses: Expense[]) => void,
  onError: (error: Error) => void,
): () => void {
  let shared: Expense[] | null = null
  let mine: Expense[] | null = null
  const emit = () => {
    if (shared === null || mine === null) return
    onChange([...shared, ...mine].sort((a, b) => b.date.toMillis() - a.date.toMillis()))
  }
  const range = [where('date', '>=', start), where('date', '<', end), orderBy('date', 'desc')] as const

  const stopShared = onSnapshot(
    query(householdCol(householdId, 'expenses'), ...range),
    (snap) => {
      shared = snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Expense)
      emit()
    },
    onError,
  )

  const uid = auth.currentUser?.uid
  if (!uid) {
    mine = []
    emit()
    return stopShared
  }
  const stopPrivate = onSnapshot(
    query(privateExpensesCol(householdId, uid), ...range),
    (snap) => {
      mine = snap.docs.map((d) => ({ id: d.id, ...d.data(), private: true }) as Expense)
      emit()
    },
    // L'espace privé est un plus : s'il est momentanément illisible, le reste de l'app continue.
    (error) => {
      console.error(error)
      mine = []
      emit()
    },
  )
  return () => {
    stopShared()
    stopPrivate()
  }
}

/**
 * Dépenses d'un mois comptable, les plus récentes en premier : les courantes du 6 au 5, les récurrentes
 * (prêts, abonnements…) dans le mois civil de leur date de prélèvement.
 */
export function watchMonthlyExpenses(
  householdId: string,
  month: MonthKey,
  onChange: (expenses: Expense[]) => void,
  onError: (error: Error) => void,
): () => void {
  const { start, end } = expenseFetchTimestampRange(month)
  return watchExpensesRange(householdId, start, end, (list) => onChange(list.filter((e) => expenseBudgetMonth(e) === month)), onError)
}

export function toTimestamp(date: string): Timestamp {
  return Timestamp.fromDate(new Date(`${date}T12:00:00`))
}

export function fromTimestamp(timestamp: Timestamp): string {
  return timestamp.toDate().toISOString().slice(0, 10)
}
