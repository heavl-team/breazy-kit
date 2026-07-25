/**
 * The security baseline: headers, an origin allowlist, bot defence and a rate
 * limiter that degrades to a no op rather than blocking a request.
 *
 * Every piece here is extracted from something already running:
 *  - the CSRF origin allowlist from vibesmap/web/middleware.ts
 *  - the honeypot and timing check from MM-Order-Form-ED/app/api/order/route.ts
 *  - the degrade to a no op rule from how MM Cellars treats Redis
 *
 * And every default here answers a hole that is live right now in SpaniSpace,
 * which ships no CSP, no X-Frame-Options, no Referrer-Policy and no
 * Permissions-Policy at all.
 */

// ---------------------------------------------------------------------------
// Security headers
// ---------------------------------------------------------------------------

export interface CspOptions {
  /** Extra hosts per directive. Anything not listed is blocked. */
  readonly scriptSrc?: readonly string[]
  readonly styleSrc?: readonly string[]
  readonly imgSrc?: readonly string[]
  readonly connectSrc?: readonly string[]
  readonly fontSrc?: readonly string[]
  readonly frameSrc?: readonly string[]
  /** Next.js needs unsafe-inline for styles, and unsafe-eval in development. */
  readonly allowUnsafeInlineStyles?: boolean
  readonly development?: boolean
}

/**
 * Build a Content Security Policy.
 *
 * Starts closed and opens only what is passed in. Two repos already have a strict
 * CSP, vibesmap in next.config.js and planner with connect-src 'self', and the
 * thing to remember about both is that a missing origin fails silently in
 * production: the script simply never loads and nothing is logged.
 */
export function buildCsp(options: CspOptions = {}): string {
  const self = "'self'"
  const directives: Record<string, string[]> = {
    'default-src': [self],
    'script-src': [self, ...(options.development ? ["'unsafe-eval'"] : []), ...(options.scriptSrc ?? [])],
    'style-src': [
      self,
      ...(options.allowUnsafeInlineStyles === false ? [] : ["'unsafe-inline'"]),
      ...(options.styleSrc ?? []),
    ],
    'img-src': [self, 'data:', 'blob:', ...(options.imgSrc ?? [])],
    'font-src': [self, 'data:', ...(options.fontSrc ?? [])],
    'connect-src': [self, ...(options.connectSrc ?? [])],
    'frame-src': [...(options.frameSrc ?? [])],
    'frame-ancestors': ["'none'"],
    'base-uri': [self],
    'form-action': [self],
    'object-src': ["'none'"],
  }

  return Object.entries(directives)
    .filter(([, values]) => values.length > 0)
    .map(([directive, values]) => `${directive} ${[...new Set(values)].join(' ')}`)
    .join('; ')
}

export interface SecurityHeaderOptions extends CspOptions {
  /** Omit HSTS only when serving over plain HTTP in development. */
  readonly hsts?: boolean
}

/**
 * The header set ship-check verifies. Returns a plain object so it can be spread
 * into a Next.js config, a middleware response, or a Cloudflare Worker.
 */
export function securityHeaders(options: SecurityHeaderOptions = {}): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Security-Policy': buildCsp(options),
    'X-Frame-Options': 'DENY',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=(self), payment=()',
    'Cross-Origin-Opener-Policy': 'same-origin',
  }
  if (options.hsts !== false && !options.development) {
    headers['Strict-Transport-Security'] = 'max-age=63072000; includeSubDomains; preload'
  }
  return headers
}

// ---------------------------------------------------------------------------
// Origin allowlist
// ---------------------------------------------------------------------------

export interface OriginCheckOptions {
  readonly allowed: readonly string[]
  /**
   * Paths exempt from the check. Webhooks belong here because the sender cannot
   * present an allowed Origin. In VibesMap that is /api/auth, /api/scrape and
   * critically /api/payfast/notify, and removing that last exemption breaks
   * payment notifications silently.
   */
  readonly exempt?: readonly string[]
}

/**
 * Is this mutation allowed to proceed?
 *
 * Ported from vibesmap/web/middleware.ts. Applies to mutating methods only, so a
 * curl POST without an allowed Origin gets refused while reads are untouched.
 */
export function isAllowedMutation(
  input: { readonly method: string; readonly origin: string | null; readonly path: string },
  options: OriginCheckOptions,
): boolean {
  const method = input.method.toUpperCase()
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return true
  if (options.exempt?.some((prefix) => input.path.startsWith(prefix))) return true
  if (!input.origin) return false
  return options.allowed.includes(input.origin)
}

// ---------------------------------------------------------------------------
// Bot defence
// ---------------------------------------------------------------------------

export interface BotCheckInput {
  /** The honeypot field's submitted value. Any content means a bot filled it. */
  readonly honeypot?: unknown
  /** Milliseconds between the form rendering and submitting. */
  readonly elapsedMs?: number
}

export interface BotCheckOptions {
  /** Anything faster than this is not a human typing. MM Cellars uses 500. */
  readonly minElapsedMs?: number
}

export type BotVerdict = { readonly bot: false } | { readonly bot: true; readonly signal: string }

/**
 * Honeypot plus timing.
 *
 * Two things learned the hard way in this portfolio. MM Cellars names its
 * honeypot `company` and returns a silent fake success rather than an error, so a
 * bot cannot tell it was caught. And Green Medical Care deliberately does not use
 * the name `company`, because browsers autofill it and real people get dropped.
 * So: keep the silent success, and pick a field name no browser will fill.
 */
export function checkBot(input: BotCheckInput, options: BotCheckOptions = {}): BotVerdict {
  const minElapsedMs = options.minElapsedMs ?? 500

  if (typeof input.honeypot === 'string' && input.honeypot.trim() !== '') {
    return { bot: true, signal: 'honeypot filled' }
  }
  if (typeof input.elapsedMs === 'number' && input.elapsedMs >= 0 && input.elapsedMs < minElapsedMs) {
    return { bot: true, signal: `submitted in ${input.elapsedMs}ms` }
  }
  return { bot: false }
}

/**
 * A honeypot field name unlikely to be autofilled.
 *
 * Avoid company, organisation, address, fax and anything else in a browser's
 * autofill vocabulary.
 */
export const SAFE_HONEYPOT_FIELD = 'referral_window'

// ---------------------------------------------------------------------------
// Rate limiting
// ---------------------------------------------------------------------------

export interface RateLimitOptions {
  /** Requests allowed per window. */
  readonly limit: number
  /** Window length in milliseconds. */
  readonly windowMs: number
  /** Injectable clock for tests. */
  readonly now?: () => number
}

export interface RateLimitResult {
  readonly allowed: boolean
  readonly remaining: number
  readonly resetAt: number
}

export interface RateLimiter {
  check(key: string): RateLimitResult
  reset(key?: string): void
}

/**
 * An in memory fixed window limiter.
 *
 * Per instance and reset on deploy, which is a known limitation rather than a
 * defect. Say so when you use it. It is enough to stop casual abuse of a public
 * write, and it costs nothing, which matters when the alternative is Upstash and
 * the app is pre revenue.
 *
 * It never throws and never blocks on anything external, which is the rule taken
 * from how MM Cellars treats Redis: a broken limiter silently allows the request
 * rather than failing the order.
 */
export function createRateLimiter(options: RateLimitOptions): RateLimiter {
  const { limit, windowMs } = options
  const now = options.now ?? (() => Date.now())
  const buckets = new Map<string, { count: number; resetAt: number }>()

  /** Keep the map from growing without bound in a long lived process. */
  const prune = (currentTime: number): void => {
    if (buckets.size < 10_000) return
    for (const [key, bucket] of buckets) {
      if (bucket.resetAt <= currentTime) buckets.delete(key)
    }
  }

  return {
    check(key: string): RateLimitResult {
      try {
        const currentTime = now()
        prune(currentTime)
        const existing = buckets.get(key)

        if (!existing || existing.resetAt <= currentTime) {
          const resetAt = currentTime + windowMs
          buckets.set(key, { count: 1, resetAt })
          return { allowed: true, remaining: Math.max(0, limit - 1), resetAt }
        }

        existing.count += 1
        return {
          allowed: existing.count <= limit,
          remaining: Math.max(0, limit - existing.count),
          resetAt: existing.resetAt,
        }
      } catch {
        // Degrade to a no op. A broken limiter must never block a real request.
        //
        // Deliberately does not call now() again here. The most likely reason we
        // are in this catch is that the clock itself threw, so calling it a
        // second time would throw straight out of the limiter and block the
        // request, which is the exact failure this branch exists to prevent.
        return { allowed: true, remaining: limit, resetAt: 0 }
      }
    },

    reset(key?: string): void {
      if (key === undefined) buckets.clear()
      else buckets.delete(key)
    },
  }
}
