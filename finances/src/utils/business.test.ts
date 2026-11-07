import { describe, expect, it } from 'vitest'
import type { Category, Expense } from '@/types'
import { businessTotals, findProCategory, guessBusinessKind, proCategoryId, withoutBusiness } from './business'

const cat = (id: string, name: string) => ({ id, name, archived: false }) as Category
const e = (amountCents: number, business?: 'subscription' | 'other') => ({ amountCents, business }) as Expense

describe('frais d’entreprise', () => {
  it('propose « abonnement » pour un libellé de logiciel ou d’hébergement, sinon « autres frais »', () => {
    expect(guessBusinessKind('PRLV SEPA ADOBE SYSTEMS')).toBe('subscription')
    expect(guessBusinessKind('CB OVH SAS 04/11')).toBe('subscription')
    expect(guessBusinessKind('CB PAPETERIE DU CENTRE')).toBe('other')
  })

  it('sépare les frais pro des dépenses personnelles et les totalise', () => {
    const list = [e(1000), e(2500, 'subscription'), e(4000, 'other'), e(500, 'other')]
    expect(withoutBusiness(list)).toHaveLength(1)
    expect(businessTotals(list)).toEqual({ subscriptionCents: 2500, otherCents: 4500, totalCents: 7000, count: 3 })
  })

  it('retrouve une catégorie pro existante ou donne l’identifiant fixe à créer', () => {
    const categories = [cat('x', 'Alimentation'), cat('mine', 'Frais pro')]
    expect(findProCategory(categories, 'other')?.id).toBe('mine')
    expect(proCategoryId(categories, 'other')).toBe('mine')
    expect(proCategoryId(categories, 'subscription')).toBe('pro-abonnements')
  })
})
