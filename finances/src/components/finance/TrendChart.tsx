import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { TrendPoint } from '@/hooks/useTrend'
import { toneSolid } from '@/components/ui/tone'
import { formatCents } from '@/utils/money'
import { formatMonthKey } from '@/utils/month'

export function TrendChart({ points }: { points: TrendPoint[] }) {
  const data = points.map((p) => ({
    month: formatMonthKey(p.month).replace(/ \d{4}$/, '').slice(0, 3),
    Revenus: p.incomeCents / 100,
    Dépenses: p.expenseCents / 100,
  }))

  return (
    <div style={{ width: '100%', height: 220 }}>
      <ResponsiveContainer>
        <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }} barGap={4}>
          <CartesianGrid vertical={false} stroke="var(--border)" />
          <XAxis dataKey="month" tickLine={false} axisLine={false} tick={{ fill: 'var(--text-muted)', fontSize: 12 }} />
          <YAxis hide />
          <Tooltip
            cursor={{ fill: 'var(--surface-hover)' }}
            formatter={(value) => formatCents(Math.round(Number(value) * 100))}
            contentStyle={{ background: 'var(--surface-raised)', border: '1px solid var(--border)', borderRadius: 10, fontSize: 13 }}
            labelStyle={{ color: 'var(--text)', fontWeight: 600 }}
          />
          <Legend wrapperStyle={{ fontSize: 12, color: 'var(--text-muted)' }} iconType="circle" iconSize={8} />
          <Bar dataKey="Revenus" fill={toneSolid('income')} radius={[4, 4, 0, 0]} maxBarSize={18} isAnimationActive={false} />
          <Bar dataKey="Dépenses" fill={toneSolid('expense')} radius={[4, 4, 0, 0]} maxBarSize={18} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
