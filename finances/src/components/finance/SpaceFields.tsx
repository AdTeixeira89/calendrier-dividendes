import { SegmentedControl } from '@/components/ui/SegmentedControl'
import { useCurrentUser } from '@/hooks/useAuth'
import { useHousehold } from '@/hooks/useHousehold'
import { COMMON_SPACE, type Space } from '@/utils/spaces'

export type Privacy = 'visible' | 'private'

interface SpaceFieldsProps {
  space: Space
  onSpace: (space: Space) => void
  /** Choix visible / privée : proposé seulement pour son propre espace personnel. */
  privacy?: Privacy
  onPrivacy?: (privacy: Privacy) => void
}

/** Les espaces du foyer : Communes, puis un par membre (ses dépenses personnelles). */
export function SpaceFields({ space, onSpace, privacy, onPrivacy }: SpaceFieldsProps) {
  const user = useCurrentUser()
  const { members } = useHousehold()
  const options = [{ value: COMMON_SPACE, label: 'Communes' }, ...members.map((m) => ({ value: m.uid, label: m.displayName }))]
  const ownSpace = space === user.uid

  return (
    <>
      <SegmentedControl label="Espace" value={space} onChange={onSpace} options={options} />
      {ownSpace && privacy && onPrivacy && (
        <>
          <SegmentedControl
            label="Confidentialité"
            value={privacy}
            onChange={onPrivacy}
            options={[
              { value: 'visible', label: "Visible par l'autre membre" },
              { value: 'private', label: 'Privée' },
            ]}
          />
          {privacy === 'private' && (
            <p className="subtle" style={{ fontSize: 'var(--text-sm)' }}>
              Invisible pour l’autre membre du foyer ; comptée dans votre suivi personnel.
            </p>
          )}
        </>
      )}
    </>
  )
}
