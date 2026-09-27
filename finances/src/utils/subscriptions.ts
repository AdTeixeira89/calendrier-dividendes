import type { Cents } from '@/types'
import type { Subscription } from '@/types/subscription'

export function monthlyCost(subscription: Pick<Subscription, 'amountCents' | 'period'>): Cents {
  return subscription.period === 'yearly' ? Math.round(subscription.amountCents / 12) : subscription.amountCents
}

export function annualCost(subscription: Pick<Subscription, 'amountCents' | 'period'>): Cents {
  return subscription.period === 'yearly' ? subscription.amountCents : subscription.amountCents * 12
}

export function totalMonthlyCost(subscriptions: Pick<Subscription, 'amountCents' | 'period'>[]): Cents {
  return subscriptions.reduce((sum, s) => sum + monthlyCost(s), 0)
}

export function totalAnnualCost(subscriptions: Pick<Subscription, 'amountCents' | 'period'>[]): Cents {
  return subscriptions.reduce((sum, s) => sum + annualCost(s), 0)
}
