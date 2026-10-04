import type { Category, Expense, IncomeType } from '@/types'

/** Majuscules sans accents, pour comparer des libellés bancaires. */
export function fold(text: string): string {
  return text.normalize('NFD').replace(/\p{M}/gu, '').toUpperCase()
}

const NOISE = new Set(['CARTE', 'CB', 'PAIEMENT', 'ACHAT', 'PRLV', 'PRELEVEMENT', 'SEPA', 'VIR', 'VIREMENT', 'INST', 'RETRAIT', 'DAB', 'FACTURE', 'FACT', 'REF', 'ECH', 'ECHEANCE'])

/** Mots utiles d'un libellé : « CARTE X1234 03/10 CARREFOUR MARKET » → « CARREFOUR MARKET ». */
export function merchantKey(label: string): string {
  const tokens = fold(label)
    .replace(/[^A-Z0-9 ]+/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 1 && !NOISE.has(t) && !/\d/.test(t))
  return tokens.join(' ') || fold(label).replace(/[^A-Z0-9]+/g, ' ').trim()
}

/** Nom lisible à enregistrer : « CARREFOUR MARKET » → « Carrefour Market ». */
export function cleanMerchant(label: string): string {
  const key = merchantKey(label)
  const text = key || label.trim()
  return text
    .toLowerCase()
    .replace(/(^|\s)\S/g, (c) => c.toUpperCase())
    .slice(0, 60)
}

export type Suggestion = 'history' | 'rule' | 'none'

/** Règles de commerçants courants, par nom de catégorie par défaut. Un mot par entrée, ou une expression. */
const RULES: Record<string, string[]> = {
  Alimentation: ['CARREFOUR', 'LECLERC', 'AUCHAN', 'LIDL', 'ALDI', 'INTERMARCHE', 'MONOPRIX', 'CASINO', 'FRANPRIX', 'PICARD', 'BOULANGERIE', 'BOUCHERIE', 'SUPER U', 'U EXPRESS', 'GRAND FRAIS', 'BIOCOOP', 'NATURALIA', 'DELIVEROO', 'UBER EATS', 'RESTAURANT', 'BRASSERIE', 'CAFE', 'PIZZA', 'PIZZERIA', 'SUSHI', 'PATISSERIE', 'TRAITEUR', 'MCDONALD', 'MCDO', 'BURGER KING', 'KFC', 'SUBWAY'],
  Transport: ['SNCF', 'OUIGO', 'RATP', 'NAVIGO', 'BLABLACAR', 'UBER', 'BOLT', 'PEAGE', 'VINCI AUTOROUTES', 'APRR', 'SANEF', 'ASF', 'PARKING', 'PAYBYPHONE', 'ESSO', 'SHELL', 'AVIA', 'TOTAL ACCESS', 'BP', 'CARBURANT', 'AIR FRANCE', 'RYANAIR', 'EASYJET'],
  Énergie: ['EDF', 'ENGIE', 'TOTALENERGIES', 'ENI', 'VEOLIA', 'SUEZ', 'EAU', 'GAZ', 'ELECTRICITE', 'ENERCOOP'],
  Communication: ['ORANGE', 'SFR', 'BOUYGUES', 'FREE MOBILE', 'FREE', 'SOSH', 'RED BY SFR', 'B AND YOU', 'LA POSTE MOBILE', 'LEBARA', 'INTERNET'],
  Logement: ['LOYER', 'FONCIA', 'NEXITY', 'LEROY MERLIN', 'CASTORAMA', 'IKEA', 'BRICO', 'SYNDIC', 'ASSURANCE HABITATION', 'MRH'],
  Loisirs: ['NETFLIX', 'SPOTIFY', 'DISNEY', 'CANAL', 'AMAZON PRIME', 'DEEZER', 'STEAM', 'CINEMA', 'UGC', 'PATHE', 'GAUMONT', 'FNAC', 'DECATHLON', 'APPLE COM BILL', 'GOOGLE PLAY', 'YOUTUBE', 'DISNEYLAND', 'ZOO', 'MUSEE'],
  Enfants: ['CRECHE', 'ECOLE', 'CANTINE', 'PERISCOLAIRE', 'GARDERIE', 'NOUNOU', 'JOUET', 'KING JOUET', 'ORCHESTRA', 'OBAIBI'],
  Impôts: ['DGFIP', 'IMPOT', 'IMPOTS', 'TRESOR PUBLIC', 'TAXE', 'AMENDE', 'ANTAI'],
  Finances: ['ASSURANCE', 'AXA', 'MAIF', 'MACIF', 'MATMUT', 'ALLIANZ', 'GROUPAMA', 'GMF', 'MUTUELLE', 'FRAIS BANCAIRE', 'COTISATION CARTE', 'AGIOS', 'COMMISSION'],
}

const INTERNAL_TRANSFER = /\bVIR(EMENT)?\b.*\b(LIVRET|LDDS|LEP|PEL|EPARGNE|COMPTE (JOINT|COURANT|EPARGNE))\b|\bVIREMENT (INTERNE|ENTRE (MES )?COMPTES)\b|\bVERS (LIVRET|LDDS|PEL|EPARGNE)\b/

/** Virement entre ses propres comptes : ni une dépense ni un revenu. */
export function isInternalTransfer(label: string): boolean {
  return INTERNAL_TRANSFER.test(fold(label))
}

export function guessIncomeType(label: string): { type: IncomeType; monthly: boolean } {
  const text = fold(label)
  if (/SALAIRE|\bPAIE\b|REMUNERATION/.test(text)) return { type: 'salary', monthly: true }
  if (/\bCAF\b|ALLOCATION|FRANCE TRAVAIL|POLE EMPLOI|CPAM|RETRAITE|PRIME ACTIVITE/.test(text)) return { type: 'benefits', monthly: false }
  if (/LOYER|LOCATAIRE/.test(text)) return { type: 'rental', monthly: false }
  if (/REMBOURSEMENT|\bREMB\b/.test(text)) return { type: 'reimbursement', monthly: false }
  return { type: 'other', monthly: false }
}

export type PaymentGuess = 'card' | 'transfer' | 'cash' | 'check' | 'direct_debit' | 'other'

export function guessPaymentMethod(label: string): PaymentGuess {
  const text = fold(label)
  if (/^(CARTE|PAIEMENT CB|PAIEMENT PAR CARTE|CB)\b/.test(text)) return 'card'
  if (/\bPRLV\b|PRELEVEMENT/.test(text)) return 'direct_debit'
  if (/\bVIR\b|VIREMENT/.test(text)) return 'transfer'
  if (/CHEQUE|\bCHQ\b/.test(text)) return 'check'
  if (/RETRAIT|\bDAB\b/.test(text)) return 'cash'
  return 'other'
}

/** Ce que le foyer a déjà rangé : commerçant → catégorie la plus fréquente. */
export interface HistoryIndex {
  byKey: Map<string, Map<string, number>>
  byFirstWord: Map<string, Map<string, number>>
}

function firstWord(key: string): string | null {
  const word = key.split(' ')[0] ?? ''
  return word.length >= 4 ? word : null
}

function bump(map: Map<string, Map<string, number>>, key: string, categoryId: string) {
  const counts = map.get(key) ?? new Map<string, number>()
  counts.set(categoryId, (counts.get(categoryId) ?? 0) + 1)
  map.set(key, counts)
}

export function buildHistoryIndex(expenses: Pick<Expense, 'merchant' | 'categoryId'>[]): HistoryIndex {
  const index: HistoryIndex = { byKey: new Map(), byFirstWord: new Map() }
  for (const e of expenses) {
    if (!e.merchant) continue
    const key = merchantKey(e.merchant)
    if (!key) continue
    bump(index.byKey, key, e.categoryId)
    const word = firstWord(key)
    if (word) bump(index.byFirstWord, word, e.categoryId)
  }
  return index
}

const mostFrequent = (counts: Map<string, number> | undefined) => (counts ? [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] : undefined)

function categoryIdByName(name: string, categories: Category[]): string | null {
  const wanted = fold(name)
  return categories.find((c) => c.kind === 'expense' && !c.archived && fold(c.name) === wanted)?.id ?? null
}

/**
 * Catégorie probable d'une dépense : d'abord ce que le foyer a déjà fait pour
 * ce commerçant, puis les règles de commerçants courants. `none` = à choisir.
 */
export function suggestCategory(label: string, history: HistoryIndex, categories: Category[]): { categoryId: string | null; source: Suggestion } {
  const key = merchantKey(label)
  const usable = (id: string | undefined) => (id && categories.some((c) => c.id === id && !c.archived) ? id : null)

  const exact = usable(mostFrequent(history.byKey.get(key)))
  if (exact) return { categoryId: exact, source: 'history' }
  const word = firstWord(key)
  const similar = word ? usable(mostFrequent(history.byFirstWord.get(word))) : null
  if (similar) return { categoryId: similar, source: 'history' }

  const padded = ` ${key} `
  for (const [name, keywords] of Object.entries(RULES)) {
    if (keywords.some((k) => padded.includes(` ${k} `))) {
      const id = categoryIdByName(name, categories)
      if (id) return { categoryId: id, source: 'rule' }
    }
  }
  return { categoryId: null, source: 'none' }
}
