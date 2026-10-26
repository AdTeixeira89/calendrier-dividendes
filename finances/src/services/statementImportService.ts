import { COMMON_SPACE, spaceFields, type Space } from '@/utils/spaces'
import { Timestamp } from 'firebase/firestore'
import { guessPaymentMethod } from '@/utils/categorize'
import type { PreviewRow } from '@/utils/statementImport'
import { createItemsOnce } from './repository'

interface Actor {
  uid: string
}

export interface ImportResult {
  created: number
  /** Opérations déjà en base (même relevé importé plusieurs fois). */
  alreadyThere: number
}

/**
 * Enregistre les opérations validées par l'utilisateur. L'identifiant de
 * chaque opération est déduit de son contenu : réimporter un relevé, ou un
 * relevé qui en chevauche un autre, ne crée jamais de doublon.
 */
/** `space` : où ranger les dépenses importées (communes par défaut, ou l'espace personnel d'un membre). */
export async function importStatement(householdId: string, rows: PreviewRow[], fallbackCategoryId: string, actor: Actor, space: Space = COMMON_SPACE): Promise<ImportResult> {
  const target = spaceFields(space, actor.uid)
  const expenses = rows
    .filter((r) => r.kind === 'expense')
    .map((r) => ({
      id: r.id,
      data: {
        amountCents: r.amountCents,
        date: Timestamp.fromDate(r.date),
        categoryId: r.categoryId ?? fallbackCategoryId,
        merchant: r.merchant,
        paymentMethod: guessPaymentMethod(r.label),
        memberId: target.memberId,
        scope: target.scope,
        kind: 'one_off',
        note: r.label.slice(0, 280),
        receiptPath: null,
        source: 'import',
      },
    }))
  const incomes = rows
    .filter((r) => r.kind === 'income')
    .map((r) => ({
      id: r.id,
      data: {
        amountCents: r.amountCents,
        date: Timestamp.fromDate(r.date),
        type: r.incomeType,
        label: r.merchant,
        memberId: actor.uid,
        scope: 'shared',
        frequency: r.incomeMonthly ? 'monthly' : 'one_off',
        note: r.label.slice(0, 280),
      },
    }))
  const created = (await createItemsOnce(householdId, 'expenses', expenses, actor)) + (await createItemsOnce(householdId, 'incomes', incomes, actor))
  return { created, alreadyThere: rows.length - created }
}
