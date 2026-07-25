import { describe, expect, it, vi } from 'vitest'
import {
  CONSENT_DENIED,
  CONSENT_PURPOSES,
  createConsentStore,
  isConsentRecord,
  memoryConsent,
  type ConsentRecord,
} from '../src/consent/index.js'

const clock = () => new Date('2026-07-25T10:00:00.000Z')

function store(overrides: Partial<Parameters<typeof createConsentStore>[0]> = {}) {
  return createConsentStore({
    storage: memoryConsent(),
    wordingVersion: 'v1',
    now: clock,
    ...overrides,
  })
}

describe('the denied default', () => {
  it('has every purpose off', () => {
    for (const purpose of CONSENT_PURPOSES) {
      expect(CONSENT_DENIED[purpose]).toBe(false)
    }
  })

  it('reports undecided when nothing is stored', async () => {
    const s = store()
    expect(await s.needsDecision()).toBe(true)
    expect(await s.purposes()).toEqual(CONSENT_DENIED)
    expect(await s.allows('analytics')).toBe(false)
    expect(await s.allows('cross_product')).toBe(false)
  })
})

describe('deciding', () => {
  it('records only what was ticked, and denies the rest', async () => {
    const s = store()
    const record = await s.decide({ analytics: true }, 'banner')

    expect(record.purposes).toEqual({ analytics: true, personalisation: false, cross_product: false })
    expect(record.wordingVersion).toBe('v1')
    expect(record.surface).toBe('banner')
    expect(record.decidedAt).toBe('2026-07-25T10:00:00.000Z')
  })

  it('treats a missing purpose as denied rather than inherited', async () => {
    const s = store()
    await s.decide({ analytics: true, cross_product: true })
    await s.decide({ analytics: true })
    expect(await s.allows('cross_product')).toBe(false)
  })

  it('accepts all and denies all', async () => {
    const s = store()
    await s.acceptAll()
    expect(await s.purposes()).toEqual({ analytics: true, personalisation: true, cross_product: true })
    await s.denyAll()
    expect(await s.purposes()).toEqual(CONSENT_DENIED)
  })

  it('records a denial as a decision, so the banner does not reappear', async () => {
    const s = store()
    await s.denyAll()
    expect(await s.needsDecision()).toBe(false)
  })
})

describe('wording versions', () => {
  it('treats consent under older wording as undecided', async () => {
    const storage = memoryConsent()
    const v1 = createConsentStore({ storage, wordingVersion: 'v1', now: clock })
    await v1.acceptAll()
    expect(await v1.needsDecision()).toBe(false)

    const v2 = createConsentStore({ storage, wordingVersion: 'v2', now: clock })
    expect(await v2.needsDecision()).toBe(true)
    expect(await v2.purposes()).toEqual(CONSENT_DENIED)
  })

  it('refuses to be constructed without a wording version', () => {
    expect(() => createConsentStore({ storage: memoryConsent(), wordingVersion: '' })).toThrow()
  })
})

describe('withdrawal', () => {
  it('clears the record and calls onWithdraw so the anon id can rotate', async () => {
    const onWithdraw = vi.fn()
    const s = store({ onWithdraw })

    await s.acceptAll()
    await s.withdraw()

    expect(onWithdraw).toHaveBeenCalledOnce()
    expect(await s.needsDecision()).toBe(true)
    expect(await s.purposes()).toEqual(CONSENT_DENIED)
  })
})

describe('isConsentRecord', () => {
  it('accepts a well formed record', () => {
    const record: ConsentRecord = {
      purposes: { analytics: true, personalisation: false, cross_product: false },
      decidedAt: '2026-07-25T10:00:00.000Z',
      wordingVersion: 'v1',
      surface: 'banner',
    }
    expect(isConsentRecord(record)).toBe(true)
  })

  it('rejects anything missing the audit fields', () => {
    expect(isConsentRecord(null)).toBe(false)
    expect(isConsentRecord({})).toBe(false)
    expect(isConsentRecord({ purposes: { analytics: true } })).toBe(false)
    expect(
      isConsentRecord({
        purposes: { analytics: true, personalisation: false, cross_product: false },
        decidedAt: '2026-07-25T10:00:00.000Z',
      }),
    ).toBe(false)
  })

  it('rejects the old binary shape, which is what VibesMap stores today', () => {
    expect(isConsentRecord('accepted')).toBe(false)
    expect(isConsentRecord({ consent: 'accepted' })).toBe(false)
  })
})
