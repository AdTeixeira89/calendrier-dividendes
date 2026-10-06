import { describe, expect, it } from 'vitest'
import type { Expense } from '@/types'
import { commonExpenses, expenseSpace, inSpace, spaceFields } from './spaces'

const e = (scope: 'shared' | 'personal', memberId: string | null, createdBy = 'adao') => ({ scope, memberId, createdBy }) as Expense

describe('espaces de dépenses', () => {
  it('range chaque dépense dans commun ou chez son membre', () => {
    expect(expenseSpace(e('shared', 'adao'))).toBe('commun')
    expect(expenseSpace(e('personal', 'angelique'))).toBe('angelique')
    expect(expenseSpace(e('personal', null, 'adao'))).toBe('adao')
  })

  it('sépare les trois espaces sans mélange', () => {
    const list = [e('shared', 'adao'), e('personal', 'adao'), e('personal', 'angelique'), e('shared', null)]
    expect(inSpace(list, 'commun')).toHaveLength(2)
    expect(inSpace(list, 'adao')).toHaveLength(1)
    expect(inSpace(list, 'angelique')).toHaveLength(1)
    expect(commonExpenses(list)).toHaveLength(2)
  })

  it('calcule scope et membre à enregistrer', () => {
    expect(spaceFields('commun', 'adao')).toEqual({ scope: 'shared', memberId: 'adao' })
    expect(spaceFields('angelique', 'adao')).toEqual({ scope: 'personal', memberId: 'angelique' })
  })
})
