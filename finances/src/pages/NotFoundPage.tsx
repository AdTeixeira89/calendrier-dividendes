import { Link } from 'react-router-dom'
import { Compass } from 'lucide-react'
import { EmptyState } from '@/components/ui'

export function NotFoundPage() {
  return (
    <EmptyState
      icon={<Compass size={28} />}
      title="Page introuvable"
      description="Cette page n'existe pas ou a été déplacée."
      action={<Link to="/">Retour à l'accueil</Link>}
    />
  )
}
