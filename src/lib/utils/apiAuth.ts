// Shared authentication helper for mutating API routes
// Requires CRON_SECRET bearer token for POST endpoints

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
