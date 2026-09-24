// Alphabet sans caractères ambigus (0/O, 1/I/L) pour une saisie facile au téléphone.
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
export const INVITE_CODE_LENGTH = 10

/** Code aléatoire cryptographiquement sûr (~49 bits d'entropie). */
export function generateInviteCode(length = INVITE_CODE_LENGTH): string {
  const bytes = new Uint8Array(length)
  crypto.getRandomValues(bytes)
  let code = ''
  for (const byte of bytes) {
    // 248 = plus grand multiple de 31 ≤ 256 : on rejette le reste pour éviter tout biais.
    if (byte >= 248) return generateInviteCode(length)
    code += ALPHABET[byte % ALPHABET.length]
  }
  return code
}

/** "abcd-efgh 23" → "ABCDEFGH23" */
export function normalizeInviteCode(input: string): string {
  return input.toUpperCase().replace(/[^A-Z0-9]/g, '')
}

export function isValidInviteCode(code: string): boolean {
  return code.length === INVITE_CODE_LENGTH && [...code].every((c) => ALPHABET.includes(c))
}

/** "ABCDEFGH23" → "ABCDE-FGH23" (affichage) */
export function formatInviteCode(code: string): string {
  const half = Math.ceil(code.length / 2)
  return `${code.slice(0, half)}-${code.slice(half)}`
}
