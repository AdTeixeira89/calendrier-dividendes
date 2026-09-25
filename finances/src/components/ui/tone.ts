export type Tone = 'accent' | 'income' | 'expense' | 'saving' | 'debt' | 'warning' | 'danger'

/** Couleur CSS associée à une tonalité sémantique (dégradé pour l'accent). */
export function toneColor(tone: Tone): string {
  return tone === 'accent' ? 'var(--accent-gradient)' : `var(--${tone})`
}

/** Couleur unie (jamais un dégradé) : pour tout contexte SVG (graphiques, fill/stroke). */
export function toneSolid(tone: Tone): string {
  return `var(--${tone})`
}
