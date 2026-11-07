import { COMMON_SPACE, spaceFields, type Space } from '@/utils/spaces'
import { Timestamp } from 'firebase/firestore'
import { guessPaymentMethod } from '@/utils/categorize'
import type { PreviewRow } from '@/utils/statementImport'
import type { Category } from '@/types'
import { saveCategoryRules } from './categoryRulesService'
import { ensureProCategories } from './categoryService'
import { createItemsOnce } from './repository'

interface Actor {
  uid: string
}

export interface ImportResult {
  created: number
  /** Opérations déjà en base (même relevé importé plusieurs fois). */
  alreadyThere: number
  /** Catégories mémorisées pour les prochains relevés. */
  remembered: number
}

/**
 * Enregistre les opérations validées par l'utilisateur. L'identifiant de
 * chaque opération est déduit de son contenu : réimporter un relevé, ou un
 * relevé qui en chevauche un autre, ne crée jamais de doublon.
 */
/** `space` : où ranger les dépenses importées (communes par défaut, ou l'espace personnel d'un membre). */
export async function importStatement(householdId: string, rows: PreviewRow[], fallbackCategoryId: string, actor: Actor, space: Space = COMMON_SPACE, categories: Category[] = []): Promise<ImportResult> {
  const target = spaceFields(space, actor.uid)
  // Frais d'entreprise : uniquement dans un espace personnel ; leurs catégories « pro » sont créées au besoin.
  const personal = target.scope === 'personal'
  if (personal && rows.some((r) => r.kind === 'expense' && r.business)) await ensureProCategories(householdId, categories, actor)
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
        // Rangée par défaut (aucune catégorie reconnue ni choisie) : elle n'apprendra rien aux prochains relevés.
        ...(r.categoryId === null ? { categoryPending: true } : {}),
        ...(personal && r.business ? { business: r.business } : {}),
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
  // Chaque catégorie choisie ou confirmée est retenue pour les relevés suivants (la dernière choix remplace la précédente).
  const remembered = await saveCategoryRules(
    householdId,
    rows.filter((r) => r.kind === 'expense').map((r) => ({ label: r.label, categoryId: r.categoryId, business: r.business })),
    actor,
    { business: personal },
  ).catch(() => 0)
  return { created, alreadyThere: rows.length - created, remembered }
}
