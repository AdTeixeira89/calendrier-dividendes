import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { toneSolid } from '@/components/ui/tone'
import type { PeriodPoint } from '@/utils/trendPeriod'
import { formatCents } from '@/utils/money'

/** Revenus et dépenses mois par mois : l'écart entre les deux lignes est ce qui reste (ou manque) chaque mois. */
export function IncomeExpenseLineChart({ points }: { points: PeriodPoint[] }) {
  const data = points.map((p) => ({
    month: p.label,
    Revenus: p.incomeCents / 100,
    Dépenses: p.expenseCents / 100,
  }))

  return (
    <div style={{ width: '100%', height: 220 }} role="img" aria-label="Revenus et dépenses sur la période choisie">
      <ResponsiveContainer>
        <LineChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: 12 }}>
          <CartesianGrid vertical={false} stroke="var(--border)" />
          <XAxis dataKey="month" tickLine={false} axisLine={false} tick={{ fill: 'var(--text-muted)', fontSize: 12 }} interval="preserveStartEnd" minTickGap={14} />
          <YAxis hide domain={[0, 'auto']} />
          <Tooltip
            formatter={(value) => formatCents(Math.round(Number(value) * 100))}
            contentStyle={{ background: 'var(--surface-raised)', border: '1px solid var(--border)', borderRadius: 10, fontSize: 13 }}
            labelStyle={{ color: 'var(--text)', fontWeight: 600 }}
          />
          <Legend wrapperStyle={{ fontSize: 12, color: 'var(--text-muted)' }} iconType="plainline" />
          <Line type="monotone" dataKey="Revenus" stroke={toneSolid('income')} strokeWidth={2.5} dot={{ r: 3 }} activeDot={{ r: 5 }} isAnimationActive={false} />
          <Line type="monotone" dataKey="Dépenses" stroke={toneSolid('expense')} strokeWidth={2.5} dot={{ r: 3 }} activeDot={{ r: 5 }} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}
