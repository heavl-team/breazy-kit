import {
  isForbiddenPropKey,
  LIMITS,
  looksLikeEmail,
  type Device,
  type EventInput,
} from './envelope.js'

/**
 * Server side validation and normalisation of an incoming event.
 *
 * Deliberately forgiving about shape and unforgiving about content. A malformed
 * beacon is dropped silently, because the client never reads the response and a
 * 400 helps nobody. Personal data in a props bag is stripped rather than stored,
 * because minimisation is not something to leave to code review.
 */

export function clamp(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed ? trimmed.slice(0, max) : null
}

export function deviceFromUserAgent(ua: string): Device {
  const s = (ua || '').toLowerCase()
  if (/ipad|tablet|playbook|silk/.test(s)) return 'tablet'
  if (/mobi|iphone|android.*mobile|phone/.test(s)) return 'mobile'
  return 'desktop'
}

/** Host only. Never store a full referrer, which can carry a search query. */
export function referrerHost(referrer: unknown): string | null {
  if (typeof referrer !== 'string' || !referrer) return null
  try {
    return new URL(referrer).host.slice(0, LIMITS.referrerHost) || null
  } catch {
    // Already a bare host, or unparseable. Take it as a host but never as a path.
    return clamp(referrer.split('/')[0], LIMITS.referrerHost)
  }
}

export interface PropsResult {
  readonly props: Record<string, unknown>
  /** Keys removed because they are on the forbidden list or looked like an email. */
  readonly stripped: readonly string[]
}

/**
 * Clean a props bag.
 *
 * Drops any key on the forbidden list, and any value that looks like an email
 * address regardless of its key, because `owner` holding an email is the same
 * leak as `email` holding one. Then caps the serialised size at 2 000 bytes,
 * matching Tsakani.
 */
export function cleanProps(input: unknown): PropsResult {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return { props: {}, stripped: [] }
  }
  const props: Record<string, unknown> = {}
  const stripped: string[] = []

  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (isForbiddenPropKey(key) || looksLikeEmail(value)) {
      stripped.push(key)
      continue
    }
    // Only keep primitives. A nested object is a place for personal data to hide
    // from the key check above.
    if (value === null || ['string', 'number', 'boolean'].includes(typeof value)) {
      props[key] = typeof value === 'string' ? value.slice(0, 200) : value
    } else {
      stripped.push(key)
    }
  }

  let serialised = ''
  try {
    serialised = JSON.stringify(props)
  } catch {
    return { props: {}, stripped }
  }
  if (serialised.length > LIMITS.props) {
    // Drop keys until it fits, rather than storing a truncated and unparseable blob.
    const keys = Object.keys(props)
    while (keys.length && JSON.stringify(props).length > LIMITS.props) {
      const key = keys.pop()
      if (key === undefined) break
      delete props[key]
      stripped.push(key)
    }
  }

  return { props, stripped }
}

export interface NormaliseResult {
  readonly ok: boolean
  readonly event: EventInput | null
  readonly stripped: readonly string[]
  readonly reason?: string
}

/**
 * Normalise a raw payload into an EventInput, or reject it.
 *
 * Never throws. A beacon that cannot be parsed is not an error worth surfacing,
 * it is an event that did not happen.
 */
export function normaliseEvent(payload: unknown, allowedEvents?: readonly string[]): NormaliseResult {
  if (typeof payload !== 'object' || payload === null) {
    return { ok: false, event: null, stripped: [], reason: 'payload is not an object' }
  }
  const raw = payload as Record<string, unknown>

  const event = clamp(raw.event, LIMITS.event)
  if (!event) {
    return { ok: false, event: null, stripped: [], reason: 'missing event name' }
  }
  if (allowedEvents && !allowedEvents.includes(event)) {
    return { ok: false, event: null, stripped: [], reason: `event "${event}" is not in the vocabulary` }
  }

  const app = clamp(raw.app, 32)
  if (!app) {
    return { ok: false, event: null, stripped: [], reason: 'missing app' }
  }

  const anonId = clamp(raw.anonId, LIMITS.anonId)
  const sessionId = clamp(raw.sessionId, LIMITS.sessionId)
  if (!anonId || !sessionId) {
    return { ok: false, event: null, stripped: [], reason: 'missing anonId or sessionId' }
  }

  const consentRaw = (typeof raw.consent === 'object' && raw.consent !== null ? raw.consent : {}) as
    Record<string, unknown>
  const consent = {
    analytics: consentRaw.analytics === true,
    personalisation: consentRaw.personalisation === true,
    cross_product: consentRaw.cross_product === true,
  }

  // No analytics consent means the event should never have been sent. Drop it
  // here too, so a stale client cannot write past a withdrawn decision.
  if (!consent.analytics) {
    return { ok: false, event: null, stripped: [], reason: 'no analytics consent' }
  }

  const occurredAt = typeof raw.occurredAt === 'string' ? raw.occurredAt : ''
  const parsed = occurredAt ? Date.parse(occurredAt) : NaN
  const resolvedOccurredAt = Number.isNaN(parsed) ? new Date().toISOString() : new Date(parsed).toISOString()

  const { props, stripped } = cleanProps(raw.props)

  const normalised: EventInput = {
    app: app as EventInput['app'],
    event,
    surface: clamp(raw.surface, LIMITS.surface) ?? undefined,
    occurredAt: resolvedOccurredAt,
    anonId,
    sessionId,
    path: clamp(raw.path, LIMITS.path) ?? undefined,
    referrerHost: referrerHost(raw.referrer ?? raw.referrerHost) ?? undefined,
    props,
    consent,
  }

  return { ok: true, event: normalised, stripped }
}

/**
 * Whether a stored event may be forwarded to the signal layer.
 *
 * This is the one conditional that separates a defensible design from a fine, so
 * it lives in code rather than in a policy document or a config flag somebody
 * can flip. See projects/DATA-STANDARD.md.
 */
export function mayForward(event: Pick<EventInput, 'consent'>): boolean {
  return event.consent.cross_product === true
}
