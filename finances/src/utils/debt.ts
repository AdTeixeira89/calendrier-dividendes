import type { Cents } from '@/types'
import type { Debt } from '@/types/debt'

/** Pourcentage déjà remboursé, borné à [0, 100]. */
export function debtProgress(principalCents: Cents, outstandingCents: Cents): number {
  if (principalCents <= 0) return 0
  const paid = principalCents - outstandingCents
  return Math.min(100, Math.max(0, (paid / principalCents) * 100))
}

/**
 * Estimation simplifiée du nombre de mensualités restantes (capital restant ÷
 * mensualité, hors recalcul des intérêts). `null` si non remboursable en l'état.
 */
export function monthsRemaining(outstandingCents: Cents, monthlyPaymentCents: Cents): number | null {
  if (outstandingCents <= 0) return 0
  if (monthlyPaymentCents <= 0) return null
  return Math.ceil(outstandingCents / monthlyPaymentCents)
}

export function estimatedPayoffDate(outstandingCents: Cents, monthlyPaymentCents: Cents, from: Date = new Date()): Date | null {
  const months = monthsRemaining(outstandingCents, monthlyPaymentCents)
  if (months === null) return null
  return new Date(from.getFullYear(), from.getMonth() + months, from.getDate())
}

export interface YearlyBalance {
  year: number
  outstandingCents: Cents
}

/**
 * Projection simplifiée (linéaire, sans recalcul d'intérêts) du capital restant
 * dû en fin de chaque année, pour visualiser la diminution de la dette.
 */
export function projectYearlyBalances(outstandingCents: Cents, monthlyPaymentCents: Cents, years: number, from: Date = new Date()): YearlyBalance[] {
  const result: YearlyBalance[] = []
  let balance = outstandingCents
  for (let i = 0; i <= years; i++) {
    result.push({ year: from.getFullYear() + i, outstandingCents: Math.round(balance) })
    if (balance <= 0) continue
    balance = monthlyPaymentCents > 0 ? Math.max(0, balance - monthlyPaymentCents * 12) : balance
  }
  return result
}

export interface DebtsAggregate {
  totalPrincipalCents: Cents
  totalOutstandingCents: Cents
  totalPaidCents: Cents
  percentPaid: number
  totalMonthlyCents: Cents
  /** Date estimée de désendettement complet (la plus tardive de tous les prêts), `null` si non calculable. */
  debtFreeDate: Date | null
}

/** Vue d'ensemble « Ma dette » : agrège tous les prêts actifs du foyer. */
export function aggregateDebts(debts: Debt[], from: Date = new Date()): DebtsAggregate {
  const totalPrincipalCents = debts.reduce((sum, d) => sum + d.principalCents, 0)
  const totalOutstandingCents = debts.reduce((sum, d) => sum + d.outstandingCents, 0)
  const totalMonthlyCents = debts.reduce((sum, d) => sum + d.monthlyPaymentCents + d.insuranceCents, 0)
  const dates = debts.map((d) => estimatedPayoffDate(d.outstandingCents, d.monthlyPaymentCents, from)).filter((d): d is Date => d !== null)
  return {
    totalPrincipalCents,
    totalOutstandingCents,
    totalPaidCents: totalPrincipalCents - totalOutstandingCents,
    percentPaid: debtProgress(totalPrincipalCents, totalOutstandingCents),
    totalMonthlyCents,
    debtFreeDate: dates.length > 0 ? new Date(Math.max(...dates.map((d) => d.getTime()))) : null,
  }
}

/** Projection combinée de tous les prêts (somme des capitaux restants, année par année). */
export function projectCombinedYearlyBalances(debts: Debt[], years: number, from: Date = new Date()): YearlyBalance[] {
  const perDebt = debts.map((d) => projectYearlyBalances(d.outstandingCents, d.monthlyPaymentCents, years, from))
  return Array.from({ length: years + 1 }, (_, i) => ({
    year: from.getFullYear() + i,
    outstandingCents: perDebt.reduce((sum, points) => sum + (points[i]?.outstandingCents ?? 0), 0),
  }))
}
