import Link from 'next/link'
import { AuthForm } from '@/components/auth-form'

export default function SignUpPage() {
  return <main className="auth-shell"><section className="auth-card"><div className="brand-mark">GE<span>•</span></div><p className="eyebrow">GOLD EDGE PRO / INSCRIPTION</p><h1>Créez votre accès GoldEdge Pro.</h1><p className="muted">Inscrivez-vous depuis n&apos;importe quel pays pour accéder au terminal XAU/USD.</p><AuthForm mode="sign-up" /><p className="muted text-center">Déjà inscrit ? <Link href="/sign-in" className="link">Se connecter</Link></p></section></main>
}
