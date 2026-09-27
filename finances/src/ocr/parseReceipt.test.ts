import { describe, expect, it } from 'vitest'
import { parseReceiptText } from './parseReceipt'

describe('parseReceiptText', () => {
  it('extrait le total explicitement libellé, la date et le commerçant', () => {
    const text = `LECLERC\n12 RUE DE LA PAIX\n24/09/2026\nPAIN 1,20\nLAIT 0,95\nTOTAL 87,42\nCARTE BANCAIRE`
    const result = parseReceiptText(text)
    expect(result.merchant).toBe('LECLERC')
    expect(result.date).toBe('2026-09-24')
    expect(result.totalCents).toBe(8742)
    expect(result.confidence).toBe('high')
  })

  it('reconnaît différents libellés de total (montant, à payer, net à payer)', () => {
    expect(parseReceiptText('Montant : 12,50').totalCents).toBe(1250)
    expect(parseReceiptText('A PAYER 99,00 EUR').totalCents).toBe(9900)
    expect(parseReceiptText('Net à payer  5,00').totalCents).toBe(500)
  })

  it('sans libellé, retient le plus gros montant comme estimation du total', () => {
    const result = parseReceiptText('PAIN 1,20\nLAIT 0,95\n2,15')
    expect(result.totalCents).toBe(215)
    expect(result.confidence).toBe('low')
  })

  it('gère les formats de date avec points ou tirets, année sur 2 chiffres', () => {
    expect(parseReceiptText('Achat le 05.01.2026 Total 10,00').date).toBe('2026-01-05')
    expect(parseReceiptText('05-01-26 Total 10,00').date).toBe('2026-01-05')
  })

  it("confiance faible si le montant ou la date sont introuvables", () => {
    expect(parseReceiptText('Bonjour, aucune info utile ici.').confidence).toBe('low')
    expect(parseReceiptText('Total 10,00 mais pas de date').confidence).toBe('low')
  })

  it('renvoie des valeurs nulles sur un texte vide', () => {
    const result = parseReceiptText('')
    expect(result).toEqual({ merchant: null, date: null, totalCents: null, confidence: 'low' })
  })
})
