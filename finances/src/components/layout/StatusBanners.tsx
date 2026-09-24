import { useEffect, useState } from 'react'
import { useRegisterSW } from 'virtual:pwa-register/react'
import { CloudOff, RefreshCw } from 'lucide-react'
import { useOnlineStatus } from '@/hooks/useOnlineStatus'
import { SYNC_ERROR_EVENT } from '@/services/repository'
import { toUserMessage } from '@/utils/firebaseErrors'
import styles from './StatusBanners.module.css'

/** Bandeaux système : hors-ligne, nouvelle version disponible, erreur de synchronisation. */
export function StatusBanners() {
  const online = useOnlineStatus()
  const {
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW()
  const [syncError, setSyncError] = useState<string | null>(null)

  useEffect(() => {
    const onError = (event: Event) => setSyncError(toUserMessage((event as CustomEvent).detail))
    window.addEventListener(SYNC_ERROR_EVENT, onError)
    return () => window.removeEventListener(SYNC_ERROR_EVENT, onError)
  }, [])

  return (
    <div className={styles.stack} aria-live="polite">
      {!online && (
        <div className={styles.banner}>
          <CloudOff size={16} aria-hidden />
          Hors ligne — vos saisies seront synchronisées au retour de la connexion.
        </div>
      )}
      {needRefresh && (
        <div className={styles.banner}>
          <RefreshCw size={16} aria-hidden />
          Nouvelle version disponible.
          <button type="button" className={styles.action} onClick={() => void updateServiceWorker(true)}>
            Mettre à jour
          </button>
        </div>
      )}
      {syncError && (
        <div className={[styles.banner, styles.error].join(' ')} role="alert">
          {syncError}
          <button type="button" className={styles.action} onClick={() => setSyncError(null)}>
            OK
          </button>
        </div>
      )}
    </div>
  )
}
