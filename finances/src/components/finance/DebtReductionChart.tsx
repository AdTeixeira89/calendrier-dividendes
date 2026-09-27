import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { toneSolid } from '@/components/ui/tone'
import { formatCents } from '@/utils/money'
import type { YearlyBalance } from '@/utils/debt'

/** Diminution du capital restant dû, année par année (estimation linéaire, sans recalcul des intérêts). */
export function DebtReductionChart({ points }: { points: YearlyBalance[] }) {
  const data = points.map((p) => ({ year: String(p.year), balance: p.outstandingCents / 100 }))

  return (
    <div style={{ width: '100%', height: 220 }}>
      <ResponsiveContainer>
        <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid vertical={false} stroke="var(--border)" />
          <XAxis dataKey="year" tickLine={false} axisLine={false} tick={{ fill: 'var(--text-muted)', fontSize: 12 }} />
          <YAxis hide />
          <Tooltip
            cursor={{ fill: 'var(--surface-hover)' }}
            formatter={(value) => formatCents(Math.round(Number(value) * 100))}
            contentStyle={{ background: 'var(--surface-raised)', border: '1px solid var(--border)', borderRadius: 10, fontSize: 13 }}
            labelStyle={{ color: 'var(--text)', fontWeight: 600 }}
          />
          <Bar dataKey="balance" fill={toneSolid('debt')} radius={[4, 4, 0, 0]} maxBarSize={28} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
