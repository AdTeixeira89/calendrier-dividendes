import Anthropic from '@anthropic-ai/sdk'
import type { HouseholdFacts } from './context.js'

export interface AnsweredItem {
  label: string
  value: string
  /** Clé d'un fait du contexte (`HouseholdFacts.items[].key`) — jamais une valeur inventée. */
  source: string
}

export interface StructuredAnswer {
  data: AnsweredItem[]
  calculations: AnsweredItem[]
  estimates: AnsweredItem[]
  suggestions: string[]
}

export interface AIProvider {
  complete(question: string, facts: HouseholdFacts): Promise<StructuredAnswer>
}

export class InvalidAIResponseError extends Error {}

const SYSTEM_PROMPT = `Tu es un conseiller financier familial. Tu ne calcules jamais toi-même : tu ne fais que
citer et expliquer des faits déjà calculés, fournis dans le contexte, chacun identifié par une clé "key".

Réponds UNIQUEMENT avec un objet JSON de cette forme, sans texte autour :
{
  "data": [{ "label": string, "value": string, "source": "<key du contexte>" }],
  "calculations": [{ "label": string, "value": string, "source": "<key du contexte>" }],
  "estimates": [{ "label": string, "value": string, "source": "<key du contexte>" }],
  "suggestions": ["<conseil texte libre, sans chiffre inventé>"]
}

Règles impératives :
- Chaque "source" DOIT être une clé qui existe dans le contexte fourni. N'invente jamais de clé.
- N'écris aucun chiffre qui ne provienne pas directement d'un fait du contexte.
- "estimates" sert aux projections (ex. date d'atteinte d'un objectif) : explique le raisonnement dans "value", mais base-le sur les faits fournis.
- "suggestions" peut contenir des conseils qualitatifs, jamais de nouveaux chiffres.
- Si le contexte ne permet pas de répondre, dis-le dans "suggestions" et laisse les autres tableaux vides.`

export function validateStructuredAnswer(answer: unknown, facts: HouseholdFacts): StructuredAnswer {
  const validKeys = new Set(facts.items.map((f) => f.key))
  if (typeof answer !== 'object' || answer === null) throw new InvalidAIResponseError('Réponse IA non structurée')
  const a = answer as Record<string, unknown>

  function checkItems(field: string): AnsweredItem[] {
    const list = a[field]
    if (!Array.isArray(list)) throw new InvalidAIResponseError(`Champ "${field}" manquant ou invalide`)
    return list.map((raw) => {
      if (typeof raw !== 'object' || raw === null) throw new InvalidAIResponseError(`Élément invalide dans "${field}"`)
      const item = raw as Record<string, unknown>
      const { label, value, source } = item
      if (typeof label !== 'string' || typeof value !== 'string' || typeof source !== 'string') {
        throw new InvalidAIResponseError(`Élément mal formé dans "${field}"`)
      }
      if (!validKeys.has(source)) {
        throw new InvalidAIResponseError(`Source inconnue "${source}" dans "${field}" : donnée non vérifiable, rejetée.`)
      }
      return { label, value, source }
    })
  }

  const suggestions = a.suggestions
  if (!Array.isArray(suggestions) || suggestions.some((s) => typeof s !== 'string')) {
    throw new InvalidAIResponseError('Champ "suggestions" manquant ou invalide')
  }

  return {
    data: checkItems('data'),
    calculations: checkItems('calculations'),
    estimates: checkItems('estimates'),
    suggestions: suggestions as string[],
  }
}

export class ClaudeProvider implements AIProvider {
  private client: Anthropic

  constructor(apiKey: string) {
    this.client = new Anthropic({ apiKey })
  }

  async complete(question: string, facts: HouseholdFacts): Promise<StructuredAnswer> {
    const contextText = facts.items.map((f) => `- [${f.key}] ${f.label} : ${f.value}`).join('\n')
    const message = await this.client.messages.create({
      model: 'claude-sonnet-5',
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: 'user',
          content: `Contexte financier du foyer (mois ${facts.month}) :\n${contextText}\n\nQuestion : ${question}`,
        },
      ],
    })

    const textBlock = message.content.find((b): b is Anthropic.TextBlock => b.type === 'text')
    if (!textBlock) throw new InvalidAIResponseError('Réponse IA vide')

    let parsed: unknown
    try {
      parsed = JSON.parse(textBlock.text)
    } catch {
      throw new InvalidAIResponseError('Réponse IA non-JSON')
    }
    return validateStructuredAnswer(parsed, facts)
  }
}
