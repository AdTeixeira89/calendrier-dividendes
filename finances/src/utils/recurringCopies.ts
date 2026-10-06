import type { DocumentData } from 'firebase/firestore'
import type { Expense } from '@/types'
import { monthKey, type MonthKey } from './month'
import { occurrenceDate } from './recurringExpenses'
import { expenseSpace } from './spaces'

/** Une dépense récurrente du mois précédent à reprendre dans le mois courant. */
export interface DueCopy {
  /** `${origine}_${mois}` : identifiant fixe, donc une reprise n'est jamais créée deux fois. */
  id: string
  month: MonthKey
  /** Dans l'espace privé de son auteur, comme la dépense d'origine. */
  private: boolean
  data: DocumentData & { date: Date }
}

/** Identifiant de la première dépense de la chaîne de reprises (la saisie d'origine). */
export function recurrenceRoot(expense: Pick<Expense, 'id' | 'recurrenceId'>): string {
  return expense.recurrenceId ?? expense.id
}

/**
 * Reprises à créer pour `today` : les dépenses « Récurrentes » du mois précédent, avec
 * leurs informations (montant, catégorie, libellé, type, espace, jour, caractère récurrent).
 * Les autres dépenses ne sont pas reprises. Celles qui viennent d'un abonnement (déjà
 * générées par leur règle) sont ignorées, comme les reprises supprimées à la main (`skipped`)
 * et celles dont le jour n'est pas encore arrivé (comptées à partir de leur date).
 * Seules les dépenses communes et celles de `uid` sont reprises par cet appareil.
 */
export function dueCopies(previousMonthExpenses: Expense[], uid: string, today: Date, skipped: string[] = []): DueCopy[] {
  const month = monthKey(today)
  const endOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 23, 59, 59, 999)
  const copies: DueCopy[] = []
  for (const e of previousMonthExpenses) {
    if (e.kind !== 'recurring' || (e.recurrenceId && !e.autoCopy)) continue
    if (e.scope !== 'shared' && expenseSpace(e) !== uid) continue
    const root = recurrenceRoot(e)
    const id = `${root}_${month}`
    if (skipped.includes(id)) continue
    const day = e.recurringDay ?? e.date.toDate().getDate()
    const date = occurrenceDate(month, day)
    if (date > endOfToday) continue
    copies.push({
      id,
      month,
      private: Boolean(e.private),
      data: {
        amountCents: e.amountCents,
        date,
        categoryId: e.categoryId,
        merchant: e.merchant,
        paymentMethod: e.paymentMethod,
        memberId: e.memberId,
        scope: e.scope,
        kind: 'recurring',
        note: e.note,
        receiptPath: null,
        recurrenceId: root,
        autoCopy: true,
        recurringDay: day,
      },
    })
  }
  return copies
}
