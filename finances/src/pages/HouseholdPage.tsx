import { useState } from 'react'
import { Check, Copy, LogOut, Pencil, Share2, UserMinus, UserPlus } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { Button, Card, Notice, TextField } from '@/components/ui'
import { useCurrentUser } from '@/hooks/useAuth'
import { useHousehold } from '@/hooks/useHousehold'
import { createInvite, leaveHousehold, removeMember, renameHousehold } from '@/services/householdService'
import type { HouseholdInvite, HouseholdRole } from '@/types'
import { formatDate } from '@/utils/dates'
import { toUserMessage } from '@/utils/firebaseErrors'
import { formatInviteCode } from '@/utils/inviteCode'
import styles from './HouseholdPage.module.css'

const ROLE_LABELS: Record<HouseholdRole, string> = {
  owner: 'Propriétaire',
  member: 'Membre',
  viewer: 'Lecture seule',
}

export function HouseholdPage() {
  const user = useCurrentUser()
  const { household, members, role, canWrite } = useHousehold()
  const isOwner = role === 'owner'
  const [error, setError] = useState<string | null>(null)

  async function run(action: () => Promise<void>) {
    setError(null)
    try {
      await action()
    } catch (err) {
      setError(toUserMessage(err))
    }
  }

  return (
    <div className="stack animate-in">
      <PageHeader title="Foyer & membres" subtitle="Les membres du foyer voient les mêmes finances." />
      {error && <Notice tone="danger">{error}</Notice>}

      <HouseholdNameCard name={household.name} editable={canWrite} onSave={(name) => run(() => renameHousehold(user, household.id, name))} />

      <Card title="Membres" subtitle={`${members.length} membre${members.length > 1 ? 's' : ''}`}>
        <ul className={styles.members}>
          {members.map((member) => (
            <li key={member.uid} className={styles.member}>
              <span className={styles.avatar} aria-hidden>
                {member.displayName.charAt(0).toUpperCase()}
              </span>
              <span className={styles.memberInfo}>
                <strong>
                  {member.displayName}
                  {member.uid === user.uid && <span className="subtle"> (vous)</span>}
                </strong>
                <span className="subtle">{member.email}</span>
              </span>
              <span className={styles.role}>{ROLE_LABELS[member.role]}</span>
              {isOwner && member.uid !== user.uid && (
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={`Retirer ${member.displayName}`}
                  icon={<UserMinus size={16} />}
                  onClick={() => {
                    if (confirm(`Retirer ${member.displayName} du foyer ?`)) void run(() => removeMember(user, household.id, member.uid))
                  }}
                />
              )}
            </li>
          ))}
        </ul>
      </Card>

      {canWrite && <InviteCard onError={setError} />}

      {!isOwner && (
        <Button
          variant="danger"
          icon={<LogOut size={18} />}
          onClick={() => {
            if (confirm(`Quitter le foyer « ${household.name} » ? Vous n'aurez plus accès à ses données.`))
              void run(() => leaveHousehold(user, household.id))
          }}
        >
          Quitter ce foyer
        </Button>
      )}
    </div>
  )
}

function HouseholdNameCard({ name, editable, onSave }: { name: string; editable: boolean; onSave: (name: string) => Promise<void> }) {
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(name)
  if (!editing) {
    return (
      <Card
        title="Nom du foyer"
        action={
          editable && (
            <Button variant="ghost" size="sm" icon={<Pencil size={16} />} onClick={() => setEditing(true)}>
              Modifier
            </Button>
          )
        }
      >
        <p className={styles.name}>{name}</p>
      </Card>
    )
  }
  return (
    <Card title="Nom du foyer">
      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault()
          if (!value.trim()) return
          void onSave(value).then(() => setEditing(false))
        }}
      >
        <TextField label="Nom" maxLength={80} value={value} onChange={(e) => setValue(e.target.value)} autoFocus />
        <div className="row">
          <Button type="submit">Enregistrer</Button>
          <Button variant="ghost" onClick={() => setEditing(false)}>
            Annuler
          </Button>
        </div>
      </form>
    </Card>
  )
}

function InviteCard({ onError }: { onError: (message: string | null) => void }) {
  const user = useCurrentUser()
  const { household } = useHousehold()
  const [invite, setInvite] = useState<HouseholdInvite | null>(null)
  const [loading, setLoading] = useState(false)
  const [copied, setCopied] = useState(false)

  const canShare = typeof navigator.share === 'function'
  const link = invite ? `${window.location.origin}${import.meta.env.BASE_URL}rejoindre?code=${invite.code}` : ''

  async function generate() {
    onError(null)
    setLoading(true)
    try {
      setInvite(await createInvite(user, household))
    } catch (err) {
      onError(toUserMessage(err))
    } finally {
      setLoading(false)
    }
  }

  async function share() {
    const text = `Rejoins notre foyer « ${household.name} » sur Foyer : ${link}`
    if (canShare) {
      await navigator.share({ title: 'Invitation Foyer', text, url: link }).catch(() => undefined)
      return
    }
    await navigator.clipboard.writeText(link)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <Card title="Inviter un membre" subtitle="Votre conjoint(e) crée son compte puis saisit ce code. Usage unique, valable 7 jours.">
      {invite ? (
        <div className="stack">
          <p className={`${styles.code} num`} aria-label="Code d'invitation">
            {formatInviteCode(invite.code)}
          </p>
          <p className="subtle">Expire le {formatDate(invite.expiresAt.toDate())}</p>
          <div className="row">
            <Button icon={copied ? <Check size={18} /> : canShare ? <Share2 size={18} /> : <Copy size={18} />} onClick={() => void share()}>
              {copied ? 'Lien copié' : canShare ? 'Partager le lien' : 'Copier le lien'}
            </Button>
            <Button variant="ghost" onClick={() => void generate()} loading={loading}>
              Nouveau code
            </Button>
          </div>
        </div>
      ) : (
        <Button icon={<UserPlus size={18} />} loading={loading} onClick={() => void generate()}>
          Générer une invitation
        </Button>
      )}
    </Card>
  )
}
