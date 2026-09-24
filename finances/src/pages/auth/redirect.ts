/** Chemin de retour après connexion ; n'accepte que des chemins internes. */
export function safeNext(value: string | null): string {
  if (value && value.startsWith('/') && !value.startsWith('//')) return value
  return '/'
}
