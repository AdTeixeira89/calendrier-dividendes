import type { BusinessKind, Category, Cents, Expense } from '@/types'
import { fold, merchantKey } from './categorize'

/** Catégories créées automatiquement pour ranger les frais d'entreprise (identifiants fixes : jamais en double). */
export const PRO_CATEGORIES: Record<BusinessKind, { id: string; name: string; icon: string; color: string }> = {
  subscription: { id: 'pro-abonnements', name: 'Abonnements pro', icon: 'credit-card', color: 'accent' },
  other: { id: 'pro-autres', name: 'Frais pro', icon: 'briefcase', color: 'debt' },
}

/** Catégorie « pro » existante (créée à la main ou automatiquement), sinon null. */
export function findProCategory(categories: Category[], kind: BusinessKind): Category | null {
  const wanted = fold(PRO_CATEGORIES[kind].name)
  return categories.find((c) => !c.archived && (c.id === PRO_CATEGORIES[kind].id || fold(c.name) === wanted)) ?? null
}

/** Identifiant de la catégorie pro à utiliser (existante, sinon l'identifiant fixe qu'on créera). */
export function proCategoryId(categories: Category[], kind: BusinessKind): string {
  return findProCategory(categories, kind)?.id ?? PRO_CATEGORIES[kind].id
}

export const isProCategoryId = (id: string | null) => id === PRO_CATEGORIES.subscription.id || id === PRO_CATEGORIES.other.id

const SUBSCRIPTION_WORDS = ['ABONNEMENT', 'SUBSCRIPTION', 'ADOBE', 'MICROSOFT', 'OFFICE 365', 'GOOGLE WORKSPACE', 'GOOGLE', 'OPENAI', 'CHATGPT', 'ANTHROPIC', 'NOTION', 'SLACK', 'ZOOM', 'DROPBOX', 'CANVA', 'GITHUB', 'OVH', 'GANDI', 'HEROKU', 'VERCEL', 'AWS', 'AMAZON WEB SERVICES', 'FIGMA', 'MAILCHIMP', 'SHOPIFY', 'WIX', 'QONTO', 'LINKEDIN', 'APPLE COM BILL', 'ICLOUD']

/** Un libellé qui ressemble à un abonnement (logiciel, hébergement…) : proposé d'office quand on coche « frais d'entreprise ». */
export function guessBusinessKind(label: string): BusinessKind {
  const padded = ` ${merchantKey(label)} `
  return SUBSCRIPTION_WORDS.some((w) => padded.includes(` ${w} `)) || /ABONNEMENT|SUBSCRIPTION/.test(fold(label)) ? 'subscription' : 'other'
}

/** Dépenses personnelles hors frais d'entreprise : ce qui compte pour le suivi personnel. */
export function withoutBusiness<T extends Pick<Expense, 'business'>>(expenses: T[]): T[] {
  return expenses.filter((e) => !e.business)
}

export interface BusinessTotals {
  subscriptionCents: Cents
  otherCents: Cents
  totalCents: Cents
  count: number
}

export function businessTotals(expenses: Pick<Expense, 'business' | 'amountCents'>[]): BusinessTotals {
  const totals: BusinessTotals = { subscriptionCents: 0, otherCents: 0, totalCents: 0, count: 0 }
  for (const e of expenses) {
    if (!e.business) continue
    if (e.business === 'subscription') totals.subscriptionCents += e.amountCents
    else totals.otherCents += e.amountCents
    totals.totalCents += e.amountCents
    totals.count++
  }
  return totals
}
