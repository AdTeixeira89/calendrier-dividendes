import {
  Banknote,
  BarChart3,
  Bot,
  Camera,
  CreditCard,
  FileText,
  Home,
  Landmark,
  PiggyBank,
  Receipt,
  Repeat,
  Settings,
  Users,
  Wallet,
  type LucideIcon,
} from 'lucide-react'

export interface NavItem {
  to: string
  label: string
  icon: LucideIcon
}

/** Navigation principale (barre du bas sur mobile). */
export const PRIMARY_NAV: NavItem[] = [
  { to: '/', label: 'Accueil', icon: Home },
  { to: '/depenses', label: 'Dépenses', icon: Receipt },
  { to: '/epargne', label: 'Épargne', icon: PiggyBank },
  { to: '/dette', label: 'Dette', icon: CreditCard },
  { to: '/analyse', label: 'Analyse', icon: BarChart3 },
]

/** Menu secondaire (page « Plus » sur mobile, rail latéral sur desktop). */
export const SECONDARY_NAV: NavItem[] = [
  { to: '/patrimoine', label: 'Patrimoine', icon: Landmark },
  { to: '/abonnements', label: 'Abonnements', icon: Repeat },
  { to: '/ia', label: 'IA Finance', icon: Bot },
  { to: '/foyer', label: 'Foyer & membres', icon: Users },
  { to: '/parametres', label: 'Paramètres', icon: Settings },
]

/** Actions du bouton « + » central. */
export const QUICK_ACTIONS: NavItem[] = [
  { to: '/depenses?ajouter=1', label: 'Dépense', icon: Receipt },
  { to: '/revenus?ajouter=1', label: 'Revenu', icon: Banknote },
  { to: '/epargne?ajouter=1', label: 'Épargne', icon: Wallet },
  { to: '/dette?ajouter=1', label: 'Dette', icon: CreditCard },
  { to: '/documents?scanner=1', label: 'Ticket', icon: Camera },
  { to: '/documents?importer=1', label: 'Document', icon: FileText },
]
