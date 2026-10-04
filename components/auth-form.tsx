'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { authClient } from '@/lib/auth-client'

export function AuthForm({ mode }: { mode: 'sign-in' | 'sign-up' }) {
  const router = useRouter()
  const [error, setError] = useState('')
  const [pending, setPending] = useState(false)
  const isSignUp = mode === 'sign-up'

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    setPending(true)
    const data = new FormData(event.currentTarget)
    const email = String(data.get('email') ?? '').trim()
    const password = String(data.get('password') ?? '')
    const name = String(data.get('name') ?? '').trim()
    try {
      const result = isSignUp
        ? await authClient.signUp.email({ email, password, name })
        : await authClient.signIn.email({ email, password })
      if (result.error) {
        console.error('[v0] signup/auth error', { mode, status: result.error.status, code: result.error.code })
        const errorCode = String(result.error.code ?? '').toUpperCase()
        const errorMessage = String(result.error.message ?? '').toLowerCase()
        const isDuplicateAccount = isSignUp && (
          errorCode.includes('USER_ALREADY_EXISTS') ||
          errorCode.includes('EMAIL_ALREADY_EXISTS') ||
          errorMessage.includes('user already exists') ||
          errorMessage.includes('email already exists')
        )
        setError(
          isDuplicateAccount
            ? 'Cette adresse e-mail est déjà utilisée. Connectez-vous ou utilisez une autre adresse.'
            : result.error.status >= 500
              ? 'Le service d’authentification est temporairement indisponible.'
              : 'La demande d’authentification a été refusée.'
        )
        return
      }
      router.push('/')
      router.refresh()
    } catch (error) {
      console.error('[v0] signup/auth request failed', { mode, error: error instanceof Error ? error.message : 'unknown_error' })
      setError('Impossible de joindre le service d’authentification. Veuillez réessayer.')
    } finally {
      setPending(false)
    }
  }

  return <form onSubmit={submit} className="grid gap-4">
    {isSignUp && <input name="name" required placeholder="Nom complet" aria-label="Nom complet" className="terminal-input" />}
    <input name="email" type="email" required placeholder="Email professionnel" aria-label="Email professionnel" className="terminal-input" />
    <input name="password" type="password" minLength={8} required placeholder="Mot de passe" aria-label="Mot de passe" className="terminal-input" />
    {error && <p className="text-sm text-bear" role="alert">{error}</p>}
    <button disabled={pending} className="gold-button">{pending ? 'Vérification…' : isSignUp ? 'Créer un accès' : 'Ouvrir le terminal'}</button>
  </form>
}
