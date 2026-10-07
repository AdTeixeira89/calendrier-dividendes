import { useState } from 'react'
import { Pencil } from 'lucide-react'
import { Button, Card, ProgressBar } from '@/components/ui'
import { useCurrentUser } from '@/hooks/useAuth'
import { useCommonBudget } from '@/hooks/useCommonBudget'
import { useHousehold } from '@/hooks/useHousehold'
import { saveGlobalBudget } from '@/services/budgetGlobalService'
import type { MonthKey } from '@/utils/month'
import { formatCents } from '@/utils/money'
import { AmountField } from './AmountField'
import styles from './BudgetSplitCard.module.css'

const eur = (cents: number) => formatCents(cents, 'EUR', { compact: true })

/**
 * Budget des dépenses communes du mois : un seul budget global (celui inscrit, sinon le
 * total versé par chacun), ce qui est dépensé, ce qu'il reste, et le reste de chaque personne.
 */
export function BudgetSection({ month }: { month: MonthKey }) {
  const user = useCurrentUser()
  const { household, members, canWrite } = useHousehold()
  const budget = useCommonBudget(month)
  const [editing, setEditing] = useState(false)
  const [cents, setCents] = useState<number | null>(null)
  if (!budget) return null
  const { split, overrideCents } = budget
  const over = split.commonRemainingCents < 0
  const used = split.budgetCents > 0 ? (split.commonSpentCents / split.budgetCents) * 100 : 0
  const nameOf = (uid: string) => members.find((m) => m.uid === uid)?.displayName ?? 'Membre'

  function save(value: number | null) {
    void saveGlobalBudget(household.id, value, user)
    setEditing(false)
  }

  return (
    <Card title="Budget des dépenses communes" subtitle="Un seul budget pour tout le foyer" action={canWrite && !editing ? <Button variant="ghost" size="sm" icon={<Pencil size={16} />} onClick={() => { setCents(overrideCents ?? (split.budgetCents || null)); setEditing(true) }}>{split.budgetCents > 0 ? 'Modifier' : 'Définir'}</Button> : undefined}>
      {editing ? (
        <div className="stack">
          <AmountField label="Budget global du mois" value={cents} onChange={setCents} autoFocus />
          <p className="subtle" style={{ fontSize: 'var(--text-sm)' }}>
            Un seul montant pour toutes les dépenses communes (charges fixes, courses, électricité…), pas un budget par catégorie. Sans montant, on prend le total versé par chacun.
          </p>
          <div className="row">
            <Button block onClick={() => save(cents)}>
              Enregistrer
            </Button>
            {overrideCents !== null && (
              <Button variant="secondary" block onClick={() => save(null)}>
                Total des versements
              </Button>
            )}
          </div>
        </div>
      ) : split.budgetCents <= 0 ? (
        <p className="subtle" style={{ fontSize: 'var(--text-sm)' }}>
          Aucun budget pour l’instant : définissez un montant global, ou réglez la part versée par chacun dans « Répartition des revenus » (page Revenus).
        </p>
      ) : (
        <>
          <div className={styles.envelope}>
            <div className={styles.line}>
              <strong>{over ? 'Budget dépassé' : 'Reste du budget'}</strong>
              <strong className="num" style={{ color: over ? 'var(--danger)' : undefined }}>
                {over ? `de ${eur(-split.commonRemainingCents)}` : eur(split.commonRemainingCents)}
              </strong>
            </div>
            <ProgressBar value={used} tone={over ? 'expense' : 'saving'} label="Budget commun consommé" size="lg" />
            <p className="subtle" style={{ fontSize: 'var(--text-sm)' }}>
              {eur(split.commonSpentCents)} dépensés sur {eur(split.budgetCents)}
              {overrideCents === null && ' (total versé par chacun)'} · prêts compris
            </p>
          </div>
          {split.commonCents > 0 && (
            <ul className={styles.members}>
              {split.members
                .filter((m) => m.commonCents > 0)
                .map((m) => (
                  <li key={m.memberId} className="subtle">
                    <strong style={{ color: 'var(--text)' }}>{nameOf(m.memberId)}</strong> : versé {eur(m.commonCents)} · part dépensée {eur(m.spentShareCents)} ·{' '}
                    <span style={m.leftCents < 0 ? { color: 'var(--danger)' } : undefined}>reste {eur(m.leftCents)}</span>
                  </li>
                ))}
            </ul>
          )}
        </>
      )}
    </Card>
  )
}
