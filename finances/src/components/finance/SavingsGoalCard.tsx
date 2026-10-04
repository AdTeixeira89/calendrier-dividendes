import { createElement } from 'react'
import { Card, ProgressBar } from '@/components/ui'
import { useHousehold } from '@/hooks/useHousehold'
import { toneSolid, type Tone } from '@/components/ui/tone'
import type { SavingsGoal } from '@/types'
import { categoryIcon } from '@/utils/categoryIcons'
import { formatDate } from '@/utils/dates'
import { formatCents } from '@/utils/money'
import { estimatedGoalDate, goalProgress } from '@/utils/savingsGoal'
import styles from './SavingsGoalCard.module.css'

export function SavingsGoalCard({ goal, onClick }: { goal: SavingsGoal; onClick: () => void }) {
  const { members } = useHousehold()
  const owner = goal.scope === 'personal' ? (members.find((m) => m.uid === goal.memberId)?.displayName ?? 'Solo') : 'En couple'
  const progress = goalProgress(goal.currentCents, goal.targetCents)
  const estimatedDate = estimatedGoalDate(goal.currentCents, goal.targetCents, goal.plannedMonthlyCents)
  const openEnded = goal.targetCents <= 0
  const reached = !openEnded && goal.currentCents >= goal.targetCents

  return (
    <Card padded={false}>
      <button type="button" className={styles.card} onClick={onClick}>
        <div className={styles.head}>
          <span className={styles.icon} style={{ background: toneSolid((goal.color as Tone) || 'saving') }}>
            {createElement(categoryIcon(goal.icon), {
              size: 18,
              'aria-hidden': true,
            })}
          </span>
          <span className={styles.name}>
            {goal.name}{' '}
            <span className="subtle" style={{ fontWeight: 400 }}>
              · {owner}
            </span>
          </span>
          {openEnded ? (
            <span className={`num ${styles.percent}`}>{formatCents(goal.currentCents, 'EUR', { compact: true })}</span>
          ) : (
            <span className={`num ${styles.percent}`}>{Math.round(progress)} %</span>
          )}
        </div>
        {openEnded ? (
          <div className={styles.figures}>
            <span className="subtle">Sans objectif chiffré</span>
            <span className="num">{goal.plannedMonthlyCents > 0 ? `+ ${formatCents(goal.plannedMonthlyCents)} / mois` : 'Aucun versement mensuel'}</span>
          </div>
        ) : (
          <>
            <ProgressBar value={progress} tone={reached ? 'income' : (goal.color as Tone) || 'saving'} label={`Progression de ${goal.name}`} size="lg" />
            <div className={styles.figures}>
              <span className="num">
                {formatCents(goal.currentCents, 'EUR', { compact: true })}{' '}
                <span className="subtle">/ {formatCents(goal.targetCents, 'EUR', { compact: true })}</span>
              </span>
              <span className="subtle">
                {reached ? 'Objectif atteint 🎉' : estimatedDate ? `Estimé le ${formatDate(estimatedDate)}` : 'Ajoutez un versement mensuel prévu'}
              </span>
            </div>
          </>
        )}
      </button>
    </Card>
  )
}
