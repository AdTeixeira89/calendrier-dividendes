/** "septembre 2026" */
export function formatMonth(date: Date): string {
  return new Intl.DateTimeFormat('fr-FR', { month: 'long', year: 'numeric' }).format(date)
}

/** "24/09/2026" */
export function formatDate(date: Date): string {
  return new Intl.DateTimeFormat('fr-FR').format(date)
}

/** "Bonjour" / "Bonsoir" selon l'heure. */
export function greeting(date: Date = new Date()): string {
  const h = date.getHours()
  return h >= 18 || h < 5 ? 'Bonsoir' : 'Bonjour'
}
