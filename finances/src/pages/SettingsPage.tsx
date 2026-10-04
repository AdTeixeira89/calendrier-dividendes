import { useState } from 'react'
import { LogOut, Monitor, Moon, Sun } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { DeleteAccountCard } from '@/components/settings/DeleteAccountCard'
import { AlertSettingsCard } from '@/components/settings/AlertSettingsCard'
import { PushNotificationsCard } from '@/components/settings/PushNotificationsCard'
import { Button, Card, Notice, TextField } from '@/components/ui'
import { useAlertSettings } from '@/hooks/useAlertSettings'
import { useAuth, useCurrentUser } from '@/hooks/useAuth'
import { useHousehold } from '@/hooks/useHousehold'
import { useTheme } from '@/hooks/useTheme'
import type { ThemePreference } from '@/contexts/ThemeContext'
import { logout } from '@/services/authService'
import { updateUserProfile } from '@/services/userService'
import { toUserMessage } from '@/utils/firebaseErrors'
import styles from './SettingsPage.module.css'

const THEMES: { value: ThemePreference; label: string; icon: typeof Sun }[] = [
  { value: 'dark', label: 'Sombre', icon: Moon },
  { value: 'light', label: 'Clair', icon: Sun },
  { value: 'system', label: 'Système', icon: Monitor },
]

export function SettingsPage() {
  const user = useCurrentUser()
  const { profile } = useAuth()
  const { preference, setPreference } = useTheme()
  const { household } = useHousehold()
  const alertSettings = useAlertSettings(household.id)
  const [displayName, setDisplayName] = useState(profile?.displayName ?? '')
  const [status, setStatus] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null)

  async function saveProfile() {
    if (!displayName.trim()) return
    try {
      await updateUserProfile(user.uid, { displayName: displayName.trim() })
      setStatus({ tone: 'success', text: 'Profil mis à jour.' })
    } catch (err) {
      setStatus({ tone: 'danger', text: toUserMessage(err) })
    }
  }

  return (
    <div className="stack animate-in">
      <PageHeader title="Paramètres" />

      <Card title="Apparence">
        <div className={styles.segmented} role="radiogroup" aria-label="Thème">
          {THEMES.map(({ value, label, icon: Icon }) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={preference === value}
              className={[styles.segment, preference === value && styles.selected].filter(Boolean).join(' ')}
              onClick={() => setPreference(value)}
            >
              <Icon size={16} aria-hidden /> {label}
            </button>
          ))}
        </div>
      </Card>

      {alertSettings && <AlertSettingsCard key={household.id} initial={alertSettings} />}

      <PushNotificationsCard />

      <Card title="Profil" subtitle={user.email ?? undefined}>
        <form
          className="stack"
          onSubmit={(e) => {
            e.preventDefault()
            void saveProfile()
          }}
        >
          {status && <Notice tone={status.tone}>{status.text}</Notice>}
          <TextField label="Prénom affiché" maxLength={80} value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
          <Button type="submit" variant="secondary">
            Enregistrer
          </Button>
        </form>
      </Card>

      <Card title="Installer l'application">
        <p className="muted">
          Sur iPhone : Safari → Partager → « Sur l'écran d'accueil ». Sur Android et ordinateur : menu du navigateur → « Installer
          l'application ».
        </p>
      </Card>

      <Button variant="secondary" icon={<LogOut size={18} />} onClick={() => void logout()}>
        Se déconnecter
      </Button>

      <DeleteAccountCard />
    </div>
  )
}
