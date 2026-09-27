import { describe, expect, it } from 'vitest'
import { savingsRatePercent, sumCents } from './money.js'

describe('sumCents', () => {
  it('additionne des montants en centimes', () => {
    expect(sumCents([1000, 250, 50])).toBe(1300)
  })

  it('retourne 0 pour un tableau vide', () => {
    expect(sumCents([])).toBe(0)
  })
})

describe('savingsRatePercent', () => {
  it('calcule un taux positif', () => {
    expect(savingsRatePercent(200000, 150000)).toBe(25)
  })

  it('calcule un taux négatif si les dépenses dépassent les revenus', () => {
    expect(savingsRatePercent(100000, 120000)).toBe(-20)
  })

  it('retourne null sans revenu', () => {
    expect(savingsRatePercent(0, 5000)).toBeNull()
  })
})
