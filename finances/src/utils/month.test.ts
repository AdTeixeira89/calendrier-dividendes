import { describe, expect, it } from 'vitest'
import { currentMonthKey, formatMonthKey, isCurrentMonth, isValidMonthKey, lastMonths, monthKey, monthRange, previousMonthKey, shiftMonth } from './month'

describe('monthKey', () => {
  it('formate une date en AAAA-MM', () => {
    expect(monthKey(new Date(2026, 8, 24))).toBe('2026-09')
    expect(monthKey(new Date(2026, 0, 1))).toBe('2026-01')
  })
})

describe('isValidMonthKey', () => {
  it.each(['2026-01', '2026-12', '1999-06'])('accepte %s', (key) => {
    expect(isValidMonthKey(key)).toBe(true)
  })
  it.each(['2026-13', '2026-00', '26-09', '2026/09', ''])('refuse %s', (key) => {
    expect(isValidMonthKey(key)).toBe(false)
  })
})

describe('navigation entre mois', () => {
  it('shiftMonth avance et recule, y compris entre années', () => {
    expect(shiftMonth('2026-09', 1)).toBe('2026-10')
    expect(shiftMonth('2026-12', 1)).toBe('2027-01')
    expect(shiftMonth('2026-01', -1)).toBe('2025-12')
  })
  it('previousMonthKey', () => {
    expect(previousMonthKey('2026-01')).toBe('2025-12')
  })
  it('lastMonths retourne les mois du plus ancien au plus récent, borne incluse', () => {
    expect(lastMonths('2026-03', 3)).toEqual(['2026-01', '2026-02', '2026-03'])
  })
})

describe('bornes de mois', () => {
  it('monthRange couvre tout le mois, borne de fin exclusive', () => {
    const { start, end } = monthRange('2026-02')
    expect(start.getMonth()).toBe(1)
    expect(start.getDate()).toBe(1)
    expect(end.getMonth()).toBe(2)
    expect(end.getDate()).toBe(1)
  })
})

describe('affichage', () => {
  it('formatMonthKey en français', () => {
    expect(formatMonthKey('2026-09')).toBe('septembre 2026')
  })
  it('isCurrentMonth / currentMonthKey', () => {
    expect(isCurrentMonth(currentMonthKey())).toBe(true)
    expect(isCurrentMonth('2000-01')).toBe(false)
  })
})
