import { useEffect, useState } from 'react'

/**
 * S'abonne à une source de données (Firestore) et ne rend la dernière valeur
 * connue que si elle correspond bien à `key` (ex. foyer + mois affiché). Un
 * changement de `key` retombe immédiatement à `undefined` (chargement) sans
 * appeler setState de façon synchrone dans l'effet — l'ancienne valeur ne
 * "fuit" jamais vers la clé suivante.
 */
export function useKeyedSnapshot<T>(key: string, subscribe: (onChange: (value: T) => void) => () => void): T | undefined {
  const [snapshot, setSnapshot] = useState<{ key: string; value: T } | null>(null)

  // eslint-disable-next-line react-hooks/exhaustive-deps -- `subscribe` est recréée à chaque rendu par construction ; seule `key` doit redéclencher l'abonnement.
  useEffect(() => subscribe((value) => setSnapshot({ key, value })), [key])

  return snapshot?.key === key ? snapshot.value : undefined
}
