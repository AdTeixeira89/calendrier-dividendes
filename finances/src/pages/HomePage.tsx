import { Link } from 'react-router-dom'
import { ArrowDownRight, ArrowUpRight, CheckCircle2, Circle, PiggyBank, Wallet } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { AlertsCard } from '@/components/finance/AlertsCard'
import { BudgetSplitCard } from '@/components/finance/BudgetSplitCard'
import { IncomeExpenseLineChart } from '@/components/finance/IncomeExpenseLineChart'
import { Card, StatCard } from '@/components/ui'
import { useAuth } from '@/hooks/useAuth'
import { useBudgetSplit } from '@/hooks/useBudgetSplit'
import { useDebts } from '@/hooks/useDebts'
import { useFinancialAlerts } from '@/hooks/useFinancialAlerts'
import { useHousehold } from '@/hooks/useHousehold'
import { useMonthlyExpenses } from '@/hooks/useMonthlyExpenses'
import { useMonthlyIncomes } from '@/hooks/useMonthlyIncomes'
import { useTrend } from '@/hooks/useTrend'
import { householdSplit } from '@/utils/budgetSplit'
import { aggregateDebts } from '@/utils/debt'
import { greeting } from '@/utils/dates'
import { currentMonthKey, formatMonthKey, previousMonthKey } from '@/utils/month'
import { percentChange } from '@/utils/money'
import { summarizeMonth, withDebtCharges } from '@/utils/monthlyStats'
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
  const debts = useDebts(household.id)
  const alerts = useFinancialAlerts(household.id)
  const trend = useTrend(household.id, month, 6)
  const budgetSplit = useBudgetSplit(household.id)

  const hasData = Boolean(expenses?.length || incomes?.length)

  // Les mensualités de prêts (capital + assurance) sont une charge fixe à part
  // entière : elles s'ajoutent aux dépenses enregistrées, même si elles ne
  // sont pas saisies comme des dépenses individuelles.
  const debtMonthlyCents = debts ? aggregateDebts(debts).totalMonthlyCents : 0
  const summary = expenses && incomes ? withDebtCharges(summarizeMonth(expenses, incomes), debtMonthlyCents) : null
  const prevSummary = prevExpenses && prevIncomes ? withDebtCharges(summarizeMonth(prevExpenses, prevIncomes), debtMonthlyCents) : null

  const split = budgetSplit && expenses && incomes ? householdSplit(members.map((m) => m.uid), budgetSplit, incomes, expenses, debtMonthlyCents) : null

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
          footnote={debtMonthlyCents > 0 ? 'Dont mensualités de prêts' : 'Aucune dépense saisie'}
        />
        <StatCard
          label="Épargne"
          amount={summary?.savingsCents ?? null}
          tone="saving"
          icon={<PiggyBank size={16} />}
          change={summary && prevSummary ? percentChange(summary.savingsCents, prevSummary.savingsCents) : null}
          footnote="Revenus − dépenses (dont crédits)"
        />
        <StatCard
          label="Reste à vivre"
          amount={summary?.livingAllowanceCents ?? null}
          tone="accent"
          icon={<Wallet size={16} />}
          change={summary && prevSummary ? percentChange(summary.livingAllowanceCents, prevSummary.livingAllowanceCents) : null}
          footnote="Après charges fixes et mensualités de prêts"
        />
      </section>

      {alerts && alerts.length > 0 && <AlertsCard alerts={alerts} />}

      {budgetSplit && split && <BudgetSplitCard settings={budgetSplit} split={split} />}

      {trend && trend.some((p) => p.incomeCents > 0 || p.expenseCents > 0) && (
        <Card title="Revenus et dépenses" subtitle="Mois par mois, 6 derniers mois">
          {/* Mensualités de prêts ajoutées à chaque mois (montant actuel, faute d'historique), comme dans Analyse. */}
          <IncomeExpenseLineChart points={trend.map((p) => ({ ...p, expenseCents: p.expenseCents + debtMonthlyCents }))} />
        </Card>
      )}

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
