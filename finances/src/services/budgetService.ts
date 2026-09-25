import { getDoc, onSnapshot, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore'
import { householdItemDoc } from '@/firebase/paths'
import type { Budget, Cents } from '@/types'
import type { MonthKey } from '@/utils/month'

interface Actor {
  uid: string
}

/**
 * Définit le budget d'une catégorie pour un mois. Le document `budgets/{mois}`
 * est créé au premier montant saisi ; les règles de sécurité interdisent de
 * modifier `createdAt`/`createdBy` sur une mise à jour, donc on ne les envoie
 * que lors de la création effective du document.
 */
export async function setBudgetLine(householdId: string, month: MonthKey, categoryId: string, amountCents: Cents, actor: Actor): Promise<void> {
  const ref = householdItemDoc(householdId, 'budgets', month)
  const snap = await getDoc(ref)
  if (!snap.exists()) {
    await setDoc(ref, {
      householdId,
      month,
      lines: { [categoryId]: amountCents },
      createdBy: actor.uid,
      createdAt: serverTimestamp(),
      updatedBy: actor.uid,
      updatedAt: serverTimestamp(),
    })
    return
  }
  await updateDoc(ref, {
    [`lines.${categoryId}`]: amountCents,
    updatedBy: actor.uid,
    updatedAt: serverTimestamp(),
  })
}

export function watchBudget(householdId: string, month: MonthKey, onChange: (budget: Budget | null) => void, onError: (error: Error) => void): () => void {
  return onSnapshot(
    householdItemDoc(householdId, 'budgets', month),
    (snap) => onChange(snap.exists() ? ({ id: snap.id, ...snap.data() } as Budget) : null),
    onError,
  )
}
