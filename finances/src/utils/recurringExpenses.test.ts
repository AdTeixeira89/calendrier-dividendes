import { Timestamp } from 'firebase/firestore'
import { describe, expect, it } from 'vitest'
import type { Category, Subscription } from '@/types'
import { dueOccurrences, occurrenceId, occurrenceMonth, resolveCategoryId } from './recurringExpenses'

const stamp = Timestamp.now()
const base = { householdId: 'h', createdBy: 'u', createdAt: stamp, updatedBy: 'u', updatedAt: stamp }

function sub(overrides: Partial<Subscription> = {}): Subscription {
  return { ...base, id: 'eau', name: 'Eau', amountCents: 7000, period: 'monthly', categoryId: 'energie', nextDate: null, usage: null, archived: false, ...overrides }
}
function cat(id: string, name: string, overrides: Partial<Category> = {}): Category {
  return { ...base, id, name, kind: 'expense', parentId: null, icon: 'x', color: 'coral', order: 0, archived: false, ...overrides }
}
const categories = [cat('energie', 'Énergie'), cat('autres', 'Autres')]
const oct3 = new Date(2026, 9, 3)

describe('dueOccurrences', () => {
  it('crée l’occurrence du mois en cours à partir du mois de départ', () => {
    const [o, ...rest] = dueOccurrences(sub({ startMonth: '2026-10' }), categories, oct3)
    expect(rest).toEqual([])
    expect(o).toMatchObject({ id: 'eau_2026-10', month: '2026-10', amountCents: 7000, categoryId: 'energie', merchant: 'Eau' })
    expect(o!.date).toEqual(new Date(2026, 9, 1, 12))
  })

  it('rattrape les mois manqués (app non ouverte), sans dépasser le mois en cours', () => {
    const months = dueOccurrences(sub({ startMonth: '2026-07' }), categories, oct3).map((o) => o.month)
    expect(months).toEqual(['2026-07', '2026-08', '2026-09', '2026-10'])
  })

  it('ne crée rien avant le mois de départ ni pour un départ futur', () => {
    expect(dueOccurrences(sub({ startMonth: '2026-11' }), categories, oct3)).toEqual([])
  })

  it('sans mois de départ, ne crée que le mois en cours (aucun rattrapage inventé)', () => {
    expect(dueOccurrences(sub(), categories, oct3).map((o) => o.month)).toEqual(['2026-10'])
  })

  it('prélève le jour saisi, borné à la fin du mois', () => {
    const s = sub({ startMonth: '2026-01', nextDate: Timestamp.fromDate(new Date(2026, 0, 31, 12)) })
    const dates = dueOccurrences(s, categories, new Date(2026, 3, 30)).map((o) => o.date.getDate())
    expect(dates).toEqual([31, 28, 31, 30])
  })

  it('annuel : uniquement le mois anniversaire, pour le montant entier', () => {
    const s = sub({ period: 'yearly', amountCents: 24000, startMonth: '2025-09', nextDate: Timestamp.fromDate(new Date(2025, 8, 20, 12)) })
    const out = dueOccurrences(s, categories, new Date(2026, 9, 3))
    expect(out.map((o) => o.month)).toEqual(['2025-09', '2026-09'])
    expect(out.every((o) => o.amountCents === 24000)).toBe(true)
  })

  it('ignore les mois supprimés à la main, les abonnements archivés ou sans dépense automatique', () => {
    expect(dueOccurrences(sub({ startMonth: '2026-09', skippedMonths: ['2026-09'] }), categories, oct3).map((o) => o.month)).toEqual(['2026-10'])
    expect(dueOccurrences(sub({ archived: true }), categories, oct3)).toEqual([])
    expect(dueOccurrences(sub({ autoExpense: false }), categories, oct3)).toEqual([])
  })

  it('range dans « Autres » un abonnement sans catégorie, et ne crée rien sans aucune catégorie', () => {
    expect(dueOccurrences(sub({ categoryId: null }), categories, oct3)[0]!.categoryId).toBe('autres')
    expect(dueOccurrences(sub({ categoryId: null }), [], oct3)).toEqual([])
  })
})

describe('prise en compte à partir de la date', () => {
  const oct15 = Timestamp.fromDate(new Date(2026, 9, 15, 12))

  it('ne compte pas la dépense avant son jour (15 octobre, aujourd’hui le 5)', () => {
    expect(dueOccurrences(sub({ startMonth: '2026-10', nextDate: oct15 }), categories, new Date(2026, 9, 5))).toEqual([])
  })

  it('la compte le jour dit, avec cette date, puis à chaque mois', () => {
    const [o] = dueOccurrences(sub({ startMonth: '2026-10', nextDate: oct15 }), categories, new Date(2026, 9, 15, 8))
    expect(o!.date).toEqual(new Date(2026, 9, 15, 12))
    const months = dueOccurrences(sub({ startMonth: '2026-10', nextDate: oct15 }), categories, new Date(2026, 10, 20)).map((x) => x.date.toDateString())
    expect(months).toEqual([new Date(2026, 9, 15).toDateString(), new Date(2026, 10, 15).toDateString()])
  })

  it('« includeFuture » permet de réaligner une dépense déjà créée', () => {
    expect(dueOccurrences(sub({ startMonth: '2026-10', nextDate: oct15 }), categories, new Date(2026, 9, 5), { includeFuture: true })).toHaveLength(1)
  })
})

describe('identifiants', () => {
  it('relie une dépense générée à son mois', () => {
    expect(occurrenceId('eau', '2026-10')).toBe('eau_2026-10')
    expect(occurrenceMonth('eau_2026-10', 'eau')).toBe('2026-10')
    expect(occurrenceMonth('xYz123', 'eau')).toBeNull()
  })
})

describe('resolveCategoryId', () => {
  it('garde la catégorie choisie si elle existe encore', () => {
    expect(resolveCategoryId('energie', categories)).toBe('energie')
    expect(resolveCategoryId('supprimee', categories)).toBe('autres')
    expect(resolveCategoryId('energie', [cat('energie', 'Énergie', { archived: true }), cat('autres', 'Autres')])).toBe('autres')
  })
})
