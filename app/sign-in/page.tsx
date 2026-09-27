import Link from 'next/link'
import { AuthForm } from '@/components/auth-form'

export default function SignInPage() {
  return <main className="auth-shell"><section className="auth-card"><div className="brand-mark">GE<span>•</span></div><p className="eyebrow">GOLD EDGE PRO / ACCÈS SÉCURISÉ</p><h1>Votre terminal XAU/USD.</h1><p className="muted">Connexion requise pour accéder aux signaux institutionnels.</p><AuthForm mode="sign-in" /><p className="muted text-center">Pas encore de compte ? <Link href="/sign-up" className="link">Créer un accès</Link></p></section></main>
}
