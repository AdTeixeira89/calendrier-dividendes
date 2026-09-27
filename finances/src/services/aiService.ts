import { httpsCallable } from 'firebase/functions'
import { functions } from '@/firebase/client'

export interface AnsweredItem {
  label: string
  value: string
  source: string
}

export interface StructuredAnswer {
  data: AnsweredItem[]
  calculations: AnsweredItem[]
  estimates: AnsweredItem[]
  suggestions: string[]
}

interface AskFinanceResponse {
  answer: StructuredAnswer
  month: string
}

const askFinanceCallable = httpsCallable<{ householdId: string; question: string }, AskFinanceResponse>(functions, 'askFinance')

/**
 * Pose une question sur les finances du foyer. Les chiffres renvoyés
 * proviennent toujours des données réelles (voir functions/src/context.ts) :
 * l'IA explique, elle ne calcule jamais elle-même.
 */
export async function askFinance(householdId: string, question: string): Promise<AskFinanceResponse> {
  const { data } = await askFinanceCallable({ householdId, question })
  return data
}
