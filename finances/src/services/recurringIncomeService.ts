import { Timestamp, onSnapshot, orderBy, query } from 'firebase/firestore'
import { householdCol, householdItemDoc } from '@/firebase/paths'
import type { EntityInput, RecurringIncome } from '@/types'
import { monthKey } from '@/utils/month'
import { occurrenceMonth } from '@/utils/recurringExpenses'
import { dueIncomes, type DueIncome } from '@/utils/recurringIncomes'
import { createItem, createItemOnce, readBefore, updateItem } from './repository'

interface Actor {
  uid: string
}

export type RecurringIncomeInput = EntityInput<RecurringIncome>

export function createRecurringIncome(householdId: string, data: RecurringIncomeInput, actor: Actor): Promise<string> {
  return createItem(householdId, 'recurringIncomes', data, actor)
}

export function updateRecurringIncome(householdId: string, id: string, changes: Partial<RecurringIncomeInput>, actor: Actor): Promise<void> {
  return updateItem(householdId, 'recurringIncomes', id, changes, actor)
}

/** Tous les revenus fixes, arrêtés compris (filtrés côté appareil : pas d'index composé à gérer). */
export function watchRecurringIncomes(householdId: string, onChange: (items: RecurringIncome[]) => void, onError: (error: Error) => void): () => void {
  return onSnapshot(
    query(householdCol(householdId, 'recurringIncomes'), orderBy('createdAt', 'asc')),
    (snap) => onChange(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as RecurringIncome)),
    onError,
  )
}

function incomeData(o: DueIncome) {
  return {
    amountCents: o.amountCents,
    date: Timestamp.fromDate(o.date),
    type: o.type,
    label: o.label,
    memberId: o.memberId,
    scope: o.scope,
    frequency: 'monthly',
    note: null,
    recurrenceId: o.recurringId,
  }
}

/** Crée les revenus automatiques manquants ; ceux qui existent déjà sont laissés tels quels. */
export async function createDueIncomes(householdId: string, due: DueIncome[], actor: Actor): Promise<number> {
  let created = 0
  for (const o of due) if (await createItemOnce(householdId, 'incomes', o.id, incomeData(o), actor)) created++
  return created
}

/** Après modification d'un revenu fixe, aligne le versement du mois en cours (les mois passés restent tels quels). */
export async function syncCurrentIncome(householdId: string, income: RecurringIncome, memberIds: string[], actor: Actor): Promise<void> {
  const current = monthKey(new Date())
  const occurrence = dueIncomes(income, memberIds).find((o) => o.month === current)
  if (!occurrence) return
  if (!(await readBefore(householdItemDoc(householdId, 'incomes', occurrence.id)))) return
  const { recurrenceId: _kept, ...changes } = incomeData(occurrence)
  void _kept
  await updateItem(householdId, 'incomes', occurrence.id, changes, actor)
}

/** Supprimer à la main le revenu d'un mois ne doit pas le faire revenir : le mois est mémorisé. */
export async function skipIncomeOccurrence(householdId: string, incomeId: string, recurringId: string, actor: Actor): Promise<void> {
  const month = occurrenceMonth(incomeId, recurringId)
  if (!month) return
  const data = await readBefore(householdItemDoc(householdId, 'recurringIncomes', recurringId))
  if (!data) return
  const skipped = (data.skippedMonths as string[] | undefined) ?? []
  if (skipped.includes(month)) return
  await updateItem(householdId, 'recurringIncomes', recurringId, { skippedMonths: [...skipped, month] }, actor)
}
