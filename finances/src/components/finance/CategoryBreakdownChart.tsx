import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts'
import { PieChart as PieIcon } from 'lucide-react'
import { EmptyState } from '@/components/ui'
import { toneSolid, type Tone } from '@/components/ui/tone'
import type { Category, Expense } from '@/types'
import { categoryBreakdown } from '@/utils/categoryBreakdown'
import { formatCents } from '@/utils/money'

/**
 * Répartition des dépenses par catégorie : les catégories, leurs dépenses et leurs montants sont
 * lus automatiquement (`categoryBreakdown`) pour remplir le diagramme et la légende chiffrée.
 */
export function CategoryBreakdownChart({ expenses, categories }: { expenses: Expense[]; categories: Category[] }) {
  const { totalCents, slices } = categoryBreakdown(expenses, categories)

  if (slices.length === 0) {
    return <EmptyState icon={<PieIcon size={28} />} title="Rien à afficher" description="Ajoutez des dépenses pour voir leur répartition." />
  }

  const data = slices.map((s) => ({ name: s.name, value: s.amountCents / 100, color: toneSolid(s.color as Tone) }))

  return (
    <div>
      <div style={{ position: 'relative', width: '100%', height: 220 }} role="img" aria-label={`Répartition des dépenses par catégorie, total ${formatCents(totalCents)}`}>
        <ResponsiveContainer>
          <PieChart>
            <Pie data={data} dataKey="value" nameKey="name" innerRadius={62} outerRadius={96} paddingAngle={2} stroke="var(--surface-solid)" strokeWidth={2} isAnimationActive={false}>
              {data.map((entry) => (
                <Cell key={entry.name} fill={entry.color} />
              ))}
            </Pie>
            <Tooltip
              formatter={(value) => formatCents(Math.round(Number(value) * 100))}
              contentStyle={{ background: 'var(--surface-raised)', border: '1px solid var(--border)', borderRadius: 10, fontSize: 13 }}
              itemStyle={{ color: 'var(--text)' }}
            />
          </PieChart>
        </ResponsiveContainer>
        <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', pointerEvents: 'none' }}>
          <div style={{ textAlign: 'center' }}>
            <div className="subtle" style={{ fontSize: 'var(--text-xs)' }}>
              Total
            </div>
            <div className="num" style={{ fontSize: 'var(--text-lg)', fontWeight: 700 }}>
              {formatCents(totalCents, 'EUR', { compact: true })}
            </div>
          </div>
        </div>
      </div>
      <ul className="stack" style={{ gap: 6, marginTop: 'var(--space-3)' }}>
        {slices.map((s, i) => (
          <li key={s.name} style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', fontSize: 'var(--text-sm)' }}>
            <span aria-hidden style={{ width: 10, height: 10, borderRadius: 3, flex: 'none', background: data[i]!.color }} />
            <span style={{ flex: 1, minWidth: 0 }}>{s.name}</span>
            <span className="subtle num">{s.percent.toLocaleString('fr-FR')} %</span>
            <strong className="num" style={{ minWidth: 72, textAlign: 'right' }}>
              {formatCents(s.amountCents, 'EUR', { compact: true })}
            </strong>
          </li>
        ))}
      </ul>
    </div>
  )
}
