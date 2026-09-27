import { Bar, BarChart, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { Category } from '@/types'
import { totalsByCategory } from '@/utils/monthlyStats'
import { formatCents } from '@/utils/money'
import { toneSolid, type Tone } from '@/components/ui/tone'
import type { Expense } from '@/types'
import { EmptyState } from '@/components/ui'
import { PieChart as PieIcon } from 'lucide-react'

const MAX_BARS = 8

interface AmountLabelProps {
  x?: string | number
  y?: string | number
  width?: string | number
  height?: string | number
  value?: unknown
}

function renderAmountLabel({ x = 0, y = 0, width = 0, height = 0, value = 0 }: AmountLabelProps) {
  const cx = Number(x)
  const cy = Number(y)
  const w = Number(width)
  const h = Number(height)
  return (
    <text x={cx + w + 8} y={cy + h / 2} dy={4} fill="var(--text)" fontSize={12} fontWeight={600}>
      {formatCents(Math.round(Number(value) * 100), 'EUR', { compact: true })}
    </text>
  )
}

interface Slice {
  name: string
  color: Tone
  amountCents: number
}

export function CategoryBreakdownChart({
  expenses,
  categories,
  debtMonthlyCents = 0,
}: {
  expenses: Expense[]
  categories: Category[]
  /** Mensualités de prêts du mois : affichées comme un poste « Crédits » à part entière. */
  debtMonthlyCents?: number
}) {
  const byId = new Map(categories.map((c) => [c.id, c]))
  const slices: Slice[] = totalsByCategory(expenses).map((t) => ({
    name: byId.get(t.categoryId)?.name ?? 'Sans catégorie',
    color: (byId.get(t.categoryId)?.color as Tone) ?? 'accent',
    amountCents: t.amountCents,
  }))
  if (debtMonthlyCents > 0) slices.push({ name: 'Crédits', color: 'debt', amountCents: debtMonthlyCents })
  slices.sort((a, b) => b.amountCents - a.amountCents)

  if (slices.length === 0) {
    return <EmptyState icon={<PieIcon size={28} />} title="Rien à afficher" description="Ajoutez des dépenses pour voir leur répartition." />
  }

  const top = slices.slice(0, MAX_BARS)
  const rest = slices.slice(MAX_BARS)
  const restTotal = rest.reduce((sum, s) => sum + s.amountCents, 0)

  const data = [
    ...top.map((s) => ({ name: s.name, color: s.color, amount: s.amountCents / 100 })),
    ...(restTotal > 0 ? [{ name: 'Autres', color: 'warning' as Tone, amount: restTotal / 100 }] : []),
  ]
  const height = data.length * 44 + 24

  return (
    <div style={{ width: '100%', height }}>
      <ResponsiveContainer>
        <BarChart data={data} layout="vertical" margin={{ top: 0, right: 56, bottom: 0, left: 0 }} barCategoryGap={12}>
          <XAxis type="number" hide />
          <YAxis type="category" dataKey="name" width={110} tickLine={false} axisLine={false} tick={{ fill: 'var(--text-muted)', fontSize: 12 }} />
          <Tooltip
            cursor={{ fill: 'var(--surface-hover)' }}
            formatter={(value) => formatCents(Math.round(Number(value) * 100))}
            contentStyle={{ background: 'var(--surface-raised)', border: '1px solid var(--border)', borderRadius: 10, fontSize: 13 }}
            labelStyle={{ color: 'var(--text)', fontWeight: 600 }}
          />
          <Bar dataKey="amount" radius={[0, 6, 6, 0]} maxBarSize={22} label={renderAmountLabel} isAnimationActive={false}>
            {data.map((entry) => (
              <Cell key={entry.name} fill={toneSolid(entry.color)} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
