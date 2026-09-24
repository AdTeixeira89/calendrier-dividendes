import { Check } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { Card, EmptyState } from '@/components/ui'
import { COMING_SOON } from './comingSoon'
import styles from './ComingSoonPage.module.css'

/** Emplacement d'un module livré dans une phase ultérieure. */
export function ComingSoonPage({ module }: { module: keyof typeof COMING_SOON }) {
  const content = COMING_SOON[module]
  if (!content) return null
  const Icon = content.icon
  return (
    <div className="animate-in">
      <PageHeader title={content.title} />
      <Card>
        <EmptyState
          icon={<Icon size={28} />}
          title={`Arrive en phase ${content.phase}`}
          description={content.description}
          action={
            <ul className={styles.features}>
              {content.features.map((feature) => (
                <li key={feature}>
                  <Check size={16} aria-hidden /> {feature}
                </li>
              ))}
            </ul>
          }
        />
      </Card>
    </div>
  )
}
