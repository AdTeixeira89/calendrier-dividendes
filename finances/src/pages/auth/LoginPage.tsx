import { useState, type FormEvent } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { LogIn } from 'lucide-react'
import { Button, Notice, TextField } from '@/components/ui'
import { login } from '@/services/authService'
import { toUserMessage } from '@/utils/firebaseErrors'
import { AuthLayout } from './AuthLayout'
import { safeNext } from './redirect'

export function LoginPage() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const next = safeNext(params.get('next'))

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    setError(null)
    setLoading(true)
    try {
      await login(email, password)
      navigate(next, { replace: true })
    } catch (err) {
      setError(toUserMessage(err))
      setLoading(false)
    }
  }

  const query = params.toString() ? `?${params.toString()}` : ''
  return (
    <AuthLayout
      title="Connexion"
      subtitle="Retrouvez les finances de votre foyer."
      footer={
        <>
          Pas encore de compte ? <Link to={`/inscription${query}`}>Créer un compte</Link>
        </>
      }
    >
      <form className="stack" onSubmit={onSubmit} noValidate>
        {error && <Notice tone="danger">{error}</Notice>}
        <TextField label="E-mail" type="email" autoComplete="email" inputMode="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        <TextField
          label="Mot de passe"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          hint={<Link to="/mot-de-passe-oublie">Mot de passe oublié ?</Link>}
        />
        <Button type="submit" size="lg" block loading={loading} icon={<LogIn size={18} />}>
          Se connecter
        </Button>
      </form>
    </AuthLayout>
  )
}
