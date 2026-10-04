import { Timestamp } from 'firebase/firestore'
import { describe, expect, it } from 'vitest'
import type { Category } from '@/types'
import type { StatementRow } from './bankStatement'
import { buildHistoryIndex, cleanMerchant, guessIncomeType, guessPaymentMethod, isInternalTransfer, merchantKey, suggestCategory } from './categorize'
import { buildImportPreview } from './statementImport'

const stamp = Timestamp.now()
const cat = (id: string, name: string): Category => ({ id, name, kind: 'expense', parentId: null, icon: 'x', color: 'coral', order: 0, archived: false, householdId: 'h', createdBy: 'u', createdAt: stamp, updatedBy: 'u', updatedAt: stamp })
const categories = ['Alimentation', 'Transport', 'Énergie', 'Communication', 'Loisirs', 'Finances', 'Autres'].map((n) => cat(n.toLowerCase(), n))
const row = (day: number, label: string, amountCents: number): StatementRow => ({ date: new Date(2026, 9, day, 12), label, amountCents })
const noHistory = { categories, expenses: [], incomes: [] }

describe('libellés bancaires', () => {
  it('garde le nom du commerçant', () => {
    expect(merchantKey('CARTE X1234 03/10 CARREFOUR MARKET')).toBe('CARREFOUR MARKET')
    expect(merchantKey('PRLV SEPA EDF CLIENTS PARTICULIERS REF 8842')).toBe('EDF CLIENTS PARTICULIERS')
    expect(cleanMerchant('CARTE X1234 03/10 CARREFOUR MARKET')).toBe('Carrefour Market')
  })

  it('reconnaît virements internes, revenus et moyens de paiement', () => {
    expect(isInternalTransfer('VIR SEPA VERS LIVRET A')).toBe(true)
    expect(isInternalTransfer('VIREMENT INTERNE')).toBe(true)
    expect(isInternalTransfer('VIR SEPA SALAIRE ENTREPRISE')).toBe(false)
    expect(guessIncomeType('VIR SALAIRE ENTREPRISE')).toEqual({ type: 'salary', monthly: true })
    expect(guessIncomeType('CAF ALLOCATIONS')).toEqual({ type: 'benefits', monthly: false })
    expect(guessPaymentMethod('CARTE X1234 CARREFOUR')).toBe('card')
    expect(guessPaymentMethod('PRLV SEPA EDF')).toBe('direct_debit')
  })
})

describe('suggestCategory', () => {
  it('applique les règles de commerçants courants', () => {
    const none = buildHistoryIndex([])
    expect(suggestCategory('CARTE X1 CARREFOUR MARKET', none, categories)).toEqual({ categoryId: 'alimentation', source: 'rule' })
    expect(suggestCategory('PRLV SEPA EDF CLIENTS', none, categories)).toEqual({ categoryId: 'énergie', source: 'rule' })
    expect(suggestCategory('PAIEMENT NETFLIX.COM', none, categories).categoryId).toBe('loisirs')
    expect(suggestCategory('PRLV SEPA NETFLIX', none, categories).categoryId).toBe('loisirs')
  })

  it('préfère ce que le foyer a déjà rangé, même contre une règle', () => {
    const history = buildHistoryIndex([
      { merchant: 'Marché de la Place', categoryId: 'loisirs' },
      { merchant: 'Carrefour Market', categoryId: 'autres' },
    ])
    expect(suggestCategory('CARTE MARCHE DE LA PLACE', history, categories)).toEqual({ categoryId: 'loisirs', source: 'history' })
    expect(suggestCategory('CARTE X9 CARREFOUR MARKET', history, categories)).toEqual({ categoryId: 'autres', source: 'history' })
  })

  it('reconnaît le même commerçant à son premier mot, et ignore une catégorie archivée', () => {
    const history = buildHistoryIndex([{ merchant: 'Boulangerie Paul', categoryId: 'loisirs' }])
    expect(suggestCategory('CARTE BOULANGERIE PAUL PARIS 12', history, categories).source).toBe('history')
    const archived = categories.map((c) => (c.id === 'loisirs' ? { ...c, archived: true } : c))
    expect(suggestCategory('CARTE BOULANGERIE PAUL', history, archived).categoryId).toBe('alimentation')
  })

  it('laisse à choisir un commerçant inconnu (jamais de catégorie inventée)', () => {
    expect(suggestCategory('CARTE X1 QUINCAILLERIE DUPONT', buildHistoryIndex([]), categories)).toEqual({ categoryId: null, source: 'none' })
  })

  it('« Paul » (prénom) n’est plus rangé en Alimentation', () => {
    expect(suggestCategory('VIR SEPA PAUL DUPONT', buildHistoryIndex([]), categories).categoryId).toBe(null)
    expect(suggestCategory('CARTE X1 CAFE DE PARIS', buildHistoryIndex([]), categories).categoryId).toBe('alimentation')
  })
})

describe('buildImportPreview', () => {
  it('sépare dépenses et revenus, nettoie les noms, coche par défaut', () => {
    const preview = buildImportPreview([row(3, 'CARTE X1 CARREFOUR MARKET', -4560), row(1, 'VIR SALAIRE ENTREPRISE', 215000)], noHistory)
    expect(preview.map((p) => [p.kind, p.amountCents, p.merchant, p.include])).toEqual([
      ['expense', 4560, 'Carrefour Market', true],
      ['income', 215000, 'Salaire Entreprise', true],
    ])
    expect(preview[1]).toMatchObject({ incomeType: 'salary', incomeMonthly: true })
  })

  it('décoche les virements entre ses propres comptes', () => {
    const [p] = buildImportPreview([row(2, 'VIR SEPA VERS LIVRET A', -20000)], noHistory)
    expect(p).toMatchObject({ flag: 'transfer', include: false })
  })

  it('repère une saisie manuelle déjà faite (même montant, ±1 jour) et ne la consomme qu’une fois', () => {
    const existing = [{ id: 'manuel', amountCents: 4560, date: Timestamp.fromDate(new Date(2026, 9, 2, 12)), merchant: 'Carrefour', categoryId: 'alimentation' }]
    const preview = buildImportPreview([row(3, 'CARTE CARREFOUR', -4560), row(3, 'CARTE CARREFOUR', -4560)], { categories, expenses: existing, incomes: [] })
    expect(preview.map((p) => p.flag)).toEqual(['duplicate', null])
    expect(preview[0]!.include).toBe(false)
    expect(preview[1]!.include).toBe(true)
  })

  it('donne des identifiants stables et distincts pour deux opérations identiques le même jour', () => {
    const rows = [row(3, 'CARTE CAFE', -250), row(3, 'CARTE CAFE', -250)]
    const a = buildImportPreview(rows, noHistory)
    const b = buildImportPreview(rows, noHistory)
    expect(a[0]!.id).not.toBe(a[1]!.id)
    expect(a.map((p) => p.id)).toEqual(b.map((p) => p.id))
    expect(a[0]!.id).toMatch(/^imp_[0-9a-z]+$/)
  })

  it('marque « déjà importée » une opération dont l’identifiant existe déjà', () => {
    const [first] = buildImportPreview([row(3, 'CARTE CAFE', -250)], noHistory)
    const existing = [{ id: first!.id, amountCents: 250, date: Timestamp.fromDate(new Date(2026, 9, 3, 12)), merchant: 'Cafe', categoryId: 'autres' }]
    const [again] = buildImportPreview([row(3, 'CARTE CAFE', -250)], { categories, expenses: existing, incomes: [] })
    expect(again).toMatchObject({ flag: 'imported', include: false })
  })
})
