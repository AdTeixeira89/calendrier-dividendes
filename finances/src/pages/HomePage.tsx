import { Link } from 'react-router-dom'
import { ArrowDownRight, ArrowUpRight, CheckCircle2, Circle, PiggyBank, Wallet } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { Card, StatCard } from '@/components/ui'
import { useAuth } from '@/hooks/useAuth'
import { useHousehold } from '@/hooks/useHousehold'
import { useMonthlyExpenses } from '@/hooks/useMonthlyExpenses'
import { useMonthlyIncomes } from '@/hooks/useMonthlyIncomes'
import { greeting } from '@/utils/dates'
import { currentMonthKey, formatMonthKey, previousMonthKey } from '@/utils/month'
import { percentChange } from '@/utils/money'
import { summarizeMonth } from '@/utils/monthlyStats'
import styles from './HomePage.module.css'

export function HomePage() {
  const { profile } = useAuth()
  const { household, members } = useHousehold()
  const month = currentMonthKey()
  const prevMonth = previousMonthKey(month)

  const expenses = useMonthlyExpenses(household.id, month)
  const incomes = useMonthlyIncomes(household.id, month)
  const prevExpenses = useMonthlyExpenses(household.id, prevMonth)
  const prevIncomes = useMonthlyIncomes(household.id, prevMonth)

  const summary = expenses && incomes ? summarizeMonth(expenses, incomes) : null
  const prevSummary = prevExpenses && prevIncomes ? summarizeMonth(prevExpenses, prevIncomes) : null
  const hasData = Boolean(expenses?.length || incomes?.length)

  const steps = [
    { done: true, label: 'Créer votre foyer', to: '/foyer' },
    { done: members.length > 1, label: 'Inviter votre conjoint(e)', to: '/foyer' },
    { done: Boolean(incomes?.length), label: 'Ajouter vos revenus', to: '/revenus' },
    { done: Boolean(expenses?.length), label: 'Saisir vos charges fixes et dépenses', to: '/depenses' },
    { done: false, label: 'Renseigner vos crédits', to: '/dette' },
  ]
  const doneCount = steps.filter((s) => s.done).length

  return (
    <div className="stack animate-in">
      <PageHeader title={`${greeting()}${profile ? `, ${profile.displayName}` : ''}`} subtitle={`${household.name} · situation de ${formatMonthKey(month)}`} />

      <section aria-label="Situation du mois" className={styles.stats}>
        <StatCard
          label="Revenus"
          amount={summary?.incomeCents ?? null}
          tone="income"
          icon={<ArrowUpRight size={16} />}
          change={summary && prevSummary ? percentChange(summary.incomeCents, prevSummary.incomeCents) : null}
          footnote="Aucun revenu saisi"
        />
        <StatCard
          label="Dépenses"
          amount={summary?.expenseCents ?? null}
          tone="expense"
          icon={<ArrowDownRight size={16} />}
          higherIsBetter={false}
          change={summary && prevSummary ? percentChange(summary.expenseCents, prevSummary.expenseCents) : null}
          footnote="Aucune dépense saisie"
        />
        <StatCard
          label="Épargne"
          amount={summary?.savingsCents ?? null}
          tone="saving"
          icon={<PiggyBank size={16} />}
          change={summary && prevSummary ? percentChange(summary.savingsCents, prevSummary.savingsCents) : null}
          footnote="Revenus − dépenses"
        />
        <StatCard
          label="Reste à vivre"
          amount={summary?.livingAllowanceCents ?? null}
          tone="accent"
          icon={<Wallet size={16} />}
          change={summary && prevSummary ? percentChange(summary.livingAllowanceCents, prevSummary.livingAllowanceCents) : null}
          footnote="Après charges fixes"
        />
      </section>

      {!hasData && (
        <Card title="Premiers pas" subtitle={`${doneCount} / ${steps.length} étapes`}>
          <ol className={styles.steps}>
            {steps.map((step) => (
              <li key={step.label}>
                <Link to={step.to} className={[styles.step, step.done && styles.done].filter(Boolean).join(' ')}>
                  {step.done ? <CheckCircle2 size={20} aria-hidden /> : <Circle size={20} aria-hidden />}
                  <span>{step.label}</span>
                  <span className="sr-only">{step.done ? '(fait)' : '(à faire)'}</span>
                </Link>
              </li>
            ))}
          </ol>
        </Card>
      )}
    </div>
  )
}
