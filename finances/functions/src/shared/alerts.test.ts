import { describe, expect, it } from 'vitest'
import { DEFAULT_ALERT_SETTINGS, evaluateAlerts, nextOccurrence, withDefaultSettings, type AlertInput } from './alerts.js'

const normalize = (s: string) => s.replace(/[\u00a0\u202f]/g, ' ')

function input(overrides: Partial<AlertInput> = {}): AlertInput {
  return {
    today: new Date(2026, 8, 20),
    month: '2026-09',
    expenses: [],
    incomeCents: 0,
    debtMonthlyCents: 0,
    budgetLines: {},
    categoryNames: { food: 'Alimentation' },
    subscriptions: [],
    previousMonth: null,
    settings: DEFAULT_ALERT_SETTINGS,
    ...overrides,
  }
}

describe('evaluateAlerts — budgets', () => {
  it('signale un budget dépassé', () => {
    const alerts = evaluateAlerts(input({ budgetLines: { food: 30000 }, expenses: [{ amountCents: 32000, categoryId: 'food' }] }))
    expect(alerts).toHaveLength(1)
    expect(alerts[0]!.key).toBe('budget-exceeded:2026-09:food')
    expect(alerts[0]!.severity).toBe('danger')
    expect(normalize(alerts[0]!.message)).toContain('+20,00 €')
  })

  it('prévient à partir du seuil réglé', () => {
    const alerts = evaluateAlerts(input({ budgetLines: { food: 30000 }, expenses: [{ amountCents: 27500, categoryId: 'food' }] }))
    expect(alerts.map((a) => a.key)).toEqual(['budget-warning:2026-09:food'])
    expect(alerts[0]!.title).toContain('92 %')
  })

  it('reste silencieux sous le seuil ou si la règle est désactivée', () => {
    expect(evaluateAlerts(input({ budgetLines: { food: 30000 }, expenses: [{ amountCents: 10000, categoryId: 'food' }] }))).toEqual([])
    const settings = withDefaultSettings({ budget: { enabled: false, warnPercent: 90 } })
    expect(evaluateAlerts(input({ settings, budgetLines: { food: 100 }, expenses: [{ amountCents: 5000, categoryId: 'food' }] }))).toEqual([])
  })
})

describe('evaluateAlerts — dépenses supérieures aux revenus', () => {
  it('compte les mensualités de prêts comme des dépenses', () => {
    const alerts = evaluateAlerts(input({ incomeCents: 200000, debtMonthlyCents: 90000, expenses: [{ amountCents: 120000, categoryId: 'x' }] }))
    expect(alerts.map((a) => a.key)).toEqual(['overspend:2026-09'])
    expect(normalize(alerts[0]!.message)).toContain('100,00 €')
  })

  it("ne dit rien tant qu'aucun revenu n'est saisi (début de mois)", () => {
    expect(evaluateAlerts(input({ incomeCents: 0, expenses: [{ amountCents: 5000, categoryId: 'x' }] }))).toEqual([])
  })
})

describe('evaluateAlerts — abonnements', () => {
  const sub = { id: 's1', name: 'Netflix', amountCents: 1500, period: 'monthly' as const, archived: false }

  it('annonce un prélèvement dans la fenêtre réglée', () => {
    const alerts = evaluateAlerts(input({ subscriptions: [{ ...sub, nextDate: new Date(2026, 8, 22, 12) }] }))
    expect(alerts.map((a) => a.key)).toEqual(['subscription:s1:2026-09-22'])
    expect(alerts[0]!.message).toContain('22 septembre')
  })

  it('fait avancer une date passée au mois (ou à l’année) suivant', () => {
    const monthly = evaluateAlerts(input({ subscriptions: [{ ...sub, nextDate: new Date(2026, 6, 21) }] }))
    expect(monthly.map((a) => a.key)).toEqual(['subscription:s1:2026-09-21'])
    const yearly = evaluateAlerts(input({ subscriptions: [{ ...sub, period: 'yearly', nextDate: new Date(2024, 8, 22) }] }))
    expect(yearly.map((a) => a.key)).toEqual(['subscription:s1:2026-09-22'])
  })

  it('borne le jour à la fin du mois (un 31 devient un 30)', () => {
    expect(nextOccurrence(new Date(2026, 7, 31), 'monthly', new Date(2026, 8, 20))).toEqual(new Date(2026, 8, 30))
  })

  it('ignore les prélèvements passés, lointains ou archivés', () => {
    const subscriptions = [
      { ...sub, id: 'past', nextDate: new Date(2026, 8, 19) }, // avance au 19 octobre : hors fenêtre,
      { ...sub, id: 'far', nextDate: new Date(2026, 8, 30) },
      { ...sub, id: 'archived', archived: true, nextDate: new Date(2026, 8, 21) },
      { ...sub, id: 'nodate', nextDate: null },
    ]
    expect(evaluateAlerts(input({ subscriptions }))).toEqual([])
  })
})

describe("evaluateAlerts — taux d'épargne du mois précédent", () => {
  it("signale un taux sous l'objectif", () => {
    const alerts = evaluateAlerts(input({ previousMonth: { month: '2026-08', incomeCents: 300000, expenseCents: 285000 } }))
    expect(alerts.map((a) => a.key)).toEqual(['savings-rate:2026-08'])
    expect(alerts[0]!.title).toBe("Taux d'épargne de août : 5 %")
  })

  it("se tait si l'objectif est atteint ou sans revenu", () => {
    expect(evaluateAlerts(input({ previousMonth: { month: '2026-08', incomeCents: 300000, expenseCents: 200000 } }))).toEqual([])
    expect(evaluateAlerts(input({ previousMonth: { month: '2026-08', incomeCents: 0, expenseCents: 5000 } }))).toEqual([])
  })
})

describe('evaluateAlerts — ordre', () => {
  it('trie les alertes de la plus grave à la moins grave', () => {
    const alerts = evaluateAlerts(
      input({
        incomeCents: 1000,
        expenses: [{ amountCents: 30000, categoryId: 'food' }],
        budgetLines: { food: 100000 },
        subscriptions: [{ id: 's', name: 'Spotify', amountCents: 1000, period: 'monthly', archived: false, nextDate: new Date(2026, 8, 21) }],
        previousMonth: { month: '2026-08', incomeCents: 1000, expenseCents: 1000 },
      }),
    )
    expect(alerts.map((a) => a.severity)).toEqual(['danger', 'warning', 'info'])
  })
})

describe('withDefaultSettings', () => {
  it('complète des réglages partiels', () => {
    expect(withDefaultSettings({ subscription: { enabled: false, daysBefore: 7 } })).toEqual({ ...DEFAULT_ALERT_SETTINGS, subscription: { enabled: false, daysBefore: 7 } })
    expect(withDefaultSettings(null)).toEqual(DEFAULT_ALERT_SETTINGS)
  })
})
