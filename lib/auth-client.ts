'use client'

import { createAuthClient } from 'better-auth/react'

export const authClient = createAuthClient({
  // Pin browser auth calls to the current preview/deployment origin. This avoids
  // Better Auth resolving requests against a stale canonical URL inside v0's iframe.
  baseURL: typeof window === 'undefined' ? undefined : window.location.origin,
  fetchOptions: {
    credentials: 'include',
  },
})
export const { signIn, signUp, signOut, useSession } = authClient
