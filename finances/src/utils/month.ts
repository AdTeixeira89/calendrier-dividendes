import { Timestamp } from 'firebase/firestore'

/** Identifiant de mois au format "AAAA-MM", utilisé comme id de document budget et comme clé d'URL. */
export type MonthKey = string

export function monthKey(date: Date): MonthKey {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
}

export function currentMonthKey(): MonthKey {
  return monthKey(new Date())
}

export function isValidMonthKey(value: string): value is MonthKey {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(value)
}

/** Bornes [début, fin) du mois, en dates locales à minuit. */
export function monthRange(key: MonthKey): { start: Date; end: Date } {
  const [year, month] = key.split('-').map(Number) as [number, number]
  return { start: new Date(year, month - 1, 1), end: new Date(year, month, 1) }
}

export function monthTimestampRange(key: MonthKey): { start: Timestamp; end: Timestamp } {
  const { start, end } = monthRange(key)
  return { start: Timestamp.fromDate(start), end: Timestamp.fromDate(end) }
}

export function shiftMonth(key: MonthKey, delta: number): MonthKey {
  const { start } = monthRange(key)
  return monthKey(new Date(start.getFullYear(), start.getMonth() + delta, 1))
}

export function previousMonthKey(key: MonthKey): MonthKey {
  return shiftMonth(key, -1)
}

/** "2026-09" → "septembre 2026" */
export function formatMonthKey(key: MonthKey): string {
  const { start } = monthRange(key)
  return new Intl.DateTimeFormat('fr-FR', { month: 'long', year: 'numeric' }).format(start)
}

export function isCurrentMonth(key: MonthKey): boolean {
  return key === currentMonthKey()
}

/** Les `count` derniers mois, du plus ancien au plus récent, `key` inclus. */
export function lastMonths(key: MonthKey, count: number): MonthKey[] {
  return Array.from({ length: count }, (_, i) => shiftMonth(key, i - (count - 1)))
}
