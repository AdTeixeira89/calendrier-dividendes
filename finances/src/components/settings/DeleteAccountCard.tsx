import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { Trash2 } from 'lucide-react'
import { Button, Card, Notice, Sheet, TextField } from '@/components/ui'
import { useCurrentUser } from '@/hooks/useAuth'
import { useHousehold } from '@/hooks/useHousehold'
import { deleteMyAccount } from '@/services/accountService'
import { toUserMessage } from '@/utils/firebaseErrors'

/** Suppression définitive du compte (exigée par l'App Store et le Play Store). */
export function DeleteAccountCard() {
  const user = useCurrentUser()
  const { household, members } = useHousehold()
  const [open, setOpen] = useState(false)
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const alone = members.length <= 1

  function close() {
    if (loading) return
    setOpen(false)
    setPassword('')
    setError(null)
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    if (!password) return setError('Saisissez votre mot de passe pour confirmer.')
    setError(null)
    setLoading(true)
    try {
      await deleteMyAccount(user, password)
    } catch (err) {
      setError(toUserMessage(err))
      setLoading(false)
    }
  }

  return (
    <>
      <Card title="Supprimer mon compte" subtitle="Action définitive, impossible à annuler.">
        <Button variant="danger" icon={<Trash2 size={18} />} onClick={() => setOpen(true)}>
          Supprimer mon compte
        </Button>
      </Card>

      <Sheet open={open} onClose={close} title="Supprimer mon compte">
        <form className="stack" onSubmit={onSubmit} noValidate>
          {error && <Notice tone="danger">{error}</Notice>}
          <p>Seront effacés définitivement : votre compte, vos informations personnelles et vos appareils abonnés aux notifications.</p>
          {alone ? (
            <Notice tone="warning">
              Vous êtes seul(e) dans le foyer « {household.name} » : il sera supprimé en entier, avec toutes ses dépenses, revenus, dettes, épargnes,
              abonnements, documents et tickets.
            </Notice>
          ) : (
            <Notice tone="info">
              Le foyer « {household.name} » continue pour les autres membres, avec ses données (y compris celles que vous avez saisies). L'un d'eux en
              devient propriétaire si vous l'étiez.
            </Notice>
          )}
          <p className="subtle">
            Besoin de vos données ? Exportez-les d'abord depuis <Link to="/ia">IA Finance</Link> (fichier CSV et résumé).
          </p>
          <TextField
            label="Mot de passe"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            hint="Confirmation de sécurité : il est demandé avant toute suppression."
          />
          <Button type="submit" variant="danger" size="lg" block loading={loading}>
            Supprimer définitivement
          </Button>
          <Button variant="ghost" onClick={close} disabled={loading}>
            Annuler
          </Button>
        </form>
      </Sheet>
    </>
  )
}
