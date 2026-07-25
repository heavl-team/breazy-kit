import { describe, expect, it } from 'vitest'
import {
  cleanProps,
  deviceFromUserAgent,
  isForbiddenPropKey,
  LIMITS,
  mayForward,
  normaliseEvent,
  referrerHost,
  SHARED_EVENTS,
} from '../src/events/index.js'

const consented = { analytics: true, personalisation: false, cross_product: false }

function payload(overrides: Record<string, unknown> = {}) {
  return {
    app: 'vibesmap',
    event: 'page_view',
    occurredAt: '2026-07-25T10:00:00.000Z',
    anonId: 'anon-1',
    sessionId: 'sess-1',
    consent: consented,
    ...overrides,
  }
}

describe('the consent gate', () => {
  it('drops an event with no analytics consent, even if the client sent it', () => {
    const result = normaliseEvent(payload({ consent: { analytics: false, personalisation: true, cross_product: true } }))
    expect(result.ok).toBe(false)
    expect(result.reason).toBe('no analytics consent')
  })

  it('drops an event with no consent object at all', () => {
    const result = normaliseEvent(payload({ consent: undefined }))
    expect(result.ok).toBe(false)
  })

  it('only forwards to the signal layer when cross_product is true', () => {
    expect(mayForward({ consent: { analytics: true, personalisation: true, cross_product: false } })).toBe(false)
    expect(mayForward({ consent: { analytics: true, personalisation: false, cross_product: true } })).toBe(true)
  })

  it('never treats a truthy non true value as consent', () => {
    const result = normaliseEvent(payload({ consent: { analytics: 'yes', cross_product: 1 } }))
    expect(result.ok).toBe(false)
  })
})

describe('the vocabulary', () => {
  it('accepts a shared event', () => {
    expect(normaliseEvent(payload(), SHARED_EVENTS).ok).toBe(true)
  })

  it('rejects an event outside the vocabulary, which is how spelling drift is caught', () => {
    const result = normaliseEvent(payload({ event: 'pageview' }), SHARED_EVENTS)
    expect(result.ok).toBe(false)
    expect(result.reason).toContain('not in the vocabulary')
  })

  it('accepts anything when no vocabulary is supplied', () => {
    expect(normaliseEvent(payload({ event: 'venue_opened' })).ok).toBe(true)
  })
})

describe('required fields', () => {
  it('rejects a missing event name', () => {
    expect(normaliseEvent(payload({ event: '' })).ok).toBe(false)
    expect(normaliseEvent(payload({ event: '   ' })).ok).toBe(false)
  })

  it('rejects a missing app', () => {
    expect(normaliseEvent(payload({ app: undefined })).ok).toBe(false)
  })

  it('rejects a missing anon or session id, since unique visitors become uncountable', () => {
    expect(normaliseEvent(payload({ anonId: undefined })).ok).toBe(false)
    expect(normaliseEvent(payload({ sessionId: undefined })).ok).toBe(false)
  })

  it('never throws on rubbish input', () => {
    expect(normaliseEvent(null).ok).toBe(false)
    expect(normaliseEvent('nope').ok).toBe(false)
    expect(normaliseEvent(42).ok).toBe(false)
    expect(normaliseEvent([]).ok).toBe(false)
  })
})

describe('caps', () => {
  it('truncates the event name at 64 characters', () => {
    const result = normaliseEvent(payload({ event: 'a'.repeat(200) }))
    expect(result.event?.event).toHaveLength(LIMITS.event)
  })

  it('truncates the path at 512 characters', () => {
    const result = normaliseEvent(payload({ path: `/${'p'.repeat(900)}` }))
    expect(result.event?.path).toHaveLength(LIMITS.path)
  })
})

describe('occurredAt', () => {
  it('keeps a valid client timestamp, so a queued event keeps its real time', () => {
    const result = normaliseEvent(payload({ occurredAt: '2026-07-01T08:30:00.000Z' }))
    expect(result.event?.occurredAt).toBe('2026-07-01T08:30:00.000Z')
  })

  it('falls back to now when the timestamp is unparseable', () => {
    const result = normaliseEvent(payload({ occurredAt: 'not a date' }))
    expect(result.ok).toBe(true)
    expect(Number.isNaN(Date.parse(result.event!.occurredAt))).toBe(false)
  })
})

describe('referrerHost', () => {
  it('keeps the host and discards the path and query', () => {
    expect(referrerHost('https://www.google.com/search?q=secret+thing')).toBe('www.google.com')
  })

  it('handles a bare host', () => {
    expect(referrerHost('example.com')).toBe('example.com')
  })

  it('never returns a full URL, because a search query is personal', () => {
    const host = referrerHost('https://google.com/search?q=how+to+leave+my+husband')
    expect(host).not.toContain('husband')
    expect(host).not.toContain('?')
  })

  it('returns null for nothing', () => {
    expect(referrerHost(undefined)).toBeNull()
    expect(referrerHost('')).toBeNull()
  })
})

describe('forbidden props', () => {
  it('recognises personal field names in any casing or separator', () => {
    for (const key of ['email', 'Email', 'EMAIL_ADDRESS', 'email-address', 'phoneNumber', 'full_name', 'lat', 'lng']) {
      expect(isForbiddenPropKey(key)).toBe(true)
    }
  })

  it('allows ordinary interaction metadata', () => {
    for (const key of ['venue', 'category', 'position', 'source', 'tier', 'count']) {
      expect(isForbiddenPropKey(key)).toBe(false)
    }
  })

  it('strips a forbidden key from a props bag', () => {
    const { props, stripped } = cleanProps({ venue: 'Zervolis', email: 'a@b.com' })
    expect(props).toEqual({ venue: 'Zervolis' })
    expect(stripped).toContain('email')
  })

  it('strips a value that looks like an email even under an innocent key', () => {
    const { props, stripped } = cleanProps({ owner: 'brendon@example.com', venue: 'Zervolis' })
    expect(props).toEqual({ venue: 'Zervolis' })
    expect(stripped).toContain('owner')
  })

  it('strips nested objects, where personal data hides from the key check', () => {
    const { props, stripped } = cleanProps({ user: { email: 'a@b.com' }, venue: 'Zervolis' })
    expect(props).toEqual({ venue: 'Zervolis' })
    expect(stripped).toContain('user')
  })

  it('caps the serialised size at 2000 bytes', () => {
    const big: Record<string, string> = {}
    for (let i = 0; i < 200; i += 1) big[`key${i}`] = 'x'.repeat(50)
    const { props } = cleanProps(big)
    expect(JSON.stringify(props).length).toBeLessThanOrEqual(LIMITS.props)
  })

  it('survives a props bag that is not an object', () => {
    expect(cleanProps(null).props).toEqual({})
    expect(cleanProps('nope').props).toEqual({})
    expect(cleanProps([1, 2, 3]).props).toEqual({})
  })

  it('strips personal props during a full normalise', () => {
    const result = normaliseEvent(payload({ props: { venue: 'Zervolis', phone: '0748226711' } }))
    expect(result.ok).toBe(true)
    expect(result.event?.props).toEqual({ venue: 'Zervolis' })
    expect(result.stripped).toContain('phone')
  })
})

describe('deviceFromUserAgent', () => {
  it('classifies the three shapes', () => {
    expect(deviceFromUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) Mobile/15E148')).toBe('mobile')
    expect(deviceFromUserAgent('Mozilla/5.0 (iPad; CPU OS 17_0)')).toBe('tablet')
    expect(deviceFromUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64)')).toBe('desktop')
  })

  it('defaults to desktop on a missing user agent rather than throwing', () => {
    expect(deviceFromUserAgent('')).toBe('desktop')
  })
})
