import type { Cents } from '@/types'

export interface ReceiptExtraction {
  merchant: string | null
  /** Date au format AAAA-MM-JJ, ou null si aucune date reconnue. */
  date: string | null
  totalCents: Cents | null
  /** Faible confiance si le montant ou la date n'ont pas été trouvés. */
  confidence: 'high' | 'low'
}

const AMOUNT_LINE = /(?:total|montant|à\s*payer|net\s*à\s*payer|somme)\D{0,12}(\d{1,4}[.,]\d{2})/i
const ANY_AMOUNT = /(\d{1,4}[.,]\d{2})\s*(?:€|eur)?/gi
const DATE_PATTERNS = [
  // 24/09/2026, 24-09-2026, 24.09.2026 (jour/mois/année, format français des tickets)
  /\b(\d{2})[/.-](\d{2})[/.-](\d{2,4})\b/,
]

function toAmountCents(raw: string): Cents {
  return Math.round(Number(raw.replace(',', '.')) * 100)
}

function extractTotal(text: string): Cents | null {
  const labeled = text.match(AMOUNT_LINE)
  if (labeled?.[1]) return toAmountCents(labeled[1])

  // Sans mention explicite « total » : on retient le plus gros montant de la
  // page, hypothèse raisonnable sur un ticket de caisse (le total dépasse
  // chaque ligne d'article). Cette estimation reste à confirmer par l'utilisateur.
  const amounts = [...text.matchAll(ANY_AMOUNT)].map((m) => toAmountCents(m[1]!))
  if (amounts.length === 0) return null
  return Math.max(...amounts)
}

function extractDate(text: string): string | null {
  for (const pattern of DATE_PATTERNS) {
    const match = text.match(pattern)
    if (!match) continue
    const [, day, month, yearRaw] = match
    const year = yearRaw!.length === 2 ? `20${yearRaw}` : yearRaw!
    const y = Number(year)
    const m = Number(month)
    const d = Number(day)
    if (m < 1 || m > 12 || d < 1 || d > 31) continue
    if (y < 2000 || y > 2100) continue
    return `${year}-${month!.padStart(2, '0')}-${day!.padStart(2, '0')}`
  }
  return null
}

function extractMerchant(text: string): string | null {
  const line = text
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l.length >= 3 && l.length <= 40 && /[A-Za-zÀ-ÿ]/.test(l) && !/^\d/.test(l))
  return line ?? null
}

/**
 * Extraction heuristique d'un ticket de caisse à partir du texte reconnu par
 * l'OCR. Ne fait que proposer des valeurs : l'utilisateur valide ou corrige
 * toujours avant tout enregistrement (aucune dépense créée automatiquement).
 */
export function parseReceiptText(text: string): ReceiptExtraction {
  const totalCents = extractTotal(text)
  const date = extractDate(text)
  const merchant = extractMerchant(text)
  return {
    merchant,
    date,
    totalCents,
    confidence: totalCents !== null && date !== null ? 'high' : 'low',
  }
}
