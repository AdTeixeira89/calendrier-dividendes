import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { toneSolid } from '@/components/ui/tone'
import type { NetWorthPoint } from '@/utils/netWorth'
import { formatCents } from '@/utils/money'
import { formatMonthKey } from '@/utils/month'

export function NetWorthChart({ points }: { points: NetWorthPoint[] }) {
  const data = points.map((p) => ({
    month: formatMonthKey(p.month).replace(/ \d{4}$/, '').slice(0, 3),
    netWorth: p.netWorthCents / 100,
  }))

  return (
    <div style={{ width: '100%', height: 220 }}>
      <ResponsiveContainer>
        <LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid vertical={false} stroke="var(--border)" />
          <XAxis dataKey="month" tickLine={false} axisLine={false} tick={{ fill: 'var(--text-muted)', fontSize: 12 }} />
          <YAxis hide domain={['auto', 'auto']} />
          <Tooltip
            cursor={{ stroke: 'var(--border)' }}
            formatter={(value) => formatCents(Math.round(Number(value) * 100))}
            contentStyle={{ background: 'var(--surface-raised)', border: '1px solid var(--border)', borderRadius: 10, fontSize: 13 }}
            labelStyle={{ color: 'var(--text)', fontWeight: 600 }}
          />
          <Line type="monotone" dataKey="netWorth" stroke={toneSolid('saving')} strokeWidth={2.5} dot={false} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}
