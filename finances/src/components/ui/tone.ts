export type Tone = 'accent' | 'income' | 'expense' | 'saving' | 'debt' | 'warning' | 'danger'

/** Couleur CSS associée à une tonalité sémantique. */
export function toneColor(tone: Tone): string {
  return tone === 'accent' ? 'var(--accent-gradient)' : `var(--${tone})`
}
