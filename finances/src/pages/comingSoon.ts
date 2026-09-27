import { Banknote, BarChart3, CreditCard, FileText, Landmark, PiggyBank, Receipt, Repeat, type LucideIcon } from 'lucide-react'

export interface ComingSoonContent {
  title: string
  icon: LucideIcon
  phase: number
  description: string
  features: string[]
}

/** Modules livrés dans les phases suivantes (voir docs/ARCHITECTURE.md). */
export const COMING_SOON: Record<string, ComingSoonContent> = {
  depenses: {
    title: 'Dépenses',
    icon: Receipt,
    phase: 2,
    description: 'Saisie rapide, catégories personnalisables, dépenses récurrentes et budget prévu vs réel.',
    features: ['Ajout en 3 secondes', 'Catégories et sous-catégories', 'Personnel / commun', 'Budget, réel, écart'],
  },
  revenus: {
    title: 'Revenus',
    icon: Banknote,
    phase: 2,
    description: 'Salaires, primes, allocations et revenus secondaires, par membre du foyer.',
    features: ['Mensuel, annuel, ponctuel', 'Revenus par personne', 'Revenus du foyer'],
  },
  analyse: {
    title: 'Analyse',
    icon: BarChart3,
    phase: 2,
    description: 'Cockpit mensuel, évolution sur 12 mois et répartition des dépenses par catégorie.',
    features: ['Vue mensuelle', 'Graphiques lisibles', "Taux d'épargne", 'Charges fixes vs variables'],
  },
  epargne: {
    title: 'Épargne',
    icon: PiggyBank,
    phase: 3,
    description: "Objectifs d'épargne avec progression, versements prévus et date d'atteinte estimée.",
    features: ['Épargne de sécurité', 'Vacances, voiture, travaux…', "Estimation de la date d'atteinte"],
  },
  dette: {
    title: 'Ma dette',
    icon: CreditCard,
    phase: 3,
    description: 'Prêts immobiliers, travaux, consommation : capital restant, mensualités et date de désendettement.',
    features: ['Tableau d\'amortissement', '% remboursé', 'Courbe de diminution de la dette'],
  },
  abonnements: {
    title: 'Abonnements',
    icon: Repeat,
    phase: 3,
    description: 'Tous vos abonnements, leur coût mensuel et annuel.',
    features: ['Coût annuel total', 'Abonnements peu utilisés'],
  },
  documents: {
    title: 'Tickets & documents',
    icon: FileText,
    phase: 4,
    description: 'Scanner un ticket, importer une facture PDF : extraction OCR, puis validation par vous avant tout enregistrement.',
    features: ['Photo ou PDF', 'Extraction automatique', 'Validation humaine obligatoire'],
  },
  patrimoine: {
    title: 'Patrimoine',
    icon: Landmark,
    phase: 6,
    description: 'Actifs moins passifs : votre patrimoine net et son évolution.',
    features: ['Comptes, placements, immobilier', 'Patrimoine net', 'Évolution'],
  },
}
