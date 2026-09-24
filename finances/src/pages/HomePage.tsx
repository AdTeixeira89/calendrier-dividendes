import { Link } from 'react-router-dom'
import { ArrowDownRight, ArrowUpRight, CheckCircle2, Circle, PiggyBank, Wallet } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { Card, StatCard } from '@/components/ui'
import { useAuth } from '@/hooks/useAuth'
import { useHousehold } from '@/hooks/useHousehold'
import { formatMonth, greeting } from '@/utils/dates'
import styles from './HomePage.module.css'

export function HomePage() {
  const { profile } = useAuth()
  const { household, members } = useHousehold()
  const month = formatMonth(new Date())

  const steps = [
    { done: true, label: 'Créer votre foyer', to: '/foyer' },
    { done: members.length > 1, label: 'Inviter votre conjoint(e)', to: '/foyer' },
    { done: false, label: 'Ajouter vos revenus', to: '/revenus' },
    { done: false, label: 'Saisir vos charges fixes et dépenses', to: '/depenses' },
    { done: false, label: 'Renseigner vos crédits', to: '/dette' },
  ]
  const doneCount = steps.filter((s) => s.done).length

  return (
    <div className="stack animate-in">
      <PageHeader title={`${greeting()}${profile ? `, ${profile.displayName}` : ''}`} subtitle={`${household.name} · situation de ${month}`} />

      <section aria-label="Situation du mois" className={styles.stats}>
        <StatCard label="Revenus" amount={null} tone="income" icon={<ArrowUpRight size={16} />} footnote="Aucun revenu saisi" />
        <StatCard label="Dépenses" amount={null} tone="expense" icon={<ArrowDownRight size={16} />} higherIsBetter={false} footnote="Aucune dépense saisie" />
        <StatCard label="Épargne" amount={null} tone="saving" icon={<PiggyBank size={16} />} footnote="Revenus − dépenses" />
        <StatCard label="Reste à vivre" amount={null} tone="accent" icon={<Wallet size={16} />} footnote="Après charges et épargne" />
      </section>

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
    </div>
  )
}
