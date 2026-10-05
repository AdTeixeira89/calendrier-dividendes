import { useState } from 'react'
import { SlidersHorizontal } from 'lucide-react'
import { Button, Card, ProgressBar } from '@/components/ui'
import { useHousehold } from '@/hooks/useHousehold'
import type { Cents } from '@/types'
import { planIsEmpty, type BudgetSplitSettings, type HouseholdSplit } from '@/utils/budgetSplit'
import { formatCents } from '@/utils/money'
import styles from './BudgetSplitCard.module.css'
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
  const configured = members.some((m) => !planIsEmpty(settings.plans[m.uid]))
  const action = canWrite ? (
    <Button variant="secondary" size="sm" icon={<SlidersHorizontal size={16} />} onClick={() => setOpen(true)}>
      {configured ? 'Modifier' : 'Régler'}
    </Button>
  ) : undefined
  const sheet = <BudgetSplitSheet key={JSON.stringify(settings.plans)} open={open} onClose={() => setOpen(false)} householdId={household.id} settings={settings} split={split} />

  if (!configured) {
    return (
      <>
        <Card title="Répartition des revenus" subtitle="Budget commun, épargne, investissement : réglez la part de chacun." action={action}>
          <p className="subtle">Indiquez pour chaque personne ce qui va au budget commun, à l’épargne et à l’investissement ; le reste est calculé automatiquement.</p>
        </Card>
        {sheet}
      </>
    )
  }

  const used = split.commonCents > 0 ? (split.commonSpentCents / split.commonCents) * 100 : 0
  const over = split.commonRemainingCents < 0
  return (
    <>
      <Card title="Répartition des revenus" subtitle="Où va l’argent ce mois-ci" action={action}>
        <ul className={styles.list}>
          <li className={styles.line}>
            <span>Revenus du foyer</span>
            <span className="num">{eur(split.incomeCents)}</span>
          </li>
          <li className={styles.line}>
            <span>Budget commun</span>
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
          <li className={`${styles.line} ${styles.total}`}>
            <span>Reste personnel</span>
            <span className="num">{eur(split.personalCents)}</span>
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
            {eur(split.commonSpentCents)} dépensés sur {eur(split.commonCents)} (dépenses communes et mensualités de prêts)
          </p>
        </div>

        <ul className={styles.members}>
          {split.members.map((m) => (
            <li key={m.memberId} className="subtle">
              <strong style={{ color: 'var(--text)' }}>{members.find((x) => x.uid === m.memberId)?.displayName ?? 'Membre'}</strong> : {eur(m.salaryCents)} → {eur(m.commonCents)} commun · {eur(m.savingsCents)}{' '}
              épargne · {eur(m.investCents)} investi · reste {eur(m.remainingCents)}
            </li>
          ))}
        </ul>
      </Card>
      {sheet}
    </>
  )
}
