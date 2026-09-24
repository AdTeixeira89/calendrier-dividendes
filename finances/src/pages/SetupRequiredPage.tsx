import { Settings2 } from 'lucide-react'
import { EmptyState } from '@/components/ui'

/** Affichée lorsque la configuration Firebase est absente (.env.local manquant). */
export function SetupRequiredPage() {
  return (
    <div style={{ display: 'grid', placeItems: 'center', minHeight: '100dvh', padding: 16 }}>
      <EmptyState
        icon={<Settings2 size={28} />}
        title="Configuration Firebase manquante"
        description={
          <>
            Copiez <code>.env.example</code> en <code>.env.local</code> et renseignez la configuration de votre projet Firebase,
            ou lancez l'application avec les émulateurs (<code>VITE_USE_EMULATORS=true</code>). Voir le README.
          </>
        }
      />
    </div>
  )
}
