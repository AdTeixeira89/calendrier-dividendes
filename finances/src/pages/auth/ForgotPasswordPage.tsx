import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { FirebaseError } from 'firebase/app'
import { Mail } from 'lucide-react'
import { Button, Notice, TextField } from '@/components/ui'
import { resetPassword } from '@/services/authService'
import { toUserMessage } from '@/utils/firebaseErrors'
import { AuthLayout } from './AuthLayout'

export function ForgotPasswordPage() {
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    setError(null)
    setLoading(true)
    try {
      await resetPassword(email)
      setSent(true)
    } catch (err) {
      // Ne pas révéler si un compte existe : même message en cas d'utilisateur inconnu.
      if (err instanceof FirebaseError && err.code === 'auth/user-not-found') setSent(true)
      else setError(toUserMessage(err))
    } finally {
      setLoading(false)
    }
  }

  return (
    <AuthLayout
      title="Mot de passe oublié"
      subtitle="Recevez un lien de réinitialisation par e-mail."
      footer={<Link to="/connexion">Retour à la connexion</Link>}
    >
      {sent ? (
        <Notice tone="success">Si un compte existe pour {email}, un e-mail de réinitialisation vient d'être envoyé.</Notice>
      ) : (
        <form className="stack" onSubmit={onSubmit} noValidate>
          {error && <Notice tone="danger">{error}</Notice>}
          <TextField label="E-mail" type="email" autoComplete="email" inputMode="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          <Button type="submit" size="lg" block loading={loading} icon={<Mail size={18} />}>
            Envoyer le lien
          </Button>
        </form>
      )}
    </AuthLayout>
  )
}
