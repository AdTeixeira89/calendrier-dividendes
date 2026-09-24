import { useState, type FormEvent } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { UserPlus } from 'lucide-react'
import { Button, Notice, TextField } from '@/components/ui'
import { register } from '@/services/authService'
import { toUserMessage } from '@/utils/firebaseErrors'
import { AuthLayout } from './AuthLayout'
import { safeNext } from './redirect'

const MIN_PASSWORD_LENGTH = 8

export function RegisterPage() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const [displayName, setDisplayName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const next = safeNext(params.get('next'))

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    setError(null)
    if (!displayName.trim()) return setError('Indiquez votre prénom.')
    if (password.length < MIN_PASSWORD_LENGTH) return setError(`Le mot de passe doit contenir au moins ${MIN_PASSWORD_LENGTH} caractères.`)
    setLoading(true)
    try {
      await register({ displayName, email, password })
      navigate(next, { replace: true })
    } catch (err) {
      setError(toUserMessage(err))
      setLoading(false)
    }
  }

  const query = params.toString() ? `?${params.toString()}` : ''
  return (
    <AuthLayout
      title="Créer un compte"
      subtitle="Quelques secondes pour prendre le contrôle de vos finances."
      footer={
        <>
          Déjà un compte ? <Link to={`/connexion${query}`}>Se connecter</Link>
        </>
      }
    >
      <form className="stack" onSubmit={onSubmit} noValidate>
        {error && <Notice tone="danger">{error}</Notice>}
        <TextField label="Prénom" autoComplete="given-name" required maxLength={80} value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
        <TextField label="E-mail" type="email" autoComplete="email" inputMode="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        <TextField
          label="Mot de passe"
          type="password"
          autoComplete="new-password"
          required
          minLength={MIN_PASSWORD_LENGTH}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          hint={`${MIN_PASSWORD_LENGTH} caractères minimum.`}
        />
        <Button type="submit" size="lg" block loading={loading} icon={<UserPlus size={18} />}>
          Créer mon compte
        </Button>
      </form>
    </AuthLayout>
  )
}
