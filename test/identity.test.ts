import { describe, expect, it } from 'vitest'
import {
  IdentityError,
  MIN_PEPPER_LENGTH,
  normaliseEmail,
  pepperFromEnv,
  personKey,
  personKeyEquals,
} from '../src/identity/index.js'

const PEPPER = 'a'.repeat(MIN_PEPPER_LENGTH)
const OTHER_PEPPER = 'b'.repeat(MIN_PEPPER_LENGTH)

describe('normaliseEmail', () => {
  it('trims and lowercases', () => {
    expect(normaliseEmail('  Brendon@Example.CO.ZA \n')).toBe('brendon@example.co.za')
  })

  it('does not strip plus addressing or dots, because over normalising merges different people', () => {
    expect(normaliseEmail('a.b+tag@gmail.com')).toBe('a.b+tag@gmail.com')
    expect(normaliseEmail('a.b+tag@gmail.com')).not.toBe(normaliseEmail('ab@gmail.com'))
  })

  it('rejects empty and malformed input', () => {
    expect(() => normaliseEmail('   ')).toThrow(IdentityError)
    expect(() => normaliseEmail('not-an-email')).toThrow(IdentityError)
    // @ts-expect-error deliberately wrong type
    expect(() => normaliseEmail(null)).toThrow(IdentityError)
  })
})

describe('personKey', () => {
  it('is deterministic for the same email and pepper', () => {
    expect(personKey('brendon@example.com', PEPPER)).toBe(personKey('brendon@example.com', PEPPER))
  })

  it('ignores case and surrounding whitespace', () => {
    expect(personKey(' Brendon@Example.com ', PEPPER)).toBe(personKey('brendon@example.com', PEPPER))
  })

  it('returns 64 hex characters', () => {
    expect(personKey('brendon@example.com', PEPPER)).toMatch(/^[0-9a-f]{64}$/)
  })

  it('gives different keys for different emails', () => {
    expect(personKey('a@example.com', PEPPER)).not.toBe(personKey('b@example.com', PEPPER))
  })

  it('gives different keys under a different pepper, so environments never collide', () => {
    expect(personKey('a@example.com', PEPPER)).not.toBe(personKey('a@example.com', OTHER_PEPPER))
  })

  it('is one way, meaning the email does not appear in the key', () => {
    const key = personKey('brendon@example.com', PEPPER)
    expect(key).not.toContain('brendon')
    expect(key).not.toContain('example')
  })

  it('refuses a pepper that is too short to resist brute force', () => {
    expect(() => personKey('a@example.com', 'short')).toThrow(IdentityError)
    expect(() => personKey('a@example.com', 'a'.repeat(MIN_PEPPER_LENGTH - 1))).toThrow(IdentityError)
  })

  it('refuses a missing pepper rather than defaulting to one', () => {
    // @ts-expect-error deliberately wrong type
    expect(() => personKey('a@example.com', undefined)).toThrow(IdentityError)
    expect(() => personKey('a@example.com', '')).toThrow(IdentityError)
  })
})

describe('pepperFromEnv', () => {
  it('reads a valid pepper', () => {
    process.env.TEST_PEPPER_OK = PEPPER
    expect(pepperFromEnv('TEST_PEPPER_OK')).toBe(PEPPER)
    delete process.env.TEST_PEPPER_OK
  })

  it('throws when unset rather than silently using a default', () => {
    delete process.env.TEST_PEPPER_MISSING
    expect(() => pepperFromEnv('TEST_PEPPER_MISSING')).toThrow(IdentityError)
  })

  it('throws when set but too short', () => {
    process.env.TEST_PEPPER_SHORT = 'too-short'
    expect(() => pepperFromEnv('TEST_PEPPER_SHORT')).toThrow(IdentityError)
    delete process.env.TEST_PEPPER_SHORT
  })
})

describe('personKeyEquals', () => {
  it('matches identical keys', () => {
    const key = personKey('a@example.com', PEPPER)
    expect(personKeyEquals(key, key)).toBe(true)
  })

  it('rejects different keys', () => {
    expect(
      personKeyEquals(personKey('a@example.com', PEPPER), personKey('b@example.com', PEPPER)),
    ).toBe(false)
  })

  it('rejects different lengths without throwing', () => {
    expect(personKeyEquals('abc', 'abcd')).toBe(false)
  })

  it('rejects non strings without throwing', () => {
    // @ts-expect-error deliberately wrong type
    expect(personKeyEquals(null, 'abc')).toBe(false)
  })
})
