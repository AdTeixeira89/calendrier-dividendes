/**
 * Règles d'alerte financières, partagées entre l'application (carte
 * « Alertes » de l'accueil) et la Cloud Function quotidienne (notifications
 * push). Aucune dépendance : entrées en centimes et dates JS, pour que le
 * client et le serveur évaluent exactement les mêmes règles.
 */

export interface AlertSettings {
  budget: { enabled: boolean; warnPercent: number }
  overspend: { enabled: boolean }
  subscription: { enabled: boolean; daysBefore: number }
  savingsRate: { enabled: boolean; minPercent: number }
}

export const DEFAULT_ALERT_SETTINGS: AlertSettings = {
  budget: { enabled: true, warnPercent: 90 },
  overspend: { enabled: true },
  subscription: { enabled: true, daysBefore: 3 },
  savingsRate: { enabled: true, minPercent: 10 },
}

/** Complète des réglages partiels (document absent ou ancien) avec les valeurs par défaut. */
export function withDefaultSettings(partial: Partial<AlertSettings> | null | undefined): AlertSettings {
  return {
    budget: { ...DEFAULT_ALERT_SETTINGS.budget, ...partial?.budget },
    overspend: { ...DEFAULT_ALERT_SETTINGS.overspend, ...partial?.overspend },
    subscription: { ...DEFAULT_ALERT_SETTINGS.subscription, ...partial?.subscription },
    savingsRate: { ...DEFAULT_ALERT_SETTINGS.savingsRate, ...partial?.savingsRate },
  }
}

export type AlertSeverity = 'danger' | 'warning' | 'info'

export interface FinancialAlert {
  /** Identifiant stable (règle + période + objet) : sert à ne notifier qu'une fois. */
  key: string
  severity: AlertSeverity
  title: string
  message: string
  /** Page de l'application où agir. */
  link: string
}

export interface AlertInput {
  today: Date
  /** Mois en cours, « AAAA-MM ». */
  month: string
  expenses: { amountCents: number; categoryId: string }[]
  incomeCents: number
  /** Mensualités de prêts (capital + assurance), comptées comme charges fixes. */
  debtMonthlyCents: number
  budgetLines: Record<string, number>
  categoryNames: Record<string, string>
  subscriptions: { id: string; name: string; amountCents: number; period: 'monthly' | 'yearly'; nextDate: Date | null; archived: boolean }[]
  previousMonth: { month: string; incomeCents: number; expenseCents: number } | null
  settings: AlertSettings
}

const euros = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' })
const formatCents = (cents: number) => euros.format(cents / 100)
const dayMonth = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long' })
const monthName = new Intl.DateTimeFormat('fr-FR', { month: 'long' })

function isoDay(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate())
}

/**
 * Prochaine échéance à partir de `from` : une date de prélèvement saisie une
 * fois reste valable, elle avance d'un mois (ou d'un an) une fois passée.
 * Le jour est borné à la fin du mois (un 31 devient un 30 ou un 28).
 */
export function nextOccurrence(date: Date, period: 'monthly' | 'yearly', from: Date): Date {
  const step = period === 'yearly' ? 12 : 1
  const day = date.getDate()
  let offset = 0
  let candidate = startOfDay(date)
  while (candidate < from) {
    offset += step
    const lastDay = new Date(date.getFullYear(), date.getMonth() + offset + 1, 0).getDate()
    candidate = new Date(date.getFullYear(), date.getMonth() + offset, Math.min(day, lastDay))
  }
  return candidate
}

const SEVERITY_ORDER: Record<AlertSeverity, number> = { danger: 0, warning: 1, info: 2 }

export function evaluateAlerts(input: AlertInput): FinancialAlert[] {
  const { settings } = input
  const alerts: FinancialAlert[] = []
  const totalExpensesCents = input.expenses.reduce((sum, e) => sum + e.amountCents, 0) + input.debtMonthlyCents

  if (settings.budget.enabled) {
    const actual = new Map<string, number>()
    for (const e of input.expenses) actual.set(e.categoryId, (actual.get(e.categoryId) ?? 0) + e.amountCents)
    for (const [categoryId, plannedCents] of Object.entries(input.budgetLines)) {
      if (plannedCents <= 0) continue
      const spent = actual.get(categoryId) ?? 0
      const name = input.categoryNames[categoryId] ?? 'Catégorie'
      const percent = Math.round((spent / plannedCents) * 100)
      if (spent > plannedCents) {
        alerts.push({
          key: `budget-exceeded:${input.month}:${categoryId}`,
          severity: 'danger',
          title: `Budget « ${name} » dépassé`,
          message: `${formatCents(spent)} dépensés pour un budget de ${formatCents(plannedCents)} (+${formatCents(spent - plannedCents)}).`,
          link: '/depenses',
        })
      } else if (percent >= settings.budget.warnPercent) {
        alerts.push({
          key: `budget-warning:${input.month}:${categoryId}`,
          severity: 'warning',
          title: `Budget « ${name} » à ${percent} %`,
          message: `${formatCents(spent)} dépensés sur ${formatCents(plannedCents)} : il reste ${formatCents(plannedCents - spent)}.`,
          link: '/depenses',
        })
      }
    }
  }

  // Sans revenu saisi (début de mois), comparer n'aurait pas de sens.
  if (settings.overspend.enabled && input.incomeCents > 0 && totalExpensesCents > input.incomeCents) {
    alerts.push({
      key: `overspend:${input.month}`,
      severity: 'danger',
      title: 'Dépenses supérieures aux revenus',
      message: `Ce mois-ci, les dépenses (mensualités de prêts comprises) dépassent les revenus de ${formatCents(totalExpensesCents - input.incomeCents)}.`,
      link: '/analyse',
    })
  }

  if (settings.subscription.enabled) {
    const from = startOfDay(input.today)
    const until = new Date(from.getFullYear(), from.getMonth(), from.getDate() + settings.subscription.daysBefore)
    for (const s of input.subscriptions) {
      if (s.archived || !s.nextDate) continue
      const day = nextOccurrence(s.nextDate, s.period, from)
      if (day > until) continue
      alerts.push({
        key: `subscription:${s.id}:${isoDay(day)}`,
        severity: 'info',
        title: `Prélèvement ${s.name} bientôt`,
        message: `${formatCents(s.amountCents)} le ${dayMonth.format(day)}.`,
        link: '/abonnements',
      })
    }
  }

  if (settings.savingsRate.enabled && input.previousMonth && input.previousMonth.incomeCents > 0) {
    const { month, incomeCents, expenseCents } = input.previousMonth
    const rate = ((incomeCents - expenseCents - input.debtMonthlyCents) / incomeCents) * 100
    if (rate < settings.savingsRate.minPercent) {
      const [year, m] = month.split('-').map(Number)
      const label = monthName.format(new Date(year!, m! - 1, 1))
      alerts.push({
        key: `savings-rate:${month}`,
        severity: 'warning',
        title: `Taux d'épargne de ${label} : ${Math.round(rate)} %`,
        message: `En dessous de votre objectif de ${settings.savingsRate.minPercent} %.`,
        link: '/analyse',
      })
    }
  }

  return alerts.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity])
}
