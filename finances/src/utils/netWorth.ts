import type { Asset, Cents, Debt } from '@/types'
import type { MonthKey } from './month'
import { monthRange } from './month'

function activeAssets(assets: Asset[]): Asset[] {
  return assets.filter((a) => !a.archived)
}

export function totalAssetsCents(assets: Asset[]): Cents {
  return activeAssets(assets).reduce((total, a) => total + a.valueCents, 0)
}

export function totalDebtsOutstandingCents(debts: Debt[]): Cents {
  return debts.filter((d) => !d.archived).reduce((total, d) => total + d.outstandingCents, 0)
}

/** Patrimoine net = actifs − dettes restant dues. */
export function netWorthCents(assets: Asset[], debts: Debt[]): Cents {
  return totalAssetsCents(assets) - totalDebtsOutstandingCents(debts)
}

export interface TypeTotal {
  type: Asset['type']
  valueCents: Cents
}

/** Valeur totale des actifs par type, du plus gros au plus petit poste. */
export function totalsByAssetType(assets: Asset[]): TypeTotal[] {
  const byType = new Map<Asset['type'], Cents>()
  for (const a of activeAssets(assets)) {
    byType.set(a.type, (byType.get(a.type) ?? 0) + a.valueCents)
  }
  return [...byType.entries()].map(([type, valueCents]) => ({ type, valueCents })).sort((a, b) => b.valueCents - a.valueCents)
}

/**
 * Valeur connue d'un actif à une date donnée, d'après son historique de
 * valorisations. `null` si l'actif n'avait pas encore été valorisé à cette
 * date (jamais une valeur inventée).
 */
export function assetValueAt(asset: Asset, date: Date): Cents | null {
  const timeline = [...asset.history.map((h) => ({ date: h.date.toDate(), valueCents: h.valueCents })), { date: asset.valuedAt.toDate(), valueCents: asset.valueCents }].sort(
    (a, b) => a.date.getTime() - b.date.getTime(),
  )
  let known: Cents | null = null
  for (const point of timeline) {
    if (point.date.getTime() > date.getTime()) break
    known = point.valueCents
  }
  return known
}

export interface NetWorthPoint {
  month: MonthKey
  netWorthCents: Cents
}

/**
 * Évolution du patrimoine net sur une liste de mois : actifs reconstitués
 * depuis leur historique de valorisation, dettes au montant actuel (faute
 * d'historique — même approximation que le reste de l'app, cf. Analyse).
 * Les mois antérieurs à toute valorisation sont omis : afficher « dettes
 * seules » avant que le suivi ait commencé serait une donnée inventée.
 */
export function netWorthTrend(assets: Asset[], debts: Debt[], months: MonthKey[]): NetWorthPoint[] {
  const activeDebtsTotal = totalDebtsOutstandingCents(debts)
  const points: NetWorthPoint[] = []
  for (const month of months) {
    const { end } = monthRange(month)
    const asOf = new Date(end.getTime() - 1)
    const values = activeAssets(assets).map((a) => assetValueAt(a, asOf))
    if (points.length === 0 && values.every((v) => v === null)) continue
    const assetsTotal = values.reduce<Cents>((total, v) => total + (v ?? 0), 0)
    points.push({ month, netWorthCents: assetsTotal - activeDebtsTotal })
  }
  return points
}
