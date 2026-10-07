import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Camera, FileUp, Plus, Receipt, Settings2 } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { BudgetSection } from '@/components/finance/BudgetSection'
import { ExpenseFormSheet, type ExpenseFormInitial } from '@/components/finance/ExpenseFormSheet'
import { MonthNav } from '@/components/finance/MonthNav'
import { RecurringExpensesSection } from '@/components/finance/RecurringExpensesSection'
import { ExpenseRow } from '@/components/finance/ExpenseRow'
import { ScanReceiptSheet } from '@/components/finance/ScanReceiptSheet'
import { SpendingPaceChart } from '@/components/finance/SpendingPaceChart'
import { Button, Card, EmptyState, StatCard } from '@/components/ui'
import { SegmentedControl } from '@/components/ui/SegmentedControl'
import { useCurrentUser } from '@/hooks/useAuth'
import { useCategories } from '@/hooks/useCategories'
import { useCommonBudget } from '@/hooks/useCommonBudget'
import { useHousehold } from '@/hooks/useHousehold'
import { useMonthNav } from '@/hooks/useMonthNav'
import { useMonthlyExpenses } from '@/hooks/useMonthlyExpenses'
import type { Expense } from '@/types'
import { currentMonthKey, previousMonthKey } from '@/utils/month'
import { COMMON_SPACE, inSpace, type Space } from '@/utils/spaces'
import { spendingPace } from '@/utils/spendingPace'
import { sumCents } from '@/utils/monthlyStats'

/** Deux boutons côte à côte sur petit écran : le libellé passe à la ligne plutôt que de faire déborder la page. */
const WRAP_LABEL = { whiteSpace: 'normal', lineHeight: 1.2, padding: '6px var(--space-2)' } as const

export function ExpensesPage() {
  const { household, members, canWrite } = useHousehold()
  const user = useCurrentUser()
  const { month, setMonth } = useMonthNav()
  const categories = useCategories(household.id, 'expense')
  const allExpenses = useMonthlyExpenses(household.id, month)
  const commonBudget = useCommonBudget(month)
  const prevMonth = previousMonthKey(month)
  const allPrevExpenses = useMonthlyExpenses(household.id, prevMonth)
  const [params, setParams] = useSearchParams()
  // Trois espaces séparés : Communes, puis un par membre ; ni totaux ni listes ne se mélangent.
  const requested = params.get('espace')
  const space: Space = requested && members.some((m) => m.uid === requested) ? requested : COMMON_SPACE
  const spaceMember = members.find((m) => m.uid === space)
  const expenses = allExpenses && inSpace(allExpenses, space)
  const prevExpenses = allPrevExpenses && inSpace(allPrevExpenses, space)
  const setSpace = (next: Space) =>
    setParams(
      (p) => {
        const copy = new URLSearchParams(p)
        if (next === COMMON_SPACE) copy.delete('espace')
        else copy.set('espace', next)
        return copy
      },
      { replace: true },
    )
  const [editing, setEditing] = useState<Expense | undefined>(undefined)
  // Résultat du scan d'un ticket : ouvre le formulaire de dépense pré-rempli, à valider par l'utilisateur.
  const [scanned, setScanned] = useState<ExpenseFormInitial | undefined>(undefined)
  const sheetOpen = params.has('ajouter') || Boolean(editing) || Boolean(scanned)

  function closeParam(name: string) {
    if (!params.has(name)) return
    const next = new URLSearchParams(params)
    next.delete(name)
    setParams(next, { replace: true })
  }

  function closeSheet() {
    setEditing(undefined)
    setScanned(undefined)
    closeParam('ajouter')
  }

  const total = expenses ? sumCents(expenses) : null
  const loading = categories === undefined || expenses === undefined
  const toPaceInput = (list: Expense[]) => list.map((e) => ({ amountCents: e.amountCents, date: e.date.toDate() }))
  const pace = expenses && prevExpenses && (expenses.length > 0 || prevExpenses.length > 0) ? spendingPace(month, toPaceInput(expenses), prevMonth, toPaceInput(prevExpenses)) : null
  // Budget global des dépenses communes : repère du graphique, affiché dans l'espace Communes seulement.
  const budgetTotal = space === COMMON_SPACE && commonBudget && commonBudget.split.budgetCents > 0 ? commonBudget.split.budgetCents : null

  return (
    <div className="stack animate-in">
      <PageHeader
        title="Dépenses"
        action={
          <Link to="/categories">
            <Button variant="ghost" size="sm" icon={<Settings2 size={16} />}>
              Catégories
            </Button>
          </Link>
        }
      />

      <MonthNav month={month} onChange={setMonth} />

      <SegmentedControl label="Espace" value={space} onChange={setSpace} options={[{ value: COMMON_SPACE, label: 'Communes' }, ...members.map((m) => ({ value: m.uid, label: m.displayName }))]} />

      <StatCard label={spaceMember ? `Dépenses de ${spaceMember.displayName}` : 'Total des dépenses communes'} amount={total} tone="expense" icon={<Receipt size={16} />} higherIsBetter={false} />

      {pace && (
        <Card title="Rythme des dépenses" subtitle="Cumul jour après jour, comparé au mois précédent">
          <SpendingPaceChart points={pace} budgetCents={budgetTotal} />
        </Card>
      )}

      {canWrite && (
        <Button icon={<Plus size={18} />} onClick={() => setParams((p) => new URLSearchParams({ ...Object.fromEntries(p), ajouter: '1' }))}>
          Ajouter une dépense
        </Button>
      )}
      {canWrite && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 'var(--space-3)' }}>
          <Button variant="secondary" block style={WRAP_LABEL} icon={<Camera size={18} />} onClick={() => setParams((p) => new URLSearchParams({ ...Object.fromEntries(p), scanner: '1' }))}>
            Scanner un ticket
          </Button>
          <Link to="/importer-releve" style={{ display: 'block', minWidth: 0 }}>
            <Button variant="secondary" block style={WRAP_LABEL} icon={<FileUp size={18} />}>
              Importer un relevé
            </Button>
          </Link>
        </div>
      )}

      <RecurringExpensesSection space={space} />

      <Card title="Transactions" padded={expenses !== undefined && expenses.length === 0}>
        {loading ? null : expenses.length === 0 ? (
          <EmptyState icon={<Receipt size={28} />} title="Aucune dépense ce mois-ci" description="Ajoutez votre première dépense pour ce mois." />
        ) : (
          <ul className="stack" style={{ gap: 2 }}>
            {expenses.map((expense) => (
              <li key={expense.id}>
                <ExpenseRow expense={expense} category={categories?.find((c) => c.id === expense.categoryId)} onClick={() => setEditing(expense)} />
              </li>
            ))}
          </ul>
        )}
        {spaceMember && spaceMember.uid !== user.uid && (
          <p className="subtle" style={{ fontSize: 'var(--text-sm)', padding: 'var(--space-3)' }}>
            Les dépenses que {spaceMember.displayName} a choisi de garder privées ne sont pas affichées.
          </p>
        )}
      </Card>

      {space === COMMON_SPACE && <BudgetSection month={month} />}

      {categories !== undefined && (
        <ExpenseFormSheet
          key={`${editing?.id ?? scanned?.receiptPath ?? 'new'}:${space}`}
          open={sheetOpen}
          onClose={closeSheet}
          categories={categories}
          expense={editing}
          defaultDate={monthDefaultDate(month)}
          defaultSpace={space}
          initial={scanned}
        />
      )}

      <ScanReceiptSheet
        open={params.has('scanner')}
        onClose={() => closeParam('scanner')}
        onExtracted={(initial) => {
          closeParam('scanner')
          setScanned(initial)
        }}
      />
    </div>
  )
}

function monthDefaultDate(month: string): string {
  return month === currentMonthKey() ? new Date().toISOString().slice(0, 10) : `${month}-01`
}
