import { useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowDownRight, ArrowUpRight, CheckCircle2, Circle, PiggyBank, Wallet } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { AlertsCard } from '@/components/finance/AlertsCard'
import { IncomeExpenseLineChart } from '@/components/finance/IncomeExpenseLineChart'
import { PeriodFilter } from '@/components/finance/PeriodFilter'
import { Card, StatCard } from '@/components/ui'
import { useAuth, useCurrentUser } from '@/hooks/useAuth'
import { useCommonBudget } from '@/hooks/useCommonBudget'
import { useHomePrefs } from '@/hooks/useHomePrefs'
import { useSavingsGoals } from '@/hooks/useSavingsGoals'
import { useFinancialAlerts } from '@/hooks/useFinancialAlerts'
import { useHousehold } from '@/hooks/useHousehold'
import { useMonthlyExpenses } from '@/hooks/useMonthlyExpenses'
import { useMonthlyIncomes } from '@/hooks/useMonthlyIncomes'
import { usePeriodTrend } from '@/hooks/usePeriodTrend'
import { ScopeFilter } from '@/components/finance/ScopeFilter'
import { savingsTotal } from '@/utils/savingsView'
import { commonExpenses, inSpace } from '@/utils/spaces'
import { greeting } from '@/utils/dates'
import { currentBudgetMonthKey } from '@/utils/budgetMonth'
import { currentMonthKey, formatMonthKey, previousMonthKey } from '@/utils/month'
import { percentChange } from '@/utils/money'
import { summarizeMonth } from '@/utils/monthlyStats'
import { TREND_PERIODS, type TrendPeriod } from '@/utils/trendPeriod'
import styles from './HomePage.module.css'

export function HomePage() {
  const { profile } = useAuth()
  const user = useCurrentUser()
  const { household, members } = useHousehold()
  const month = currentMonthKey()
  // Dépenses : mois budgétaire (du 6 au 5) ; du 1er au 5, on est encore dans le mois précédent.
  const expenseMonth = currentBudgetMonthKey()
  const prevExpenseMonth = previousMonthKey(expenseMonth)
  const prevMonth = previousMonthKey(month)

  const { prefs, setPref } = useHomePrefs(household.id)
  const allExpenses = useMonthlyExpenses(household.id, expenseMonth)
  const allPrevExpenses = useMonthlyExpenses(household.id, prevExpenseMonth)
  // « Dépenses » suit la préférence du titulaire : communes (par défaut) ou ses dépenses personnelles.
  const expenses = allExpenses && (prefs.expenses === 'personal' ? inSpace(allExpenses, user.uid) : commonExpenses(allExpenses))
  const prevExpenses = allPrevExpenses && (prefs.expenses === 'personal' ? inSpace(allPrevExpenses, user.uid) : commonExpenses(allPrevExpenses))
  const incomes = useMonthlyIncomes(household.id, month)
  const prevIncomes = useMonthlyIncomes(household.id, prevMonth)
  const savingsGoals = useSavingsGoals(household.id)
  const commonBudget = useCommonBudget(expenseMonth)
  const hasBudget = Boolean(commonBudget && commonBudget.split.budgetCents > 0)
  const alerts = useFinancialAlerts(household.id)
  const [period, setPeriod] = useState<TrendPeriod>('6m')

  const hasData = Boolean(expenses?.length || incomes?.length)

  // Les mensualités de prêts sont des dépenses communes inscrites à leur date : rien à ajouter ici.
  const trend = usePeriodTrend(household.id, expenseMonth, period, prefs.expenses)
  const summary = expenses && incomes ? summarizeMonth(expenses, incomes) : null
  const prevSummary = prevExpenses && prevIncomes ? summarizeMonth(prevExpenses, prevIncomes) : null

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
          to="/revenus"
          amount={summary?.incomeCents ?? null}
          tone="income"
          icon={<ArrowUpRight size={16} />}
          change={summary && prevSummary ? percentChange(summary.incomeCents, prevSummary.incomeCents) : null}
          footnote={summary?.incomeCents ? undefined : 'Aucun revenu saisi'}
        />
        <StatCard
          label="Dépenses"
          to="/depenses"
          amount={summary?.expenseCents ?? null}
          tone="expense"
          icon={<ArrowDownRight size={16} />}
          higherIsBetter={false}
          change={summary && prevSummary ? percentChange(summary.expenseCents, prevSummary.expenseCents) : null}
          footnote={prefs.expenses === 'personal' ? 'Vos dépenses personnelles' : 'Aucune dépense saisie'}
          action={<ScopeFilter label="Dépenses affichées" value={prefs.expenses} onChange={(v) => setPref('expenses', v)} communeLabel="dépenses communes" align="start" />}
        />
        <StatCard
          label="Épargne"
          to="/epargne"
          amount={savingsGoals ? savingsTotal(savingsGoals, prefs.savings, user.uid) : null}
          tone="saving"
          icon={<PiggyBank size={16} />}
          footnote={prefs.savings === 'personal' ? 'Votre épargne personnelle' : 'Épargne commune (objectifs en couple)'}
          action={<ScopeFilter label="Épargne affichée" value={prefs.savings} onChange={(v) => setPref('savings', v)} communeLabel="épargne commune" align="start" />}
        />
        <StatCard
          label="Reste à vivre"
          to="/depenses"
          amount={hasBudget ? commonBudget!.split.commonRemainingCents : null}
          tone="accent"
          icon={<Wallet size={16} />}
          footnote={hasBudget ? 'Reste du budget des dépenses communes' : 'Définissez le budget commun'}
        />
      </section>

      {alerts && alerts.length > 0 && <AlertsCard alerts={alerts} />}

      {(period !== '6m' || trend?.some((p) => p.incomeCents > 0 || p.expenseCents > 0)) && (
        <Card
          title="Revenus et dépenses"
          subtitle={`${TREND_PERIODS.find((p) => p.value === period)?.full}${prefs.expenses === 'personal' ? ' · vos finances personnelles' : ' · dépenses communes'}`}
          action={<ScopeFilter label="Dépenses affichées" value={prefs.expenses} onChange={(v) => setPref('expenses', v)} communeLabel="dépenses communes" />}
        >
          <PeriodFilter value={period} onChange={setPeriod} />
          {trend && <IncomeExpenseLineChart points={trend} />}
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
