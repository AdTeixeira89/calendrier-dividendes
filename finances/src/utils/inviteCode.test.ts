import { describe, expect, it } from 'vitest'
import { INVITE_CODE_LENGTH, formatInviteCode, generateInviteCode, isValidInviteCode, normalizeInviteCode } from './inviteCode'

describe('codes d’invitation', () => {
  it('génère des codes valides et uniques', () => {
    const codes = new Set(Array.from({ length: 500 }, () => generateInviteCode()))
    expect(codes.size).toBe(500)
    for (const code of codes) {
      expect(code).toHaveLength(INVITE_CODE_LENGTH)
      expect(isValidInviteCode(code)).toBe(true)
    }
  })
  it('normalise la saisie', () => {
    expect(normalizeInviteCode(' abcde-fgh23 ')).toBe('ABCDEFGH23')
  })
  it('refuse les caractères ambigus', () => {
    expect(isValidInviteCode('ABCDEFGH0O')).toBe(false)
  })
  it('formate pour l’affichage', () => {
    expect(formatInviteCode('ABCDEFGH23')).toBe('ABCDE-FGH23')
  })
})
