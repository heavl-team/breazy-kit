import type { ConsentState } from '../consent/index.js'

/**
 * The event envelope. One shape, every app.
 *
 * Extended from tsakani-sessions-app/supabase/analytics_events.sql, which
 * already gets the hard parts right: no raw IP, coarse geo, a client generated
 * session id carrying no identity, and hard caps on every field. What is added
 * here is the portfolio wide `app` dimension, occurredAt separate from
 * receivedAt, anonId separate from sessionId, personKey, and consent on the row.
 *
 * See projects/DATA-STANDARD.md.
 */

/** Apps in the portfolio. Closed set, so a typo cannot create a phantom app. */
export const APPS = [
  'vibesmap',
  'tsakani',
  'spanispace',
  'mmcellars',
  'greenmedicalcare',
  'glorydomain',
  'primeclimate',
  'portfolio',
  'breazy',
] as const

export type App = (typeof APPS)[number]

/**
 * Events every app shares. A closed vocabulary, because free text guarantees two
 * apps spell the same behaviour differently and the join silently fails.
 *
 * Tsakani's admin dashboard already scores three conversion events that nothing
 * emits, booking_click, begin_checkout and whatsapp_click, which is exactly the
 * drift this prevents.
 */
export const SHARED_EVENTS = [
  'page_view',
  'session_start',
  'search_performed',
  'filter_applied',
  'item_viewed',
  'item_saved',
  'share_clicked',
  'form_started',
  'form_submitted',
  'form_abandoned',
  'signup_started',
  'signup_completed',
  'signin_completed',
  'contact_clicked',
  'consent_given',
  'consent_withdrawn',
] as const

export type SharedEvent = (typeof SHARED_EVENTS)[number]

/** Field caps, lifted from tsakani-sessions-app/app/api/track/route.ts. */
export const LIMITS = {
  event: 64,
  path: 512,
  referrerHost: 255,
  sessionId: 64,
  anonId: 64,
  surface: 64,
  city: 120,
  region: 120,
  country: 8,
  /** Serialised bytes, not keys. */
  props: 2000,
} as const

export type Device = 'mobile' | 'tablet' | 'desktop'

/** What the client sends. */
export interface EventInput {
  readonly app: App
  readonly event: string
  /** Page or component. Keeps Tsakani's app versus static distinction. */
  readonly surface?: string
  /** ISO 8601, set client side so a queued or offline event keeps its real time. */
  readonly occurredAt: string
  readonly anonId: string
  readonly sessionId: string
  readonly path?: string
  /** Host only. Never the full referrer, which can carry a search query. */
  readonly referrerHost?: string
  readonly props?: Record<string, unknown>
  readonly consent: ConsentState
}

/** What the server stores, after enrichment. */
export interface StoredEvent extends EventInput {
  /** ISO 8601, set server side. The gap between this and occurredAt is itself a signal. */
  readonly receivedAt: string
  /** Null unless the person is signed in and has consented to cross product use. */
  readonly personKey: string | null
  readonly city: string | null
  readonly region: string | null
  readonly country: string | null
  readonly device: Device
}

/**
 * Fields that must never appear in an event or its props.
 *
 * Minimisation is a POPIA condition, not a preference. This list is checked at
 * runtime rather than trusted to review, because the failure is silent: nobody
 * notices an email address in a props bag until somebody exports the table.
 */
export const FORBIDDEN_PROP_KEYS = [
  'email',
  'e_mail',
  'emailaddress',
  'email_address',
  'phone',
  'phonenumber',
  'phone_number',
  'mobile',
  'msisdn',
  'password',
  'token',
  'accesstoken',
  'access_token',
  'apikey',
  'api_key',
  'secret',
  'ip',
  'ipaddress',
  'ip_address',
  'idnumber',
  'id_number',
  'fullname',
  'full_name',
  'firstname',
  'first_name',
  'lastname',
  'last_name',
  'surname',
  'lat',
  'lng',
  'latitude',
  'longitude',
  'coords',
  'cardnumber',
  'card_number',
] as const

const FORBIDDEN = new Set<string>(FORBIDDEN_PROP_KEYS)

/** True when a props key is one we refuse to store. Case and separator insensitive. */
export function isForbiddenPropKey(key: string): boolean {
  const normalised = key.toLowerCase().replace(/[-\s]/g, '_')
  if (FORBIDDEN.has(normalised)) return true
  return FORBIDDEN.has(normalised.replace(/_/g, ''))
}

export function looksLikeEmail(value: unknown): boolean {
  return typeof value === 'string' && /[^\s@]+@[^\s@]+\.[^\s@]{2,}/.test(value)
}
