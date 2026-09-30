import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Landmark, Plus } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { AssetCard } from '@/components/finance/AssetCard'
import { AssetFormSheet } from '@/components/finance/AssetFormSheet'
import { NetWorthChart } from '@/components/finance/NetWorthChart'
import { Button, Card, EmptyState, StatCard } from '@/components/ui'
import { useAssets } from '@/hooks/useAssets'
import { useDebts } from '@/hooks/useDebts'
import { useHousehold } from '@/hooks/useHousehold'
import type { Asset } from '@/types'
import { ASSET_TYPE_LABELS } from '@/types/asset'
import { formatCents } from '@/utils/money'
import { currentMonthKey, lastMonths } from '@/utils/month'
import { netWorthCents, netWorthTrend, totalAssetsCents, totalDebtsOutstandingCents, totalsByAssetType } from '@/utils/netWorth'

export function PatrimoinePage() {
  const { household, canWrite } = useHousehold()
  const assets = useAssets(household.id)
  const debts = useDebts(household.id)
  const [params, setParams] = useSearchParams()
  const [editing, setEditing] = useState<Asset | undefined>(undefined)
  const sheetOpen = params.has('ajouter') || Boolean(editing)

  function closeSheet() {
    setEditing(undefined)
    if (params.has('ajouter')) {
      const next = new URLSearchParams(params)
      next.delete('ajouter')
      setParams(next, { replace: true })
    }
  }

  const ready = assets !== undefined && debts !== undefined
  const netWorth = ready ? netWorthCents(assets, debts) : null
  const totalAssets = ready ? totalAssetsCents(assets) : null
  const totalDebts = ready ? totalDebtsOutstandingCents(debts) : null
  const byType = ready ? totalsByAssetType(assets) : []
  const trend = ready && assets.length > 0 ? netWorthTrend(assets, debts, lastMonths(currentMonthKey(), 6)) : []

  return (
    <div className="stack animate-in">
      <PageHeader title="Patrimoine" subtitle="Vos actifs, vos dettes, et votre patrimoine net." />

      <StatCard label="Patrimoine net" amount={netWorth} tone="saving" icon={<Landmark size={16} />} footnote="Actifs moins dettes restant dues" />

      {ready && assets.length > 0 && (
        <section className="grid-cards" style={{ gridTemplateColumns: 'repeat(2, minmax(0,1fr))' }}>
          <StatCard label="Total des actifs" amount={totalAssets} tone="income" />
          <StatCard label="Dettes restantes" amount={totalDebts} tone="debt" higherIsBetter={false} />
        </section>
      )}

      {trend.length >= 2 && (
        <Card title="Évolution" subtitle="6 derniers mois — dettes au montant actuel, faute d'historique">
          <NetWorthChart points={trend} />
        </Card>
      )}

      {byType.length > 0 && (
        <Card title="Répartition des actifs">
          <ul className="stack" style={{ gap: 6 }}>
            {byType.map(({ type, valueCents }) => (
              <li key={type} style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span>{ASSET_TYPE_LABELS[type]}</span>
                <strong className="num">{formatCents(valueCents)}</strong>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {canWrite && (
        <Button icon={<Plus size={18} />} onClick={() => setParams((p) => new URLSearchParams({ ...Object.fromEntries(p), ajouter: '1' }))}>
          Ajouter un actif
        </Button>
      )}

      {assets === undefined ? null : assets.length === 0 ? (
        <EmptyState icon={<Landmark size={28} />} title="Aucun actif enregistré" description="Comptes, épargne, placements, immobilier, véhicules…" />
      ) : (
        <div className="stack">
          {assets.map((asset) => (
            <AssetCard key={asset.id} asset={asset} onClick={() => setEditing(asset)} />
          ))}
        </div>
      )}

      <AssetFormSheet key={editing?.id ?? 'new'} open={sheetOpen} onClose={closeSheet} asset={editing} />
    </div>
  )
}
