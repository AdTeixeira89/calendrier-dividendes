import { describe, expect, it } from 'vitest'
import { decodeStatement, parseBankCsv, parseStatementAmount, parseStatementDate } from './bankStatement'

const ok = (text: string) => {
  const result = parseBankCsv(text)
  if (!result.ok) throw new Error(result.error)
  return result
}
const day = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

describe('parseStatementAmount', () => {
  it.each([
    ['45,60', 4560],
    ['-45,60', -4560],
    ['1 234,56', 123456],
    ['1 234,56', 123456],
    ['1.234,56', 123456],
    ['1,234.56', 123456],
    ['(12,50)', -1250],
    ['12,50-', -1250],
    ['+12.5', 1250],
    ['12,50 €', 1250],
    ['1.234', 123400],
    ['0,05', 5],
  ])('%s → %i centimes', (raw, cents) => expect(parseStatementAmount(raw)).toBe(cents))

  it.each(['', 'abc', '12,34,56,7', '--5'])('refuse « %s »', (raw) => expect(parseStatementAmount(raw)).toBeNull())
})

describe('parseStatementDate', () => {
  it('accepte les formats courants et refuse les dates impossibles', () => {
    expect(day(parseStatementDate('24/09/2026')!)).toBe('2026-09-24')
    expect(day(parseStatementDate('24-09-26')!)).toBe('2026-09-24')
    expect(day(parseStatementDate('2026-09-24 10:32:00')!)).toBe('2026-09-24')
    expect(day(parseStatementDate('24.09.2026')!)).toBe('2026-09-24')
    expect(parseStatementDate('31/02/2026')).toBeNull()
    expect(parseStatementDate('Solde')).toBeNull()
  })
})

describe('parseBankCsv', () => {
  it('lit un relevé « Date;Libellé;Débit;Crédit » (virgule décimale, milliers avec espace)', () => {
    const { rows, skipped } = ok(
      ['Date;Libellé;Débit;Crédit', '03/10/2026;CARTE X1234 CARREFOUR MARKET;45,60;', '01/10/2026;VIR SALAIRE ENTREPRISE;;2 150,00'].join('\n'),
    )
    expect(skipped).toBe(0)
    expect(rows.map((r) => [day(r.date), r.amountCents])).toEqual([
      ['2026-10-03', -4560],
      ['2026-10-01', 215000],
    ])
    expect(rows[0]!.label).toBe('CARTE X1234 CARREFOUR MARKET')
  })

  it('lit un montant signé unique, des lignes d’en-tête de banque avant le tableau et des champs entre guillemets', () => {
    const { rows } = ok(
      [
        'Compte courant n° 00012345678',
        'Période du 01/09/2026 au 30/09/2026',
        '',
        'Date opération;Date valeur;Libellé;Montant;Devise',
        '"29/09/2026";"30/09/2026";"PRLV SEPA ORANGE; FACTURE 09";"-39,99";"EUR"',
      ].join('\n'),
    )
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ label: 'PRLV SEPA ORANGE; FACTURE 09', amountCents: -3999 })
    expect(day(rows[0]!.date)).toBe('2026-09-29')
  })

  it('lit un export anglais séparé par des virgules (montants avec point décimal)', () => {
    const { rows } = ok(['Date,Description,Amount,Balance', '2026-09-24,"Coffee, Paris",-3.50,100.00', '2026-09-25,Refund,12.00,112.00'].join('\n'))
    expect(rows.map((r) => r.amountCents)).toEqual([-350, 1200])
    expect(rows[0]!.label).toBe('Coffee, Paris')
  })

  it('sans en-tête, devine les colonnes d’après leur contenu', () => {
    const { rows } = ok(['03/10/2026;CARREFOUR MARKET;-45,60', '02/10/2026;EDF;-82,10', '01/10/2026;SALAIRE;2150,00'].join('\n'))
    expect(rows.map((r) => r.amountCents)).toEqual([-4560, -8210, 215000])
    expect(rows[2]!.label).toBe('SALAIRE')
  })

  it('compte les lignes inexploitables (totaux, soldes) sans faire échouer l’import', () => {
    const { rows, skipped } = ok(['Date;Libellé;Débit;Crédit', '03/10/2026;CARREFOUR;10,00;', 'Total;;10,00;', '04/10/2026;;5,00;'].join('\n'))
    expect(rows).toHaveLength(1)
    expect(skipped).toBe(2)
  })

  it('un débit saisi en négatif reste une dépense', () => {
    const { rows } = ok(['Date;Libellé;Débit;Crédit', '03/10/2026;CARREFOUR;-10,00;'].join('\n'))
    expect(rows[0]!.amountCents).toBe(-1000)
  })

  it('explique clairement un fichier qui n’est pas un relevé', () => {
    expect(parseBankCsv('juste du texte')).toMatchObject({ ok: false })
    expect(parseBankCsv('a;b;c\n1;2;3')).toMatchObject({ ok: false, error: expect.stringContaining('Colonnes non reconnues') })
  })
})

describe('decodeStatement', () => {
  it('relit un fichier Windows-1252 (accents des banques françaises) et ignore le BOM UTF-8', () => {
    const latin1 = Uint8Array.from([...'Libell'].map((c) => c.charCodeAt(0)).concat([0xe9]))
    expect(decodeStatement(latin1.buffer)).toBe('Libellé')
    const utf8 = new TextEncoder().encode('﻿Libellé')
    expect(decodeStatement(utf8.buffer as ArrayBuffer)).toBe('Libellé')
  })
})
