import type { Cents, CurrencyCode } from '@/types'

const formatters = new Map<string, Intl.NumberFormat>()

function formatter(currency: CurrencyCode, fractionDigits: number): Intl.NumberFormat {
  const key = `${currency}:${fractionDigits}`
  let f = formatters.get(key)
  if (!f) {
    f = new Intl.NumberFormat('fr-FR', {
      style: 'currency',
      currency,
      minimumFractionDigits: fractionDigits,
      maximumFractionDigits: fractionDigits,
    })
    formatters.set(key, f)
  }
  return f
}

/** 215000 → "2 150,00 €" (ou "2 150 €" avec `compact`). */
export function formatCents(cents: Cents, currency: CurrencyCode = 'EUR', options: { compact?: boolean } = {}): string {
  const compact = options.compact ?? false
  const value = compact ? Math.round(cents / 100) : cents / 100
  return formatter(currency, compact ? 0 : 2).format(value)
}

/**
 * Convertit une saisie utilisateur ("1 234,56", "1234.5", "12 €") en centimes.
 * Retourne null si la saisie n'est pas un montant valide.
 */
export function parseAmountToCents(input: string): Cents | null {
  const cleaned = input.replace(/[\s\u00a0\u202f€]/g, '').replace(',', '.')
  if (!/^-?\d+(\.\d{0,2})?$/.test(cleaned)) return null
  const [intPart = '0', decPart = ''] = cleaned.replace('-', '').split('.')
  const cents = Number(intPart) * 100 + Number(decPart.padEnd(2, '0'))
  if (!Number.isSafeInteger(cents)) return null
  return cleaned.startsWith('-') ? -cents : cents
}

/** Variation relative en % (null si la base est nulle). */
export function percentChange(current: number, previous: number): number | null {
  if (previous === 0) return null
  return ((current - previous) / Math.abs(previous)) * 100
}

/** 8.4 → "+8,4 %" */
export function formatPercent(value: number, options: { signed?: boolean; digits?: number } = {}): string {
  const digits = options.digits ?? 1
  const formatted = new Intl.NumberFormat('fr-FR', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
    signDisplay: options.signed ? 'exceptZero' : 'auto',
  }).format(value)
  return `${formatted} %`
}
