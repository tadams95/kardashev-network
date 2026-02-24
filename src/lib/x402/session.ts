import type { NextApiRequest, NextApiResponse } from 'next'
import { randomUUID, createHmac } from 'crypto'
import { rdel, rget, rset, rsetnx } from '@/lib/cache/redis'

const SESSION_DURATION_MS = 30 * 60 * 1000
const SESSION_TTL_S = 1800
const SESSION_BY_ID_PREFIX = 'session:id:'
const SESSION_BY_WALLET_PREFIX = 'session:wallet:'
const SESSION_COOKIE_NAME = 'kn_session'
const SESSION_HEADER = 'x-session-token'
const REPLAY_LOCK_TTL_S = 300
const REPLAY_USED_TTL_S = 7 * 24 * 60 * 60

const isProd = process.env.NODE_ENV === 'production'
const SESSION_SECRET = process.env.X402_SESSION_SECRET || process.env.CRON_SECRET || (isProd ? '' : 'dev-insecure-session-secret')

if (isProd && !SESSION_SECRET) {
  throw new Error('FATAL: X402_SESSION_SECRET (or CRON_SECRET) must be set in production')
}

export interface X402SessionRecord {
  sessionId: string
  payer: string
  network: string
  txHash: string
  createdAt: number
  expires: number
}

const l1BySessionId = new Map<string, X402SessionRecord>()
const l1ByWallet = new Map<string, string>()

function isSvmNetwork(network: string): boolean {
  return network.startsWith('solana')
}

function normalizeWallet(address: string, network?: string): string {
  if (network && isSvmNetwork(network)) return address
  if (!address.startsWith('0x')) return address
  return address.toLowerCase()
}

function base64url(input: string): string {
  return Buffer.from(input, 'utf8').toString('base64url')
}

function sign(input: string): string {
  return createHmac('sha256', SESSION_SECRET).update(input).digest('base64url')
}

function createToken(sessionId: string, expires: number): string {
  const payloadJson = JSON.stringify({ sid: sessionId, exp: expires })
  const payload = base64url(payloadJson)
  const sig = sign(payload)
  return `${payload}.${sig}`
}

function parseToken(token: string): { sid: string; exp: number } | null {
  const [payload, signature] = token.split('.')
  if (!payload || !signature) return null

  if (sign(payload) !== signature) return null

  try {
    const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))
    if (typeof decoded.sid !== 'string' || typeof decoded.exp !== 'number') return null
    if (Date.now() > decoded.exp) return null
    return { sid: decoded.sid, exp: decoded.exp }
  } catch {
    return null
  }
}

function parseCookie(req: NextApiRequest, name: string): string | null {
  const header = req.headers.cookie
  if (!header) return null

  for (const part of header.split(';')) {
    const [k, ...rest] = part.trim().split('=')
    if (k === name) return decodeURIComponent(rest.join('='))
  }
  return null
}

function getHeaderToken(req: NextApiRequest): string | null {
  const raw = req.headers[SESSION_HEADER]
  if (Array.isArray(raw)) return raw[0] || null
  return raw || null
}

function cleanL1Expired(): void {
  const now = Date.now()
  for (const [sessionId, session] of l1BySessionId.entries()) {
    if (now > session.expires) {
      l1BySessionId.delete(sessionId)
    }
  }
}

export async function createX402Session(input: {
  payer: string
  network: string
  txHash: string
}): Promise<{ token: string; session: X402SessionRecord }> {
  cleanL1Expired()

  const session: X402SessionRecord = {
    sessionId: randomUUID(),
    payer: input.payer,
    network: input.network,
    txHash: input.txHash,
    createdAt: Date.now(),
    expires: Date.now() + SESSION_DURATION_MS,
  }

  const walletKey = normalizeWallet(session.payer, session.network)

  l1BySessionId.set(session.sessionId, session)
  l1ByWallet.set(walletKey, session.sessionId)

  await rset(SESSION_BY_ID_PREFIX + session.sessionId, session, SESSION_TTL_S)
  await rset(SESSION_BY_WALLET_PREFIX + walletKey, { sessionId: session.sessionId }, SESSION_TTL_S)

  return { token: createToken(session.sessionId, session.expires), session }
}

export async function getSessionFromToken(token: string): Promise<X402SessionRecord | null> {
  cleanL1Expired()

  const parsed = parseToken(token)
  if (!parsed) return null

  const l1 = l1BySessionId.get(parsed.sid)
  if (l1 && Date.now() < l1.expires) {
    return l1
  }

  const session = await rget<X402SessionRecord>(SESSION_BY_ID_PREFIX + parsed.sid)
  if (!session || Date.now() > session.expires) return null

  l1BySessionId.set(session.sessionId, session)
  l1ByWallet.set(normalizeWallet(session.payer, session.network), session.sessionId)
  return session
}

export async function getSessionFromWallet(address: string, networkHint?: string): Promise<{ session: X402SessionRecord; token: string } | null> {
  cleanL1Expired()

  const walletKey = normalizeWallet(address, networkHint)
  const sessionId = l1ByWallet.get(walletKey) || (await rget<{ sessionId: string }>(SESSION_BY_WALLET_PREFIX + walletKey))?.sessionId
  if (!sessionId) return null

  const session = l1BySessionId.get(sessionId) || await rget<X402SessionRecord>(SESSION_BY_ID_PREFIX + sessionId)
  if (!session || Date.now() > session.expires) {
    l1ByWallet.delete(walletKey)
    await rdel(SESSION_BY_WALLET_PREFIX + walletKey)
    return null
  }

  l1BySessionId.set(session.sessionId, session)
  l1ByWallet.set(walletKey, session.sessionId)

  return {
    session,
    token: createToken(session.sessionId, session.expires),
  }
}

export function getRequestSessionToken(req: NextApiRequest): string | null {
  return getHeaderToken(req) || parseCookie(req, SESSION_COOKIE_NAME)
}

export function setSessionResponse(res: NextApiResponse, token: string): void {
  res.setHeader('X-SESSION-TOKEN', token)
  const secure = isProd ? '; Secure' : ''
  res.setHeader('Set-Cookie', `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}; Max-Age=${SESSION_TTL_S}; Path=/; HttpOnly; SameSite=Lax${secure}`)
}

export async function acquirePaymentReplayLock(paymentHash: string): Promise<boolean> {
  return rsetnx(`replay:lock:${paymentHash}`, { createdAt: Date.now() }, REPLAY_LOCK_TTL_S)
}

export async function releasePaymentReplayLock(paymentHash: string): Promise<void> {
  await rdel(`replay:lock:${paymentHash}`)
}

export async function markPaymentConsumed(network: string, transaction: string): Promise<boolean> {
  return rsetnx(`replay:used:${network}:${transaction}`, { consumedAt: Date.now() }, REPLAY_USED_TTL_S)
}
