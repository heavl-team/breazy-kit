import { describe, expect, it } from 'vitest'
import {
  buildCsp,
  checkBot,
  createRateLimiter,
  isAllowedMutation,
  SAFE_HONEYPOT_FIELD,
  securityHeaders,
} from '../src/guard/index.js'

describe('securityHeaders', () => {
  it('ships every header ship-check verifies, which SpaniSpace currently has none of', () => {
    const headers = securityHeaders()
    for (const name of [
      'Content-Security-Policy',
      'X-Frame-Options',
      'X-Content-Type-Options',
      'Referrer-Policy',
      'Permissions-Policy',
      'Strict-Transport-Security',
    ]) {
      expect(headers[name], name).toBeTruthy()
    }
  })

  it('omits HSTS in development, where the site is served over plain HTTP', () => {
    expect(securityHeaders({ development: true })['Strict-Transport-Security']).toBeUndefined()
  })
})

describe('buildCsp', () => {
  it('starts closed', () => {
    const csp = buildCsp()
    expect(csp).toContain("default-src 'self'")
    expect(csp).toContain("object-src 'none'")
    expect(csp).toContain("frame-ancestors 'none'")
  })

  it('opens only what is passed in', () => {
    const csp = buildCsp({ connectSrc: ['https://api.example.com'] })
    expect(csp).toContain("connect-src 'self' https://api.example.com")
    expect(csp).not.toContain('https://evil.example.com')
  })

  it('adds unsafe-eval only in development', () => {
    expect(buildCsp({ development: true })).toContain("'unsafe-eval'")
    expect(buildCsp()).not.toContain("'unsafe-eval'")
  })

  it('does not repeat a host that is already present', () => {
    const csp = buildCsp({ connectSrc: ["'self'", "'self'"] })
    expect(csp.match(/'self'/g)?.length).toBeGreaterThan(0)
    expect(csp).toContain("connect-src 'self'")
    expect(csp).not.toContain("connect-src 'self' 'self'")
  })
})

describe('isAllowedMutation', () => {
  const options = { allowed: ['https://vibesmap.co.za'], exempt: ['/api/payfast/notify', '/api/auth'] }

  it('allows reads regardless of origin', () => {
    expect(isAllowedMutation({ method: 'GET', origin: null, path: '/anything' }, options)).toBe(true)
    expect(isAllowedMutation({ method: 'HEAD', origin: 'https://evil.com', path: '/x' }, options)).toBe(true)
  })

  it('allows a mutation from an allowed origin', () => {
    expect(
      isAllowedMutation({ method: 'POST', origin: 'https://vibesmap.co.za', path: '/api/x' }, options),
    ).toBe(true)
  })

  it('refuses a mutation with no origin, which is a curl POST', () => {
    expect(isAllowedMutation({ method: 'POST', origin: null, path: '/api/x' }, options)).toBe(false)
  })

  it('refuses a mutation from an unlisted origin', () => {
    expect(isAllowedMutation({ method: 'POST', origin: 'https://evil.com', path: '/api/x' }, options)).toBe(false)
  })

  it('exempts webhook paths, because the sender cannot present an allowed origin', () => {
    expect(
      isAllowedMutation({ method: 'POST', origin: null, path: '/api/payfast/notify' }, options),
    ).toBe(true)
  })

  it('does not exempt a path that merely looks similar', () => {
    expect(
      isAllowedMutation({ method: 'POST', origin: null, path: '/api/payfast-notify-fake' }, options),
    ).toBe(false)
  })
})

describe('checkBot', () => {
  it('catches a filled honeypot', () => {
    const verdict = checkBot({ honeypot: 'Acme Ltd' })
    expect(verdict.bot).toBe(true)
  })

  it('lets an empty honeypot through', () => {
    expect(checkBot({ honeypot: '' }).bot).toBe(false)
    expect(checkBot({ honeypot: '   ' }).bot).toBe(false)
    expect(checkBot({}).bot).toBe(false)
  })

  it('catches a submission faster than a human can type', () => {
    expect(checkBot({ elapsedMs: 120 }).bot).toBe(true)
  })

  it('lets a human paced submission through', () => {
    expect(checkBot({ elapsedMs: 4000 }).bot).toBe(false)
  })

  it('does not treat a missing timing as a bot, since the field may not have rendered', () => {
    expect(checkBot({}).bot).toBe(false)
  })

  it('uses a honeypot field name browsers do not autofill', () => {
    // Green Medical Care deliberately avoids "company" because autofill drops real users.
    expect(SAFE_HONEYPOT_FIELD).not.toBe('company')
    expect(['company', 'organisation', 'organization', 'address', 'fax']).not.toContain(SAFE_HONEYPOT_FIELD)
  })
})

describe('createRateLimiter', () => {
  it('allows up to the limit then refuses', () => {
    let time = 0
    const limiter = createRateLimiter({ limit: 3, windowMs: 1000, now: () => time })

    expect(limiter.check('ip-1').allowed).toBe(true)
    expect(limiter.check('ip-1').allowed).toBe(true)
    expect(limiter.check('ip-1').allowed).toBe(true)
    expect(limiter.check('ip-1').allowed).toBe(false)
  })

  it('counts each key separately', () => {
    let time = 0
    const limiter = createRateLimiter({ limit: 1, windowMs: 1000, now: () => time })
    expect(limiter.check('ip-1').allowed).toBe(true)
    expect(limiter.check('ip-2').allowed).toBe(true)
    expect(limiter.check('ip-1').allowed).toBe(false)
  })

  it('resets after the window passes', () => {
    let time = 0
    const limiter = createRateLimiter({ limit: 1, windowMs: 1000, now: () => time })
    expect(limiter.check('ip-1').allowed).toBe(true)
    expect(limiter.check('ip-1').allowed).toBe(false)
    time = 1001
    expect(limiter.check('ip-1').allowed).toBe(true)
  })

  it('reports remaining and resetAt', () => {
    let time = 500
    const limiter = createRateLimiter({ limit: 2, windowMs: 1000, now: () => time })
    const first = limiter.check('ip-1')
    expect(first.remaining).toBe(1)
    expect(first.resetAt).toBe(1500)
  })

  it('can be reset per key and wholesale', () => {
    let time = 0
    const limiter = createRateLimiter({ limit: 1, windowMs: 1000, now: () => time })
    limiter.check('ip-1')
    limiter.reset('ip-1')
    expect(limiter.check('ip-1').allowed).toBe(true)
    limiter.check('ip-1')
    limiter.reset()
    expect(limiter.check('ip-1').allowed).toBe(true)
  })

  it('degrades to allowing the request if the clock throws, never blocking a real order', () => {
    const limiter = createRateLimiter({
      limit: 1,
      windowMs: 1000,
      now: () => {
        throw new Error('clock broken')
      },
    })
    expect(limiter.check('ip-1').allowed).toBe(true)
  })
})
