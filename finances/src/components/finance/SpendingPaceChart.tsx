import { CartesianGrid, Legend, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { toneSolid } from '@/components/ui/tone'
import type { Cents } from '@/types'
import { formatCents } from '@/utils/money'
import type { PacePoint } from '@/utils/spendingPace'

/** Dépenses cumulées du mois, face au mois précédent (et au budget total s'il est défini). */
export function SpendingPaceChart({ points, budgetCents }: { points: PacePoint[]; budgetCents: Cents | null }) {
  const data = points.map((p) => ({
    day: p.day,
    'Ce mois-ci': p.currentCents === null ? null : p.currentCents / 100,
    'Mois précédent': p.previousCents === null ? null : p.previousCents / 100,
  }))

  return (
    <div style={{ width: '100%', height: 220 }} role="img" aria-label="Dépenses cumulées du mois comparées au mois précédent">
      <ResponsiveContainer>
        <LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid vertical={false} stroke="var(--border)" />
          <XAxis dataKey="day" tickLine={false} axisLine={false} ticks={[1, 8, 15, 22, 29]} tick={{ fill: 'var(--text-muted)', fontSize: 12 }} />
          <YAxis hide domain={[0, 'auto']} />
          <Tooltip
            labelFormatter={(day) => `Jour ${day}`}
            formatter={(value) => formatCents(Math.round(Number(value) * 100))}
            contentStyle={{ background: 'var(--surface-raised)', border: '1px solid var(--border)', borderRadius: 10, fontSize: 13 }}
            labelStyle={{ color: 'var(--text)', fontWeight: 600 }}
          />
          <Legend wrapperStyle={{ fontSize: 12, color: 'var(--text-muted)' }} iconType="plainline" />
          {budgetCents !== null && budgetCents > 0 && (
            <ReferenceLine y={budgetCents / 100} stroke={toneSolid('warning')} strokeDasharray="4 4" label={{ value: 'Budget', position: 'insideTopLeft', fill: 'var(--text-muted)', fontSize: 11 }} />
          )}
          <Line type="stepAfter" dataKey="Mois précédent" stroke="var(--text-subtle)" strokeWidth={1.5} strokeDasharray="5 4" dot={false} isAnimationActive={false} connectNulls={false} />
          <Line type="stepAfter" dataKey="Ce mois-ci" stroke={toneSolid('expense')} strokeWidth={2.5} dot={false} isAnimationActive={false} connectNulls={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}
