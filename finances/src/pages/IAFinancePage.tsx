import { useState, type FormEvent } from 'react'
import { Send } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { ExportCard } from '@/components/finance/ExportCard'
import { StructuredAnswerView } from '@/components/finance/StructuredAnswerView'
import { Button, Card, Notice, TextArea } from '@/components/ui'
import { useHousehold } from '@/hooks/useHousehold'
import { useMonthlyReport } from '@/hooks/useMonthlyReport'
import { askFinance, type StructuredAnswer } from '@/services/aiService'
import { toUserMessage } from '@/utils/firebaseErrors'
import { currentMonthKey, formatMonthKey } from '@/utils/month'

export function IAFinancePage() {
  const { household } = useHousehold()
  const month = currentMonthKey()
  const report = useMonthlyReport(household.id, month)
  const [question, setQuestion] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [answer, setAnswer] = useState<StructuredAnswer | null>(null)

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    if (!question.trim()) return
    setLoading(true)
    setError(null)
    setAnswer(null)
    try {
      const { answer } = await askFinance(household.id, question.trim())
      setAnswer(answer)
    } catch (err) {
      setError(toUserMessage(err))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="stack animate-in">
      <PageHeader title="IA Finance" subtitle="Exportez vos données pour les analyser avec l'IA de votre choix, gratuitement." />

      <ExportCard />

      <Card title="Bilan du mois" subtitle={formatMonthKey(month)}>
        {report === undefined ? null : report === null ? (
          <p className="muted">Le bilan sera généré le 1er du mois prochain.</p>
        ) : (
          <div className="stack">
            <ul className="stack" style={{ gap: 4 }}>
              {report.facts.map((f) => (
                <li key={f.key} style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                  <span>{f.label}</span>
                  <strong className="num">{f.value}</strong>
                </li>
              ))}
            </ul>
            {report.bilan && <StructuredAnswerView answer={report.bilan} />}
          </div>
        )}
      </Card>

      <Card title="Poser une question à l'IA" subtitle="Nécessite une clé API IA payante, non configurée pour l'instant.">
        <form className="stack" onSubmit={onSubmit}>
          <TextArea
            label="Votre question"
            placeholder="Ex. : Combien ai-je dépensé en alimentation ce mois-ci ?"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            maxLength={500}
            rows={2}
          />
          <Button type="submit" icon={<Send size={18} />} loading={loading} disabled={!question.trim()}>
            Envoyer
          </Button>
        </form>
      </Card>

      {error && <Notice tone="danger">{error}</Notice>}

      {answer && (
        <Card title="Réponse">
          <StructuredAnswerView answer={answer} />
        </Card>
      )}
    </div>
  )
}
