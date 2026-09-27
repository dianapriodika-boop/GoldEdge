import { auth } from '@/lib/auth'
import { headers } from 'next/headers'

export async function requireAuthenticatedAccess() {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) return { ok: false as const, status: 401, reason: 'AUTH_REQUIRED' as const }
  return { ok: true as const, session }
}
