import { createHmac, timingSafeEqual } from 'node:crypto'

/**
 * The pseudonymous cross product key.
 *
 * person_key = HMAC_SHA256(pepper, lowercase(trim(email)))
 *
 * This is the mechanism that lets two apps discover they are looking at the
 * same human without either one holding the other's user table, and without the
 * signal layer ever storing an email address. The key is one way: if the signal
 * layer leaked, it would contain no contact detail for anybody.
 *
 * SERVER ONLY. A client that can compute a person key can enumerate keys for
 * any email address it guesses, which would turn a privacy control into an
 * oracle. This module throws if it is loaded in a browser.
 *
 * See projects/DATA-STANDARD.md. Two rules that live outside this file and
 * matter as much as the code:
 *
 *  1. The link is opted into per app, not derived once. Computing a key the
 *     moment somebody signs in would be a silent join on email, which is the
 *     thing POPIA actually prohibits. Only call this after that app has a
 *     recorded cross_product consent for this person.
 *  2. One pepper per environment. Development must never share production's, so
 *     that development data can never be joined to real people.
 */

/** Minimum pepper length. A short pepper is brute forceable given a known email. */
export const MIN_PEPPER_LENGTH = 32

const isBrowser = typeof window !== 'undefined' && typeof window.document !== 'undefined'

export class IdentityError extends Error {
  override readonly name = 'IdentityError'
}

/**
 * Normalise an email address for keying.
 *
 * Deliberately conservative: trim and lowercase, nothing more. It is tempting
 * to strip Gmail dots and plus addressing so that a.b+x@gmail.com keys the same
 * as ab@gmail.com, and that is exactly the temptation to resist. Over
 * normalising merges people who are not the same person, and a wrong join in a
 * behavioural model is worse than a missed one: a missed join loses a signal, a
 * wrong join shows one person another person's recommendations.
 */
export function normaliseEmail(email: string): string {
  if (typeof email !== 'string') {
    throw new IdentityError('email must be a string')
  }
  const normalised = email.trim().toLowerCase()
  if (!normalised) {
    throw new IdentityError('email must not be empty')
  }
  if (!normalised.includes('@')) {
    throw new IdentityError('email must contain @')
  }
  return normalised
}

/**
 * Derive the person key. Returns lowercase hex.
 *
 * @throws IdentityError if called in a browser, or if the pepper is missing or
 *         shorter than MIN_PEPPER_LENGTH.
 */
export function personKey(email: string, pepper: string): string {
  if (isBrowser) {
    throw new IdentityError(
      'personKey is server only. Computing it in a browser lets anyone enumerate keys for any email.',
    )
  }
  if (typeof pepper !== 'string' || pepper.length < MIN_PEPPER_LENGTH) {
    throw new IdentityError(
      `pepper must be a string of at least ${MIN_PEPPER_LENGTH} characters. Got ${
        typeof pepper === 'string' ? `${pepper.length} characters` : typeof pepper
      }.`,
    )
  }
  return createHmac('sha256', pepper).update(normaliseEmail(email)).digest('hex')
}

/**
 * Read the pepper from the environment.
 *
 * Kept as its own function so that a missing pepper fails loudly at the call
 * site rather than silently producing keys under an empty string, which would
 * make every app's keys identical and every join wrong.
 */
export function pepperFromEnv(varName = 'BREAZY_IDENTITY_PEPPER'): string {
  const value = process.env[varName]
  if (!value) {
    throw new IdentityError(
      `${varName} is not set. Cross product identity cannot be derived without it, and falling back to a default would make every environment's keys collide.`,
    )
  }
  if (value.length < MIN_PEPPER_LENGTH) {
    throw new IdentityError(
      `${varName} is shorter than ${MIN_PEPPER_LENGTH} characters.`,
    )
  }
  return value
}

/**
 * Constant time comparison of two person keys.
 *
 * Use this rather than === anywhere a key is compared against one supplied from
 * outside, so that timing cannot be used to discover a key byte by byte.
 */
export function personKeyEquals(a: string, b: string): boolean {
  if (typeof a !== 'string' || typeof b !== 'string') return false
  const bufA = Buffer.from(a, 'utf8')
  const bufB = Buffer.from(b, 'utf8')
  if (bufA.length !== bufB.length) return false
  return timingSafeEqual(bufA, bufB)
}
