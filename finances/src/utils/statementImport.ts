import type { Category, Expense, Income, IncomeType } from '@/types'
import type { StatementRow } from './bankStatement'
import { buildHistoryIndex, cleanMerchant, guessIncomeType, isInternalTransfer, merchantKey, suggestCategory, type Suggestion } from './categorize'

export type PreviewFlag = 'imported' | 'duplicate' | 'transfer' | null

/** Une opération du relevé, prête à être relue puis importée. */
export interface PreviewRow {
  /** Identifiant stable : réimporter le même relevé ne crée jamais de doublon. */
  id: string
  date: Date
  label: string
  merchant: string
  /** Toujours positif ; le sens est dans `kind`. */
  amountCents: number
  kind: 'expense' | 'income'
  categoryId: string | null
  suggestion: Suggestion
  incomeType: IncomeType
  incomeMonthly: boolean
  flag: PreviewFlag
  /** Coché par défaut, sauf déjà importée, doublon probable ou virement entre ses comptes. */
  include: boolean
}

/** Empreinte 53 bits (cyrb53) : suffit pour des identifiants de relevés personnels. */
export function hashText(text: string): string {
  let h1 = 0xdeadbeef
  let h2 = 0x41c6ce57
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i)
    h1 = Math.imul(h1 ^ code, 2654435761)
    h2 = Math.imul(h2 ^ code, 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36)
}

const isoDay = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const DAY_MS = 86_400_000
const dayNumber = (d: Date) => Math.round(new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() / DAY_MS)

/** Associe chaque opération à au plus une saisie existante de même montant, à ±1 jour. */
function matcher(existing: { amountCents: number; date: Date }[]) {
  const used = new Set<number>()
  return (row: { amountCents: number; date: Date }): boolean => {
    const target = dayNumber(row.date)
    const at = existing.findIndex((e, i) => !used.has(i) && e.amountCents === row.amountCents && Math.abs(dayNumber(e.date) - target) <= 1)
    if (at < 0) return false
    used.add(at)
    return true
  }
}

export function buildImportPreview(
  rows: StatementRow[],
  context: { categories: Category[]; expenses: Pick<Expense, 'id' | 'amountCents' | 'date' | 'merchant' | 'categoryId'>[]; incomes: Pick<Income, 'id' | 'amountCents' | 'date'>[] },
): PreviewRow[] {
  const history = buildHistoryIndex(context.expenses)
  const knownIds = new Set([...context.expenses.map((e) => e.id), ...context.incomes.map((i) => i.id)])
  const sameExpense = matcher(context.expenses.map((e) => ({ amountCents: e.amountCents, date: e.date.toDate() })))
  const sameIncome = matcher(context.incomes.map((i) => ({ amountCents: i.amountCents, date: i.date.toDate() })))
  const occurrences = new Map<string, number>()

  return rows.map((row): PreviewRow => {
    const kind = row.amountCents < 0 ? 'expense' : 'income'
    const amountCents = Math.abs(row.amountCents)
    const base = `${isoDay(row.date)}|${row.amountCents}|${merchantKey(row.label)}`
    const n = occurrences.get(base) ?? 0
    occurrences.set(base, n + 1)
    const id = `imp_${hashText(`${base}|${n}`)}`

    const suggestion = kind === 'expense' ? suggestCategory(row.label, history, context.categories) : { categoryId: null, source: 'none' as const }
    const income = guessIncomeType(row.label)
    let flag: PreviewFlag = null
    if (knownIds.has(id)) flag = 'imported'
    else if (isInternalTransfer(row.label)) flag = 'transfer'
    else if ((kind === 'expense' ? sameExpense : sameIncome)({ amountCents, date: row.date })) flag = 'duplicate'

    return {
      id,
      date: row.date,
      label: row.label,
      merchant: cleanMerchant(row.label),
      amountCents,
      kind,
      categoryId: suggestion.categoryId,
      suggestion: suggestion.source,
      incomeType: income.type,
      incomeMonthly: income.monthly,
      flag,
      include: flag === null,
    }
  })
}
