import type { Cents } from '@/types'

/** Une opération lue dans un relevé : montant signé, négatif pour une dépense. */
export interface StatementRow {
  date: Date
  label: string
  amountCents: Cents
}

export type ParseResult = { ok: true; rows: StatementRow[]; skipped: number } | { ok: false; error: string }

const MAX_ROWS = 5000

/** Les banques françaises exportent souvent en Windows-1252 : UTF-8 d'abord, sinon repli. */
export function decodeStatement(bytes: ArrayBuffer): string {
  let text: string
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    text = new TextDecoder('windows-1252').decode(bytes)
  }
  return text.replace(/^\uFEFF/, '')
}

const strip = (s: string) =>
  s
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .trim()

function splitLine(line: string, separator: string): string[] {
  const cells: string[] = []
  let current = ''
  let quoted = false
  for (let i = 0; i < line.length; i++) {
    const char = line[i]!
    if (char === '"') {
      if (quoted && line[i + 1] === '"') {
        current += '"'
        i++
      } else quoted = !quoted
    } else if (char === separator && !quoted) {
      cells.push(current.trim())
      current = ''
    } else current += char
  }
  cells.push(current.trim())
  return cells
}

/** Séparateur qui donne le nombre de colonnes le plus régulier (≥ 3) sur l'ensemble du fichier. */
function detectSeparator(lines: string[]): string | null {
  let best: { separator: string; score: number } | null = null
  for (const separator of [';', '\t', ',']) {
    // Seules les lignes de tableau comptent : titres et soldes de la banque n'ont qu'une colonne.
    const counts = new Map<number, number>()
    for (const line of lines.slice(0, 60)) {
      const n = splitLine(line, separator).length
      if (n >= 3) counts.set(n, (counts.get(n) ?? 0) + 1)
    }
    const [, score] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0] ?? [0, 0]
    if (score > (best?.score ?? 0)) best = { separator, score }
  }
  return best?.separator ?? null
}

/** « 24/09/2026 », « 24-09-26 », « 2026-09-24 », avec ou sans heure : date locale à midi, ou null si invalide. */
export function parseStatementDate(raw: string): Date | null {
  const text = raw.trim()
  let day: number, month: number, year: number
  let match = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4}|\d{2})(?!\d)/.exec(text)
  if (match) {
    day = Number(match[1])
    month = Number(match[2])
    year = match[3]!.length === 2 ? 2000 + Number(match[3]) : Number(match[3])
  } else if ((match = /^(\d{4})[/.-](\d{1,2})[/.-](\d{1,2})(?!\d)/.exec(text))) {
    year = Number(match[1])
    month = Number(match[2])
    day = Number(match[3])
  } else return null
  const date = new Date(year, month - 1, day, 12)
  const valid = date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day
  return valid && year >= 1990 && year <= 2100 ? date : null
}

/** « -1 234,56 », « 1.234,56 », « (12,50) », « 12,50- », « 12.5 € » → centimes signés, ou null. */
export function parseStatementAmount(raw: string): Cents | null {
  let text = raw.replace(/[\s\u00a0\u202f]/g, '').replace(/[€$£]|eur(os?)?/gi, '')
  if (!text) return null
  let negative = false
  if (/^\(.*\)$/.test(text)) {
    negative = true
    text = text.slice(1, -1)
  }
  if (text.endsWith('-')) {
    negative = true
    text = text.slice(0, -1)
  }
  if (text.startsWith('-')) {
    negative = !negative
    text = text.slice(1)
  } else if (text.startsWith('+')) text = text.slice(1)

  const lastComma = text.lastIndexOf(',')
  const lastDot = text.lastIndexOf('.')
  if (lastComma >= 0 && lastDot >= 0) {
    const decimal = lastComma > lastDot ? ',' : '.'
    const thousands = decimal === ',' ? '.' : ','
    text = text.split(thousands).join('').replace(decimal, '.')
  } else if (lastComma >= 0) {
    text = /^\d{1,3}(,\d{3})+$/.test(text) ? text.replace(/,/g, '') : text.replace(',', '.')
  } else if (/^\d{1,3}(\.\d{3})+$/.test(text)) text = text.replace(/\./g, '')
  if (!/^\d+(\.\d{1,3})?$/.test(text)) return null
  const cents = Math.round(Number(text) * 100)
  return negative ? -cents : cents
}

interface Columns {
  date: number
  label: number
  amount: number | null
  debit: number | null
  credit: number | null
}

const startsWithAny = (cell: string, words: string[]) => words.some((w) => cell === w || cell.startsWith(`${w} `) || cell.startsWith(`${w}(`))

function findColumns(header: string[]): Columns | null {
  const cells = header.map(strip)
  const index = (predicate: (cell: string) => boolean) => cells.findIndex(predicate)

  const date =
    index((c) => c.startsWith('date') && c.includes('operation')) >= 0
      ? index((c) => c.startsWith('date') && c.includes('operation'))
      : index((c) => c === 'date' || startsWithAny(c, ['date', 'booking date', 'transaction date', 'completed date', 'started date']))
  const label = index((c) => !c.startsWith('date') && /libelle|description|intitule|label|detail|motif|operation|merchant|beneficiaire|payee/.test(c))
  const debit = index((c) => startsWithAny(c, ['debit', 'sortie', 'debit euros', 'debit eur']))
  const credit = index((c) => startsWithAny(c, ['credit', 'entree', 'credit euros', 'credit eur']))
  const amount = index((c) => !c.startsWith('date') && /^(montant|amount|somme|valeur)/.test(c))

  if (date < 0 || label < 0) return null
  if (amount < 0 && debit < 0 && credit < 0) return null
  return { date, label, amount: amount >= 0 ? amount : null, debit: debit >= 0 ? debit : null, credit: credit >= 0 ? credit : null }
}

/** Sans en-tête reconnu : colonne de dates, colonne la plus textuelle, et une ou deux colonnes de montants. */
function guessColumns(rows: string[][]): Columns | null {
  const width = Math.max(...rows.map((r) => r.length))
  const sample = rows.slice(0, 40)
  const share = (test: (cell: string) => boolean, col: number) => sample.filter((r) => test(r[col] ?? '')).length / sample.length
  const dateCols = Array.from({ length: width }, (_, c) => c).filter((c) => share((v) => parseStatementDate(v) !== null, c) > 0.8)
  const numberCols = Array.from({ length: width }, (_, c) => c).filter((c) => !dateCols.includes(c) && share((v) => v === '' || parseStatementAmount(v) !== null, c) > 0.8 && share((v) => v !== '', c) > 0.1)
  if (dateCols.length === 0 || numberCols.length === 0) return null
  const used = new Set([...dateCols, ...numberCols])
  const label = Array.from({ length: width }, (_, c) => c)
    .filter((c) => !used.has(c))
    .sort((a, b) => sample.reduce((s, r) => s + (r[b]?.length ?? 0), 0) - sample.reduce((s, r) => s + (r[a]?.length ?? 0), 0))[0]
  if (label === undefined) return null
  const [first, second] = numberCols.slice(-2)
  const exclusive = numberCols.length >= 2 && sample.every((r) => !((r[first!] ?? '') !== '' && (r[second!] ?? '') !== ''))
  return exclusive
    ? { date: dateCols[0]!, label, amount: null, debit: first!, credit: second! }
    : { date: dateCols[0]!, label, amount: numberCols[numberCols.length - 1]!, debit: null, credit: null }
}

/** Lit un relevé CSV (séparateur, en-tête et colonnes détectés automatiquement). */
export function parseBankCsv(text: string): ParseResult {
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== '')
  if (lines.length < 2) return { ok: false, error: 'Le fichier est vide ou ne contient pas d’opérations.' }
  const separator = detectSeparator(lines)
  if (!separator) return { ok: false, error: 'Format non reconnu : ce fichier ne ressemble pas à un relevé CSV (au moins 3 colonnes attendues).' }
  const table = lines.map((l) => splitLine(l, separator))

  let headerAt = -1
  let columns: Columns | null = null
  for (let i = 0; i < Math.min(table.length, 25) && !columns; i++) {
    columns = findColumns(table[i]!)
    if (columns) headerAt = i
  }
  if (!columns) columns = guessColumns(table)
  if (!columns) {
    return { ok: false, error: 'Colonnes non reconnues : il faut au moins une date, un libellé et un montant (ou débit / crédit).' }
  }

  const body = table.slice(headerAt + 1)
  if (body.length > MAX_ROWS) return { ok: false, error: `Fichier trop volumineux (plus de ${MAX_ROWS} lignes). Importez-le par périodes.` }

  const rows: StatementRow[] = []
  let skipped = 0
  for (const cells of body) {
    const date = parseStatementDate(cells[columns.date] ?? '')
    let amount: Cents | null = null
    if (columns.amount !== null) amount = parseStatementAmount(cells[columns.amount] ?? '')
    else {
      const debit = parseStatementAmount(cells[columns.debit ?? -1] ?? '')
      const credit = parseStatementAmount(cells[columns.credit ?? -1] ?? '')
      if (debit) amount = -Math.abs(debit)
      else if (credit) amount = Math.abs(credit)
    }
    const label = (cells[columns.label] ?? '').replace(/\s+/g, ' ').trim()
    if (!date || !amount || !label) {
      skipped++
      continue
    }
    rows.push({ date, label, amountCents: amount })
  }
  if (rows.length === 0) return { ok: false, error: 'Aucune opération exploitable dans ce fichier.' }
  return { ok: true, rows, skipped }
}
