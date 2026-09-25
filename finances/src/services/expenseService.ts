import { Timestamp, onSnapshot, orderBy, query, where } from 'firebase/firestore'
import { householdCol } from '@/firebase/paths'
import type { EntityInput, Expense } from '@/types'
import type { MonthKey } from '@/utils/month'
import { monthTimestampRange } from '@/utils/month'

/** Dépenses dont la date tombe dans [start, end), les plus récentes en premier. */
export function watchExpensesRange(
  householdId: string,
  start: Timestamp,
  end: Timestamp,
  onChange: (expenses: Expense[]) => void,
  onError: (error: Error) => void,
): () => void {
  return onSnapshot(
    query(householdCol(householdId, 'expenses'), where('date', '>=', start), where('date', '<', end), orderBy('date', 'desc')),
    (snap) => onChange(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Expense)),
    onError,
  )
}
import { createItem, deleteItem, updateItem } from './repository'

interface Actor {
  uid: string
}

export type ExpenseInput = EntityInput<Expense>

export function createExpense(householdId: string, data: ExpenseInput, actor: Actor): Promise<string> {
  return createItem(householdId, 'expenses', data, actor)
}

export function updateExpense(householdId: string, id: string, changes: Partial<ExpenseInput>, actor: Actor): Promise<void> {
  return updateItem(householdId, 'expenses', id, changes, actor)
}

export function deleteExpense(householdId: string, id: string, actor: Actor): Promise<void> {
  return deleteItem(householdId, 'expenses', id, actor)
}

/** Dépenses d'un mois donné, les plus récentes en premier. */
export function watchMonthlyExpenses(
  householdId: string,
  month: MonthKey,
  onChange: (expenses: Expense[]) => void,
  onError: (error: Error) => void,
): () => void {
  const { start, end } = monthTimestampRange(month)
  return watchExpensesRange(householdId, start, end, onChange, onError)
}

export function toTimestamp(date: string): Timestamp {
  return Timestamp.fromDate(new Date(`${date}T12:00:00`))
}

export function fromTimestamp(timestamp: Timestamp): string {
  return timestamp.toDate().toISOString().slice(0, 10)
}
