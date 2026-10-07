import { useState } from 'react'
import { Copy, Download } from 'lucide-react'
import { MonthNav } from './MonthNav'
import { Button, Card, Notice } from '@/components/ui'
import { useCategories } from '@/hooks/useCategories'
import { useDebts } from '@/hooks/useDebts'
import { commonExpenses } from '@/utils/spaces'
import { useExpensesRange } from '@/hooks/useExpensesRange'
import { useHousehold } from '@/hooks/useHousehold'
import { useIncomesRange } from '@/hooks/useIncomesRange'
import { useSavingsGoals } from '@/hooks/useSavingsGoals'
import { useSubscriptions } from '@/hooks/useSubscriptions'
import { buildFinancialSummaryText, buildTransactionsCsv, downloadTextFile } from '@/utils/export'
import { currentMonthKey, formatMonthKey, type MonthKey } from '@/utils/month'

/**
 * Export des données du foyer, pensé pour être donné à un assistant IA
 * gratuit (ChatGPT, Claude.ai, Gemini…) : pas de clé API, pas de coût.
 */
export function ExportCard() {
  const { household } = useHousehold()
  const [from, setFrom] = useState<MonthKey>(currentMonthKey())
  const [to, setTo] = useState<MonthKey>(currentMonthKey())
  const [copied, setCopied] = useState(false)

  const categories = useCategories(household.id)
  const expenses = useExpensesRange(household.id, from, to, 'budget')
  const incomes = useIncomesRange(household.id, from, to)
  const debts = useDebts(household.id)
  const savingsGoals = useSavingsGoals(household.id)
  const subscriptions = useSubscriptions(household.id)

  const ready = categories && expenses && incomes && debts && savingsGoals && subscriptions
  const periodLabel = from === to ? formatMonthKey(from) : `${formatMonthKey(from)} à ${formatMonthKey(to)}`

  function summaryText(): string {
    return buildFinancialSummaryText({ periodLabel, expenses: commonExpenses(expenses!), incomes: incomes!, categories: categories!, debts: debts!, savingsGoals: savingsGoals!, subscriptions: subscriptions! })
  }

  function onDownloadCsv() {
    downloadTextFile(`transactions-${from}_${to}.csv`, buildTransactionsCsv(expenses!, incomes!, categories!), 'text/csv;charset=utf-8')
  }

  function onDownloadSummary() {
    downloadTextFile(`bilan-${from}_${to}.txt`, summaryText(), 'text/plain;charset=utf-8')
  }

  async function onCopySummary() {
    await navigator.clipboard.writeText(summaryText())
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <Card title="Exporter mes données" subtitle="À télécharger ou copier pour demander une analyse à une IA gratuite (ChatGPT, Claude.ai, Gemini…).">
      <div className="stack">
        <div className="row" style={{ flexWrap: 'wrap', gap: 'var(--space-4)' }}>
          <div className="stack" style={{ gap: 4 }}>
            <span className="subtle">Du mois</span>
            <MonthNav month={from} onChange={setFrom} />
          </div>
          <div className="stack" style={{ gap: 4 }}>
            <span className="subtle">Au mois</span>
            <MonthNav month={to} onChange={setTo} />
          </div>
        </div>

        {from > to ? (
          <Notice tone="warning">Le mois de début doit être avant (ou égal à) le mois de fin.</Notice>
        ) : (
          <div className="row" style={{ flexWrap: 'wrap' }}>
            <Button variant="secondary" icon={<Download size={18} />} onClick={onDownloadCsv} disabled={!ready}>
              CSV (Excel) — transactions
            </Button>
            <Button variant="secondary" icon={<Download size={18} />} onClick={onDownloadSummary} disabled={!ready}>
              Résumé texte (.txt)
            </Button>
            <Button variant="ghost" icon={<Copy size={18} />} onClick={() => void onCopySummary()} disabled={!ready}>
              {copied ? 'Copié !' : 'Copier le résumé'}
            </Button>
          </div>
        )}
      </div>
    </Card>
  )
}
