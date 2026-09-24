import { describe, expect, it } from 'vitest'
import { formatCents, formatPercent, parseAmountToCents, percentChange } from './money'

const normalize = (s: string) => s.replace(/[\u00a0\u202f]/g, ' ')

describe('formatCents', () => {
  it('formate des centimes en euros', () => {
    expect(normalize(formatCents(215000))).toBe('2 150,00 €')
    expect(normalize(formatCents(8742))).toBe('87,42 €')
  })
  it('arrondit en mode compact', () => {
    expect(normalize(formatCents(215049, 'EUR', { compact: true }))).toBe('2 150 €')
  })
})

describe('parseAmountToCents', () => {
  it.each([
    ['87,42', 8742],
    ['87.4', 8740],
    ['1 234,56', 123456],
    ['12 €', 1200],
    ['0,05', 5],
    ['-10', -1000],
  ])('%s → %i', (input, expected) => {
    expect(parseAmountToCents(input)).toBe(expected)
  })
  it.each(['', 'abc', '1,234', '12.345', '1.2.3'])('refuse « %s »', (input) => {
    expect(parseAmountToCents(input)).toBeNull()
  })
})

describe('pourcentages', () => {
  it('calcule une variation', () => {
    expect(percentChange(108.4, 100)).toBeCloseTo(8.4)
    expect(percentChange(10, 0)).toBeNull()
  })
  it('formate avec signe', () => {
    expect(normalize(formatPercent(8.4, { signed: true }))).toBe('+8,4 %')
    expect(normalize(formatPercent(37.69))).toBe('37,7 %')
  })
})
