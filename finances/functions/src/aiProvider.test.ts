import { describe, expect, it } from 'vitest'
import { InvalidAIResponseError, validateStructuredAnswer } from './aiProvider.js'
import type { HouseholdFacts } from './context.js'

const facts: HouseholdFacts = {
  month: '2026-09',
  items: [
    { key: 'total_income', label: 'Revenus du mois', value: '3 000,00 €' },
    { key: 'total_expenses', label: 'Dépenses du mois', value: '2 200,00 €' },
  ],
}

describe('validateStructuredAnswer', () => {
  it('accepte une réponse dont toutes les sources existent dans le contexte', () => {
    const answer = {
      data: [{ label: 'Revenus', value: '3 000,00 €', source: 'total_income' }],
      calculations: [],
      estimates: [],
      suggestions: ['Continuez ainsi.'],
    }
    expect(validateStructuredAnswer(answer, facts)).toEqual(answer)
  })

  it("rejette une réponse citant une source qui n'existe pas dans le contexte (donnée inventée)", () => {
    const answer = {
      data: [{ label: 'Patrimoine net', value: '50 000,00 €', source: 'net_worth' }],
      calculations: [],
      estimates: [],
      suggestions: [],
    }
    expect(() => validateStructuredAnswer(answer, facts)).toThrow(InvalidAIResponseError)
  })

  it('rejette une réponse mal formée (champ manquant)', () => {
    expect(() => validateStructuredAnswer({ data: [] }, facts)).toThrow(InvalidAIResponseError)
  })

  it('rejette un élément sans source', () => {
    const answer = { data: [{ label: 'x', value: 'y' }], calculations: [], estimates: [], suggestions: [] }
    expect(() => validateStructuredAnswer(answer, facts)).toThrow(InvalidAIResponseError)
  })
})
