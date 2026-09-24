/** Champs techniques ignorés dans le journal des modifications. */
const IGNORED_FIELDS = new Set(['updatedAt', 'updatedBy'])

function isEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false
  return JSON.stringify(a) === JSON.stringify(b)
}

/** Liste des champs modifiés entre deux versions d'un document. */
export function changedFields(before: Record<string, unknown> | null, after: Record<string, unknown> | null): string[] {
  const keys = new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})])
  return [...keys]
    .filter((key) => !IGNORED_FIELDS.has(key) && !isEqual(before?.[key], after?.[key]))
    .sort()
}

/** Ne conserve que les champs listés (anciennes / nouvelles valeurs du journal). */
export function pick(source: Record<string, unknown> | null, fields: string[]): Record<string, unknown> | null {
  if (!source) return null
  return Object.fromEntries(fields.filter((f) => f in source).map((f) => [f, source[f]]))
}
