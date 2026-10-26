import { parseBankCsv, parseBankTable, decodeStatement, type ParseResult } from './bankStatement'

/** Une cellule Excel (texte, nombre, date…) en texte, tel que la lirait un relevé CSV. */
export function cellToText(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (value instanceof Date) {
    // Les dates Excel sont sans fuseau : on lit leurs composantes UTC pour ne jamais glisser d'un jour.
    const pad = (n: number) => String(n).padStart(2, '0')
    return `${pad(value.getUTCDate())}/${pad(value.getUTCMonth() + 1)}/${value.getUTCFullYear()}`
  }
  if (typeof value === 'number') return Number.isFinite(value) ? String(value).replace('.', ',') : ''
  return String(value).replace(/\s+/g, ' ').trim()
}

/**
 * Lit les feuilles d'un classeur Excel : la première qui ressemble à un relevé est utilisée
 * (les autres onglets — résumé, graphiques — sont ignorés).
 */
export function parseBankSheets(sheets: { sheet?: string; data: unknown[][] }[]): ParseResult {
  let firstError: ParseResult | null = null
  for (const { data } of sheets) {
    const result = parseBankTable(
      data.map((row) => row.map(cellToText)),
      { excelSerials: true },
    )
    if (result.ok) return result
    firstError ??= result
  }
  return firstError ?? { ok: false, error: 'Le classeur est vide.' }
}

export type StatementKind = 'xlsx' | 'xls' | 'text'

/** Format réel d'après le contenu (une extension peut mentir) : .xlsx = archive ZIP, .xls = ancien format binaire. */
export function detectStatementKind(bytes: Uint8Array): StatementKind {
  if (bytes[0] === 0x50 && bytes[1] === 0x4b) return 'xlsx'
  if (bytes[0] === 0xd0 && bytes[1] === 0xcf && bytes[2] === 0x11 && bytes[3] === 0xe0) return 'xls'
  return 'text'
}

/** Lit un relevé bancaire : Excel (.xlsx) ou CSV, format détecté automatiquement. */
export async function readStatementFile(file: File): Promise<ParseResult> {
  const buffer = await file.arrayBuffer()
  const kind = detectStatementKind(new Uint8Array(buffer, 0, Math.min(8, buffer.byteLength)))
  if (kind === 'xls') {
    return { ok: false, error: 'L’ancien format Excel (.xls) n’est pas lu. Dans Excel, choisissez « Enregistrer sous » → Classeur Excel (.xlsx), ou exportez en CSV.' }
  }
  if (kind === 'text') return parseBankCsv(decodeStatement(buffer))
  try {
    // Chargé à la demande : la lecture Excel n'alourdit pas le reste de l'application.
    const { default: readExcelFile } = await import('read-excel-file/browser')
    const sheets = await readExcelFile(file)
    return parseBankSheets(sheets as { sheet?: string; data: unknown[][] }[])
  } catch {
    return { ok: false, error: 'Impossible de lire ce classeur Excel (fichier abîmé ou protégé par un mot de passe).' }
  }
}
