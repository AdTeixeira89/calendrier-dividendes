/// <reference types="node" />
// @vitest-environment node
import { readFileSync } from 'node:fs'
import readExcelFile from 'read-excel-file/node'
import { describe, expect, it } from 'vitest'
import { parseBankSheets, cellToText, detectStatementKind } from './statementFile'

describe('relevé Excel', () => {
  it('lit un vrai classeur .xlsx : onglet de résumé ignoré, débit / crédit, dates Excel', async () => {
    const sheets = await readExcelFile(readFileSync('src/utils/__fixtures__/releve.xlsx'))
    const result = parseBankSheets(sheets as never)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.rows).toHaveLength(4)
    const [carrefour, edf, salaire, netflix] = result.rows
    expect(carrefour).toMatchObject({ label: 'CB CARREFOUR MARKET 05/10', amountCents: -8742 })
    expect(carrefour!.date.getFullYear() * 10000 + (carrefour!.date.getMonth() + 1) * 100 + carrefour!.date.getDate()).toBe(20261006)
    expect(edf!.amountCents).toBe(-6490)
    expect(salaire!.amountCents).toBe(250000)
    expect(netflix!.amountCents).toBe(-1349)
  })

  it('convertit les cellules comme un CSV (nombres à virgule, dates sans glissement)', () => {
    expect(cellToText(-12.5)).toBe('-12,5')
    expect(cellToText(new Date(Date.UTC(2026, 9, 6)))).toBe('06/10/2026')
    expect(cellToText(null)).toBe('')
    expect(cellToText('  CB   FNAC ')).toBe('CB FNAC')
  })

  it('lit des dates Excel stockées comme numéros de série, montant signé', () => {
    const result = parseBankSheets([{ data: [['Date', 'Description', 'Montant'], [46300, 'CB FNAC', -45.9], [46301, 'VIR REMBOURSEMENT', 20]] }])
    expect(result.ok && result.rows.map((r) => [r.date.getMonth() + 1, r.date.getDate(), r.amountCents])).toEqual([[10, 5, -4590], [10, 6, 2000]])
  })

  it('signale un classeur sans relevé exploitable', () => {
    const result = parseBankSheets([{ data: [['Titre'], ['rien ici']] }])
    expect(result.ok).toBe(false)
  })

  it('reconnaît le format d’après le contenu', () => {
    expect(detectStatementKind(new Uint8Array([0x50, 0x4b, 3, 4]))).toBe('xlsx')
    expect(detectStatementKind(new Uint8Array([0xd0, 0xcf, 0x11, 0xe0]))).toBe('xls')
    expect(detectStatementKind(new TextEncoder().encode('Date;Libelle'))).toBe('text')
  })
})
