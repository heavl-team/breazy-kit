import type { ConsentState } from '../consent/index.js'
import { LIMITS, type App } from './envelope.js'

/**
 * The client tracker. The single write path for behavioural data.
 *
 * Ported from tsakani-sessions-app/lib/analytics.ts, which already honours Do
 * Not Track, carries a kill switch, and uses sendBeacon with a fetch keepalive
 * fallback so an event survives the page unloading. What is added: a stable
 * anonId separate from the session, a 30 minute idle session reset, occurredAt
 * set here rather than on the server, and a consent gate that runs before
 * anything is sent.
 */

export interface TrackerOptions {
  readonly app: App
  /** Where events are posted. The app's own ingest, never another app's. */
  readonly endpoint: string
  /** Read current consent. Called on every track, so a withdrawal takes effect immediately. */
  readonly getConsent: () => ConsentState
  /** Closed vocabulary. An event outside it is dropped and warned about in development. */
  readonly vocabulary?: readonly string[]
  /** Set false to disable entirely, for example from an env var. */
  readonly enabled?: boolean
  /** Storage keys, overridable per app so two apps on one domain do not collide. */
  readonly anonIdKey?: string
  readonly sessionKey?: string
  /** Idle milliseconds before a new session starts. Default 30 minutes. */
  readonly sessionIdleMs?: number
}

export interface Tracker {
  track(event: string, props?: Record<string, unknown>): void
  /** The current anonymous id, creating one if needed. Null when storage is unavailable. */
  anonId(): string | null
  /** Rotate the anonymous id. Call on consent withdrawal so the old trail cannot be tied to the new one. */
  rotateAnonId(): void
  /** True when nothing will be sent, and why. Useful in a debug panel. */
  status(): { sending: boolean; reason?: string }
}

const DEFAULT_IDLE_MS = 30 * 60 * 1000

function hasStorage(): boolean {
  try {
    return typeof localStorage !== 'undefined'
  } catch {
    // Safari private mode throws on access.
    return false
  }
}

function randomId(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID()
    }
  } catch {
    /* fall through */
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

/**
 * Do Not Track.
 *
 * Honoured because Tsakani already honours it and removing a privacy control
 * while writing a privacy standard would be indefensible.
 */
function doNotTrack(): boolean {
  if (typeof navigator === 'undefined') return false
  const nav = navigator as Navigator & { msDoNotTrack?: string }
  const win = typeof window !== 'undefined' ? (window as Window & { doNotTrack?: string }) : undefined
  const signals = [nav.doNotTrack, nav.msDoNotTrack, win?.doNotTrack]
  return signals.some((s) => s === '1' || s === 'yes')
}

export function createTracker(options: TrackerOptions): Tracker {
  const {
    app,
    endpoint,
    getConsent,
    vocabulary,
    enabled = true,
    anonIdKey = `breazy_anon_${app}`,
    sessionKey = `breazy_session_${app}`,
    sessionIdleMs = DEFAULT_IDLE_MS,
  } = options

  function readAnonId(): string | null {
    if (!hasStorage()) return null
    try {
      let id = localStorage.getItem(anonIdKey)
      if (!id) {
        id = randomId().slice(0, LIMITS.anonId)
        localStorage.setItem(anonIdKey, id)
      }
      return id
    } catch {
      return null
    }
  }

  function readSessionId(): string | null {
    if (!hasStorage()) return null
    try {
      const raw = localStorage.getItem(sessionKey)
      const now = Date.now()
      if (raw) {
        const parsed = JSON.parse(raw) as { id?: string; last?: number }
        if (parsed.id && typeof parsed.last === 'number' && now - parsed.last < sessionIdleMs) {
          localStorage.setItem(sessionKey, JSON.stringify({ id: parsed.id, last: now }))
          return parsed.id
        }
      }
      const id = randomId().slice(0, LIMITS.sessionId)
      localStorage.setItem(sessionKey, JSON.stringify({ id, last: now }))
      return id
    } catch {
      return null
    }
  }

  function status(): { sending: boolean; reason?: string } {
    if (!enabled) return { sending: false, reason: 'disabled' }
    if (typeof window === 'undefined') return { sending: false, reason: 'not in a browser' }
    if (doNotTrack()) return { sending: false, reason: 'do not track' }
    if (!getConsent().analytics) return { sending: false, reason: 'no analytics consent' }
    if (!hasStorage()) return { sending: false, reason: 'no storage for an anonymous id' }
    return { sending: true }
  }

  function send(body: string): void {
    try {
      // text/plain is a CORS safelisted content type, so sendBeacon works without
      // a preflight it cannot perform. The ingest parses content type agnostically.
      const blob = new Blob([body], { type: 'text/plain;charset=UTF-8' })
      if (typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
        if (navigator.sendBeacon(endpoint, blob)) return
      }
      void fetch(endpoint, {
        method: 'POST',
        body,
        keepalive: true,
        headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
      }).catch(() => {
        // Fire and forget. A dropped event is not worth an error in the console.
      })
    } catch {
      /* nothing to do */
    }
  }

  return {
    anonId: readAnonId,

    rotateAnonId() {
      if (!hasStorage()) return
      try {
        localStorage.removeItem(anonIdKey)
        localStorage.removeItem(sessionKey)
      } catch {
        /* nothing to do */
      }
    },

    status,

    track(event: string, props?: Record<string, unknown>) {
      const state = status()
      if (!state.sending) return

      if (vocabulary && !vocabulary.includes(event)) {
        if (typeof process !== 'undefined' && process.env?.NODE_ENV !== 'production') {
          console.warn(
            `[breazy/events] "${event}" is not in the vocabulary and was dropped. Add it deliberately rather than by typo.`,
          )
        }
        return
      }

      const anonId = readAnonId()
      const sessionId = readSessionId()
      if (!anonId || !sessionId) return

      const body = JSON.stringify({
        app,
        event,
        occurredAt: new Date().toISOString(),
        anonId,
        sessionId,
        path: typeof location !== 'undefined' ? location.pathname.slice(0, LIMITS.path) : undefined,
        referrer: typeof document !== 'undefined' && document.referrer ? document.referrer : undefined,
        props: props ?? {},
        consent: getConsent(),
      })

      send(body)
    },
  }
}
