import { describe, expect, it } from 'vitest'
import { safeNext } from './redirect'

describe('safeNext', () => {
  it('accepte les chemins internes', () => {
    expect(safeNext('/rejoindre?code=ABC')).toBe('/rejoindre?code=ABC')
  })
  it('refuse les redirections externes', () => {
    expect(safeNext('https://evil.example')).toBe('/')
    expect(safeNext('//evil.example')).toBe('/')
    expect(safeNext(null)).toBe('/')
  })
})
