import { useId, useState } from 'react'
import { ChevronDown, Scale, SlidersHorizontal } from 'lucide-react'
import { Button, Card, ProgressBar } from '@/components/ui'
import { useHousehold } from '@/hooks/useHousehold'
import type { Cents } from '@/types'
import { planIsEmpty, type BudgetSplitSettings, type HouseholdSplit } from '@/utils/budgetSplit'
import { formatCents } from '@/utils/money'
import styles from './BudgetSplitCard.module.css'
import accordion from './RecurringExpensesSection.module.css'
import { BudgetSplitSheet } from './BudgetSplitSheet'

interface BudgetSplitCardProps {
  settings: BudgetSplitSettings
  split: HouseholdSplit
}

const eur = (cents: Cents) => formatCents(cents, 'EUR', { compact: true })

/** Chemin de l'argent du mois : revenus → budget commun / épargne / investissement / reste personnel. */
export function BudgetSplitCard({ settings, split }: BudgetSplitCardProps) {
  const { household, members, canWrite } = useHousehold()
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState(false)
  const panelId = useId()
  const configured = members.some((m) => !planIsEmpty(settings.plans[m.uid]))
  const sheet = <BudgetSplitSheet key={JSON.stringify(settings.plans)} open={editing} onClose={() => setEditing(false)} householdId={household.id} settings={settings} />
  const over = split.commonRemainingCents < 0
  const summary = !configured ? 'À régler' : over ? `Budget commun dépassé de ${eur(-split.commonRemainingCents)}` : `Budget commun : ${eur(split.commonRemainingCents)} restants`
  const used = split.budgetCents > 0 ? (split.commonSpentCents / split.budgetCents) * 100 : 0

  return (
    <>
      <Card padded={false} className={open ? accordion.open : undefined}>
        <button type="button" className={accordion.toggle} aria-expanded={open} aria-controls={panelId} onClick={() => setOpen((value) => !value)}>
          <Scale size={18} aria-hidden className="subtle" />
          <span className={accordion.title}>
            <strong>Répartition des revenus</strong>
            <span className="subtle" style={over ? { color: 'var(--danger)' } : undefined}>
              {summary}
            </span>
          </span>
          <ChevronDown size={20} aria-hidden className={accordion.chevron} />
        </button>
        {open && (
          <div id={panelId} className={accordion.panel}>
            {!configured ? (
              <p className="subtle" style={{ fontSize: 'var(--text-sm)' }}>
                Indiquez pour chaque personne ce qui va au budget commun, à l’épargne et à l’investissement ; le reste est calculé automatiquement.
              </p>
            ) : (
              <>
                <ul className={styles.list}>
                  <li className={styles.line}>
                    <span>Revenus du foyer</span>
                    <span className="num">{eur(split.incomeCents)}</span>
                  </li>
                  <li className={styles.line}>
                    <span>Versé au budget commun</span>
                    <span className="num">{eur(split.commonCents)}</span>
                  </li>
                  <li className={styles.line}>
                    <span>Épargne</span>
                    <span className="num">{eur(split.savingsCents)}</span>
                  </li>
                  <li className={styles.line}>
                    <span>Investissement</span>
                    <span className="num">{eur(split.investCents)}</span>
                  </li>
                </ul>

                <div className={styles.envelope}>
                  <div className={styles.line}>
                    <strong>Budget commun</strong>
                    <strong className="num" style={{ color: over ? 'var(--danger)' : undefined }}>
                      {over ? `Dépassé de ${eur(-split.commonRemainingCents)}` : `${eur(split.commonRemainingCents)} restants`}
                    </strong>
                  </div>
                  <ProgressBar value={used} tone={over ? 'expense' : 'saving'} label="Budget commun consommé" size="lg" />
                  <p className="subtle" style={{ fontSize: 'var(--text-sm)' }}>
                    {eur(split.commonSpentCents)} dépensés sur {eur(split.budgetCents)} (dépenses communes et mensualités de prêts)
                  </p>
                </div>

                <ul className={styles.members}>
                  {split.members.map((m) => (
                    <li key={m.memberId} className="subtle">
                      <strong style={{ color: 'var(--text)' }}>{members.find((x) => x.uid === m.memberId)?.displayName ?? 'Membre'}</strong> : versé {eur(m.commonCents)} · reste {eur(m.leftCents)} · épargne {eur(m.savingsCents)} · investi{' '}
                      {eur(m.investCents)}
                    </li>
                  ))}
                </ul>
              </>
            )}
            {canWrite && (
              <Button variant="secondary" icon={<SlidersHorizontal size={16} />} onClick={() => setEditing(true)}>
                {configured ? 'Modifier la répartition' : 'Régler la répartition'}
              </Button>
            )}
          </div>
        )}
      </Card>
      {sheet}
    </>
  )
}
