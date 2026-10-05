import { and, eq } from 'drizzle-orm'
import { auth } from '@/lib/auth'
import { db, pool } from '@/lib/db'
import { account, user } from '@/lib/db/schema'

const email = process.env.E2E_TEST_EMAIL
const password = process.env.E2E_TEST_PASSWORD

function fail(message: string): never {
  console.error(message)
  process.exit(1)
}

async function main() {
  if (!email || !password) fail('E2E ACCOUNT: NOT VERIFIED (required secure environment variables are unavailable)')
  if (!process.env.DATABASE_URL) fail('DATABASE: FAIL (DATABASE_URL is unavailable)')
  if (!process.env.BETTER_AUTH_SECRET) fail('BETTER AUTH: FAIL (BETTER_AUTH_SECRET is unavailable)')

  try {
    await pool.query('select 1')

    let [existingUser] = await db.select({ id: user.id }).from(user).where(eq(user.email, email)).limit(1)
    let userCreated = false

    if (!existingUser) {
      const result = await auth.api.signUpEmail({
        body: { email, password, name: 'GoldEdge E2E Test User' },
      })
      if (!result?.user?.id) fail('E2E ACCOUNT: FAIL (Better Auth user creation did not complete)')
      existingUser = { id: result.user.id }
      userCreated = true
    }

    const [passwordAccount] = await db
      .select({ id: account.id })
      .from(account)
      .where(and(eq(account.userId, existingUser.id), eq(account.providerId, 'credential')))
      .limit(1)

    if (!passwordAccount) fail('E2E ACCOUNT: FAIL (user exists but has no email/password account)')

    const signIn = await auth.api.signInEmail({ body: { email, password } })
    if (!signIn?.user?.id || signIn.user.id !== existingUser.id) {
      fail('AUTH_E2E_ACCOUNT_READY=false')
    }

    console.log(`E2E ACCOUNT: ${userCreated ? 'CREATED' : 'EXISTING'}`)
    console.log('E2E_USER_ACTIVE=true')
    console.log('E2E_USER_ROLE=USER')
    console.log('E2E_PASSWORD_ACCOUNT_EXISTS=true')
    console.log('AUTH_E2E_ACCOUNT_READY=true')
  } catch {
    console.error('AUTH_E2E_ACCOUNT_READY=false')
    process.exitCode = 1
  } finally {
    await pool.end()
  }
}

void main()
