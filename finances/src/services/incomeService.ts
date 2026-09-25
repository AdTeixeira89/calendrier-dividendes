import { Timestamp, onSnapshot, orderBy, query, where } from 'firebase/firestore'
import { householdCol } from '@/firebase/paths'
import type { EntityInput, Income } from '@/types'
import type { MonthKey } from '@/utils/month'
import { monthTimestampRange } from '@/utils/month'

export function watchIncomesRange(
  householdId: string,
  start: Timestamp,
  end: Timestamp,
  onChange: (incomes: Income[]) => void,
  onError: (error: Error) => void,
): () => void {
  return onSnapshot(
    query(householdCol(householdId, 'incomes'), where('date', '>=', start), where('date', '<', end), orderBy('date', 'desc')),
    (snap) => onChange(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Income)),
    onError,
  )
}
import { createItem, deleteItem, updateItem } from './repository'

interface Actor {
  uid: string
}

export type IncomeInput = EntityInput<Income>

export function createIncome(householdId: string, data: IncomeInput, actor: Actor): Promise<string> {
  return createItem(householdId, 'incomes', data, actor)
}

export function updateIncome(householdId: string, id: string, changes: Partial<IncomeInput>, actor: Actor): Promise<void> {
  return updateItem(householdId, 'incomes', id, changes, actor)
}

export function deleteIncome(householdId: string, id: string, actor: Actor): Promise<void> {
  return deleteItem(householdId, 'incomes', id, actor)
}

export function watchMonthlyIncomes(
  householdId: string,
  month: MonthKey,
  onChange: (incomes: Income[]) => void,
  onError: (error: Error) => void,
): () => void {
  const { start, end } = monthTimestampRange(month)
  return watchIncomesRange(householdId, start, end, onChange, onError)
}
