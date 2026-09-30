import { useEffect, useState } from 'react'
import { Bell, BellOff, Send } from 'lucide-react'
import { Button, Card, Notice } from '@/components/ui'
import { useCurrentUser } from '@/hooks/useAuth'
import { currentPushSubscription, disablePush, enablePush, pushSupport, sendTestPush } from '@/services/pushService'
import { toUserMessage } from '@/utils/firebaseErrors'
import styles from './Settings.module.css'

/** Abonnement de l'appareil courant aux notifications push (chaque appareil s'abonne séparément). */
export function PushNotificationsCard() {
  const user = useCurrentUser()
  const support = pushSupport()
  const [subscribed, setSubscribed] = useState<boolean | null>(null)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null)

  useEffect(() => {
    if (support !== 'ready') return
    currentPushSubscription()
      .then((s) => setSubscribed(s !== null))
      .catch(() => setSubscribed(false))
  }, [support])

  async function run(action: () => Promise<string>) {
    setBusy(true)
    setStatus(null)
    try {
      setStatus({ tone: 'success', text: await action() })
    } catch (err) {
      setStatus({ tone: 'danger', text: toUserMessage(err) })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card title="Notifications sur cet appareil" subtitle="Les alertes arrivent chaque matin vers 9 h, même application fermée.">
      <div className="stack">
        {status && <Notice tone={status.tone}>{status.text}</Notice>}
        {support === 'needs-install' && (
          <Notice tone="info">
            Sur iPhone, les notifications ne fonctionnent qu'avec l'application installée : Safari → Partager → « Sur l'écran d'accueil », puis
            ouvrez Foyer depuis l'écran d'accueil et revenez ici.
          </Notice>
        )}
        {support === 'unsupported' && <Notice tone="info">Ce navigateur ne permet pas les notifications.</Notice>}
        {support === 'ready' && subscribed === null && <p className="subtle">Vérification de cet appareil…</p>}
        {support === 'ready' && subscribed !== null && (
          <>
            <p className={styles.deviceStatus}>
              {subscribed ? <Bell size={16} aria-hidden /> : <BellOff size={16} aria-hidden />}
              {subscribed ? 'Notifications activées sur cet appareil.' : 'Notifications désactivées sur cet appareil.'}
            </p>
            {subscribed ? (
              <div className="row" style={{ flexWrap: 'wrap' }}>
                <Button
                  variant="secondary"
                  icon={<Send size={18} />}
                  loading={busy}
                  onClick={() => void run(async () => (await sendTestPush(), 'Notification de test envoyée : elle doit arriver dans quelques secondes.'))}
                >
                  Envoyer un test
                </Button>
                <Button
                  variant="ghost"
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      await disablePush(user.uid)
                      setSubscribed(false)
                      return 'Notifications désactivées sur cet appareil.'
                    })
                  }
                >
                  Désactiver
                </Button>
              </div>
            ) : (
              <Button
                icon={<Bell size={18} />}
                loading={busy}
                onClick={() =>
                  void run(async () => {
                    await enablePush(user.uid)
                    setSubscribed(true)
                    return 'Notifications activées. Touchez « Envoyer un test » pour vérifier.'
                  })
                }
              >
                Activer les notifications
              </Button>
            )}
          </>
        )}
      </div>
    </Card>
  )
}
