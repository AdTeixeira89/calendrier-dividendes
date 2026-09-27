import type { Category, Cents, Debt, Expense, Income, SavingsGoal, Subscription } from '@/types'
import { INCOME_TYPE_LABELS } from '@/types/income'
import { PAYMENT_METHOD_LABELS } from '@/types/expense'
import { formatCents } from './money'
import { totalsByCategory } from './monthlyStats'

const SCOPE_LABELS: Record<'personal' | 'shared', string> = { personal: 'Personnel', shared: 'Foyer' }

function escapeCsvField(value: string): string {
  return /[",\n;]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value
}

function toCsvRow(fields: string[]): string {
  return fields.map(escapeCsvField).join(';')
}

function categoryName(categories: Category[], categoryId: string): string {
  return categories.find((c) => c.id === categoryId)?.name ?? categoryId
}

/**
 * CSV des dépenses et revenus d'une période, ouvrable directement dans Excel
 * (séparateur `;`, compatible Excel FR) — ou à donner à une IA pour analyse.
 */
export function buildTransactionsCsv(expenses: Expense[], incomes: Income[], categories: Category[]): string {
  const header = toCsvRow(['Date', 'Type', 'Catégorie', 'Montant (€)', 'Libellé', 'Mode de paiement', 'Portée'])

  const expenseRows = expenses.map((e) =>
    toCsvRow([
      e.date.toDate().toLocaleDateString('fr-FR'),
      'Dépense',
      categoryName(categories, e.categoryId),
      (e.amountCents / 100).toFixed(2),
      e.merchant ?? '',
      PAYMENT_METHOD_LABELS[e.paymentMethod],
      SCOPE_LABELS[e.scope],
    ]),
  )

  const incomeRows = incomes.map((i) =>
    toCsvRow([i.date.toDate().toLocaleDateString('fr-FR'), 'Revenu', INCOME_TYPE_LABELS[i.type], (i.amountCents / 100).toFixed(2), i.label ?? '', '', SCOPE_LABELS[i.scope]]),
  )

  const rows = [...expenseRows, ...incomeRows].sort((a, b) => a.localeCompare(b))
  return [header, ...rows].join('\n')
}

export interface FinancialSummaryInput {
  periodLabel: string
  expenses: Expense[]
  incomes: Income[]
  categories: Category[]
  debts: Debt[]
  savingsGoals: SavingsGoal[]
  subscriptions: Subscription[]
}

function sumCents(values: Cents[]): Cents {
  return values.reduce((total, v) => total + v, 0)
}

/**
 * Résumé texte des finances du foyer sur une période, prêt à copier-coller
 * dans n'importe quel assistant IA (ChatGPT, Claude.ai, Gemini…) pour lui
 * demander une analyse — sans dépendre d'une clé API payante.
 */
export function buildFinancialSummaryText({ periodLabel, expenses, incomes, categories, debts, savingsGoals, subscriptions }: FinancialSummaryInput): string {
  const totalIncome = sumCents(incomes.map((i) => i.amountCents))
  const totalExpenses = sumCents(expenses.map((e) => e.amountCents))
  const savings = totalIncome - totalExpenses
  const savingsRate = totalIncome > 0 ? Math.round((savings / totalIncome) * 1000) / 10 : null

  const lines: string[] = []
  lines.push(`Bilan financier du foyer — ${periodLabel}`)
  lines.push('')
  lines.push(`Revenus totaux : ${formatCents(totalIncome)}`)
  lines.push(`Dépenses totales : ${formatCents(totalExpenses)}`)
  lines.push(`Épargne du mois : ${formatCents(savings)}${savingsRate !== null ? ` (taux d'épargne : ${savingsRate} %)` : ''}`)
  lines.push('')

  const byCategory = totalsByCategory(expenses)
  if (byCategory.length > 0) {
    lines.push('Dépenses par catégorie :')
    for (const { categoryId, amountCents } of byCategory) {
      lines.push(`- ${categoryName(categories, categoryId)} : ${formatCents(amountCents)}`)
    }
    lines.push('')
  }

  const activeDebts = debts.filter((d) => !d.archived)
  if (activeDebts.length > 0) {
    const totalOutstanding = sumCents(activeDebts.map((d) => d.outstandingCents))
    const totalMonthly = sumCents(activeDebts.map((d) => d.monthlyPaymentCents))
    lines.push(`Dettes en cours : capital restant dû total ${formatCents(totalOutstanding)}, mensualités totales ${formatCents(totalMonthly)}`)
    for (const d of activeDebts) {
      lines.push(`- ${d.name} : ${formatCents(d.outstandingCents)} restant, mensualité ${formatCents(d.monthlyPaymentCents)}`)
    }
    lines.push('')
  }

  const activeGoals = savingsGoals.filter((g) => !g.archived)
  if (activeGoals.length > 0) {
    lines.push("Objectifs d'épargne :")
    for (const g of activeGoals) {
      const progress = g.targetCents > 0 ? Math.round((g.currentCents / g.targetCents) * 1000) / 10 : null
      lines.push(`- ${g.name} : ${formatCents(g.currentCents)} sur ${formatCents(g.targetCents)}${progress !== null ? ` (${progress} %)` : ''}`)
    }
    lines.push('')
  }

  const activeSubscriptions = subscriptions.filter((s) => !s.archived)
  if (activeSubscriptions.length > 0) {
    const totalMonthly = sumCents(activeSubscriptions.map((s) => (s.period === 'yearly' ? Math.round(s.amountCents / 12) : s.amountCents)))
    lines.push(`Abonnements actifs (${activeSubscriptions.length}), coût mensuel total ${formatCents(totalMonthly)} :`)
    for (const s of activeSubscriptions) {
      lines.push(`- ${s.name} : ${formatCents(s.amountCents)} / ${s.period === 'yearly' ? 'an' : 'mois'}`)
    }
    lines.push('')
  }

  lines.push('(Toutes les valeurs ci-dessus viennent directement des données saisies dans l\'application ; aucune n\'est estimée.)')

  return lines.join('\n')
}

/** Déclenche le téléchargement d'un fichier texte côté navigateur. */
export function downloadTextFile(filename: string, content: string, mimeType: string): void {
  const blob = new Blob([content], { type: mimeType })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}
