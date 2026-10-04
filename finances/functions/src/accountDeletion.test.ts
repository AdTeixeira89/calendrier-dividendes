import { describe, expect, it } from 'vitest'
import { pickSuccessor } from './accountDeletion.js'

describe('pickSuccessor', () => {
  it('préfère un membre avec droit d’écriture à un lecteur, même plus récent', () => {
    expect(pickSuccessor(['lecteur', 'membre'], { lecteur: 'viewer', membre: 'member' }, { lecteur: 1, membre: 99 })).toBe('membre')
  })

  it('à rôle égal, prend le plus ancien dans le foyer', () => {
    expect(pickSuccessor(['b', 'a'], { a: 'member', b: 'member' }, { a: 10, b: 5 })).toBe('b')
  })

  it('promeut un lecteur s’il ne reste que des lecteurs', () => {
    expect(pickSuccessor(['v1'], { v1: 'viewer' }, {})).toBe('v1')
  })
})
