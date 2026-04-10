// Shared authentication helpers for API routes
// - requireAuth: Bearer CRON_SECRET — used by mutating/cron POST endpoints
// - requireReadAuth: accepts EITHER CRON_SECRET or NEXT_PUBLIC_INTERNAL_API_KEY —
//   used to gate GET endpoints that serve IP-sensitive payloads to the
//   Kardashev frontend. The NEXT_PUBLIC_* key is deliberately low-privilege:
//   it is baked into the client bundle and is only meant as a gate against
//   casual public scraping, not as a real secret. High-privilege mutations
//   MUST continue to use requireAuth() with CRON_SECRET.

import type { NextApiRequest } from 'next'

/**
 * Verify that the request carries a valid Bearer token matching CRON_SECRET.
 * Fails closed: returns false when CRON_SECRET is not configured.
 */
export function requireAuth(req: NextApiRequest): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return false // Fail closed in production
  return req.headers.authorization === `Bearer ${secret}`
}

/**
 * Verify that the request carries a valid Bearer token for a read-only
 * IP-sensitive GET endpoint. Accepts either:
 *   - CRON_SECRET (so server-to-server / curl debugging keeps working)
 *   - NEXT_PUBLIC_INTERNAL_API_KEY (so the Next.js client bundle can call it)
 *
 * Fails closed: returns false when NEITHER secret is configured. This means
 * a misconfigured deploy will return 401 on every call rather than silently
 * opening the endpoint to the public.
 */
export function requireReadAuth(req: NextApiRequest): boolean {
  const cronSecret = process.env.CRON_SECRET
  const internalKey = process.env.NEXT_PUBLIC_INTERNAL_API_KEY
  if (!cronSecret && !internalKey) return false // Fail closed
  const auth = req.headers.authorization
  if (!auth) return false
  if (cronSecret && auth === `Bearer ${cronSecret}`) return true
  if (internalKey && auth === `Bearer ${internalKey}`) return true
  return false
}
