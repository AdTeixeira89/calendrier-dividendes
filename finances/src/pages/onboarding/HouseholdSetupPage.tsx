import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { Navigate, useNavigate, useSearchParams } from 'react-router-dom'
import { Home, KeyRound, LogOut, Users } from 'lucide-react'
import { Button, Card, Notice, TextField } from '@/components/ui'
import { AuthLayout } from '@/pages/auth/AuthLayout'
import { useAuth, useCurrentUser } from '@/hooks/useAuth'
import { useHouseholdState } from '@/hooks/useHousehold'
import { logout } from '@/services/authService'
import { createHousehold, getInvite, isInviteUsable, joinHousehold } from '@/services/householdService'
import type { HouseholdInvite } from '@/types'
import { toUserMessage } from '@/utils/firebaseErrors'
import { formatDate } from '@/utils/dates'
import { formatInviteCode, isValidInviteCode, normalizeInviteCode } from '@/utils/inviteCode'
import styles from './HouseholdSetupPage.module.css'

type Mode = 'choice' | 'create' | 'join'

/** Première connexion : créer un foyer ou rejoindre celui de son/sa conjoint(e). */
export function HouseholdSetupPage() {
  const user = useCurrentUser()
  const { profile } = useAuth()
  const { household } = useHouseholdState()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const codeFromLink = params.get('code')
  const [mode, setMode] = useState<Mode>(codeFromLink ? 'join' : 'choice')

  // Déjà membre d'un foyer et pas de lien d'invitation : direction l'accueil.
  if (household && !codeFromLink) return <Navigate to="/" replace />

  return (
    <AuthLayout
      title={mode === 'join' ? 'Rejoindre un foyer' : `Bienvenue${profile ? `, ${profile.displayName}` : ''}`}
      subtitle={
        mode === 'join'
          ? 'Saisissez le code reçu pour partager les finances du foyer.'
          : 'Toutes vos finances sont rattachées à un foyer, partagé avec votre conjoint(e).'
      }
      footer={
        <div className={styles.account}>
          <span className={styles.email}>{user.email}</span>
          <Button variant="ghost" size="sm" icon={<LogOut size={16} />} onClick={() => void logout()}>
            Se déconnecter
          </Button>
        </div>
      }
    >
      {mode === 'choice' && (
        <div className="stack">
          <ChoiceCard icon={<Home size={22} />} title="Créer notre foyer" text="Je suis le premier à m'inscrire." onClick={() => setMode('create')} />
          <ChoiceCard icon={<Users size={22} />} title="Rejoindre un foyer" text="J'ai reçu un code d'invitation." onClick={() => setMode('join')} />
        </div>
      )}
      {mode === 'create' && <CreateForm onBack={() => setMode('choice')} onDone={() => navigate('/', { replace: true })} />}
      {mode === 'join' && (
        <JoinForm initialCode={codeFromLink ?? ''} onBack={() => setMode('choice')} onDone={() => navigate('/', { replace: true })} />
      )}
    </AuthLayout>
  )
}

function ChoiceCard({ icon, title, text, onClick }: { icon: ReactNode; title: string; text: string; onClick: () => void }) {
  return (
    <button type="button" className={styles.choice} onClick={onClick}>
      <span className={styles.choiceIcon}>{icon}</span>
      <span>
        <strong>{title}</strong>
        <span className={styles.choiceText}>{text}</span>
      </span>
    </button>
  )
}

function CreateForm({ onBack, onDone }: { onBack: () => void; onDone: () => void }) {
  const user = useCurrentUser()
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    if (!name.trim()) return setError('Donnez un nom à votre foyer.')
    setError(null)
    setLoading(true)
    try {
      await createHousehold(user, name)
      onDone()
    } catch (err) {
      setError(toUserMessage(err))
      setLoading(false)
    }
  }

  return (
    <form className="stack" onSubmit={onSubmit} noValidate>
      {error && <Notice tone="danger">{error}</Notice>}
      <TextField label="Nom du foyer" placeholder="Ex. Famille Martin" maxLength={80} value={name} onChange={(e) => setName(e.target.value)} autoFocus />
      <Button type="submit" size="lg" block loading={loading}>
        Créer le foyer
      </Button>
      <Button variant="ghost" onClick={onBack}>
        Retour
      </Button>
    </form>
  )
}

function JoinForm({ initialCode, onBack, onDone }: { initialCode: string; onBack: () => void; onDone: () => void }) {
  const user = useCurrentUser()
  const [code, setCode] = useState(initialCode)
  const [invite, setInvite] = useState<HouseholdInvite | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(Boolean(initialCode))
  const normalized = normalizeInviteCode(code)

  function applyLookup(result: InviteLookup) {
    setInvite(result.invite)
    setError(result.error)
    setLoading(false)
  }

  function checkCode(value: string) {
    setError(null)
    setInvite(null)
    setLoading(true)
    void lookupInvite(value).then(applyLookup)
  }

  // Lien d'invitation : vérification automatique du code reçu.
  useEffect(() => {
    if (!initialCode) return
    let cancelled = false
    void lookupInvite(normalizeInviteCode(initialCode)).then((result) => {
      if (!cancelled) applyLookup(result)
    })
    return () => {
      cancelled = true
    }
  }, [initialCode])

  async function onJoin() {
    if (!invite) return
    setError(null)
    setLoading(true)
    try {
      await joinHousehold(user, invite)
      onDone()
    } catch (err) {
      setError(toUserMessage(err))
      setLoading(false)
    }
  }

  if (invite) {
    return (
      <div className="stack">
        {error && <Notice tone="danger">{error}</Notice>}
        <Card>
          <p className="muted">Vous êtes invité(e) à rejoindre</p>
          <p className={styles.householdName}>{invite.householdName}</p>
          <p className="subtle">Invitation valable jusqu'au {formatDate(invite.expiresAt.toDate())}</p>
        </Card>
        <Button size="lg" block loading={loading} onClick={() => void onJoin()}>
          Rejoindre ce foyer
        </Button>
        <Button variant="ghost" onClick={() => setInvite(null)}>
          Utiliser un autre code
        </Button>
      </div>
    )
  }

  return (
    <form
      className="stack"
      onSubmit={(e) => {
        e.preventDefault()
        checkCode(normalized)
      }}
      noValidate
    >
      {error && <Notice tone="danger">{error}</Notice>}
      <TextField
        label="Code d'invitation"
        placeholder="XXXXX-XXXXX"
        autoCapitalize="characters"
        autoComplete="off"
        spellCheck={false}
        value={normalized.length === 10 ? formatInviteCode(normalized) : code}
        onChange={(e) => setCode(e.target.value)}
        trailing={<KeyRound size={18} className="subtle" aria-hidden />}
      />
      <Button type="submit" size="lg" block loading={loading}>
        Vérifier le code
      </Button>
      <Button variant="ghost" onClick={onBack}>
        Retour
      </Button>
    </form>
  )
}

interface InviteLookup {
  invite: HouseholdInvite | null
  error: string | null
}

async function lookupInvite(code: string): Promise<InviteLookup> {
  if (!isValidInviteCode(code)) return { invite: null, error: "Code d'invitation invalide." }
  try {
    const found = await getInvite(code)
    if (!found) return { invite: null, error: 'Code introuvable. Vérifiez la saisie.' }
    if (!isInviteUsable(found)) {
      return { invite: null, error: 'Cette invitation a expiré ou a déjà été utilisée. Demandez-en une nouvelle.' }
    }
    return { invite: found, error: null }
  } catch (err) {
    return { invite: null, error: toUserMessage(err) }
  }
}
