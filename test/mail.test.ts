import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import {
  assertDelivered,
  createMailer,
  deliveredOr,
  MailNotDeliveredError,
  type MailProvider,
} from '../src/mail/index.js'

function provider(response: unknown): MailProvider {
  return { emails: { send: vi.fn().mockResolvedValue(response) } } as unknown as MailProvider
}

const base = { to: 'owner@example.com', subject: 'New booking', text: 'Details' }

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('the rule that matters: never claim success without evidence', () => {
  it('reports delivered only when the provider returns an id', async () => {
    const mailer = createMailer({ provider: provider({ data: { id: 'msg_1' } }), from: 'a@b.com' })
    const result = await mailer.send(base)
    expect(result).toEqual({ delivered: true, id: 'msg_1' })
  })

  it('does NOT report delivered when the provider returns no error and no id', async () => {
    const mailer = createMailer({ provider: provider({ data: null }), from: 'a@b.com' })
    const result = await mailer.send(base)
    expect(result.delivered).toBe(false)
    if (!result.delivered) expect(result.reason).toContain('no id')
  })

  it('does not report delivered when the provider rejects the send', async () => {
    const mailer = createMailer({
      provider: provider({ error: { message: 'domain not verified' } }),
      from: 'a@b.com',
    })
    const result = await mailer.send(base)
    expect(result.delivered).toBe(false)
    if (!result.delivered) expect(result.reason).toBe('domain not verified')
  })

  it('does not report delivered when there is no provider at all', async () => {
    const mailer = createMailer({ provider: null, from: 'a@b.com' })
    expect(mailer.configured).toBe(false)
    const result = await mailer.send(base)
    expect(result.delivered).toBe(false)
    if (!result.delivered) expect(result.reason).toContain('no mail provider')
  })

  it('does not report delivered when there is no recipient', async () => {
    const mailer = createMailer({ provider: provider({ data: { id: 'x' } }), from: 'a@b.com' })
    const result = await mailer.send({ ...base, to: [] })
    expect(result.delivered).toBe(false)
  })
})

describe('never throwing, so a provider outage cannot 500 a form', () => {
  it('returns a failure when the provider throws', async () => {
    const throwing = { emails: { send: vi.fn().mockRejectedValue(new Error('network down')) } } as unknown as MailProvider
    const mailer = createMailer({ provider: throwing, from: 'a@b.com' })
    const result = await mailer.send(base)
    expect(result.delivered).toBe(false)
    if (!result.delivered) expect(result.reason).toBe('network down')
  })

  it('returns a failure when the provider throws a non Error', async () => {
    const throwing = { emails: { send: vi.fn().mockRejectedValue('nope') } } as unknown as MailProvider
    const mailer = createMailer({ provider: throwing, from: 'a@b.com' })
    await expect(mailer.send(base)).resolves.toMatchObject({ delivered: false })
  })
})

describe('failure is observable', () => {
  it('calls onFailure so a silent outage can reach Sentry', async () => {
    const onFailure = vi.fn()
    const mailer = createMailer({ provider: null, from: 'a@b.com', onFailure })
    await mailer.send(base)
    expect(onFailure).toHaveBeenCalledOnce()
    expect(onFailure.mock.calls[0]?.[0]).toContain('no mail provider')
  })
})

describe('the POPIA consent record', () => {
  it('appends the exact wording that was agreed to, so the email is the evidence', async () => {
    const send = vi.fn().mockResolvedValue({ data: { id: 'msg_1' } })
    const mailer = createMailer({
      provider: { emails: { send } } as unknown as MailProvider,
      from: 'a@b.com',
    })

    await mailer.send({ ...base, consentText: 'I agree to my details being used to contact me.' })

    const body = send.mock.calls[0]?.[0].text as string
    expect(body).toContain('POPIA record of consent')
    expect(body).toContain('I agree to my details being used to contact me.')
  })

  it('leaves the body alone when there is no consent text', async () => {
    const send = vi.fn().mockResolvedValue({ data: { id: 'msg_1' } })
    const mailer = createMailer({ provider: { emails: { send } } as unknown as MailProvider, from: 'a@b.com' })
    await mailer.send(base)
    expect(send.mock.calls[0]?.[0].text).toBe('Details')
  })
})

describe('narrowing helpers', () => {
  it('assertDelivered returns the id on success', async () => {
    const mailer = createMailer({ provider: provider({ data: { id: 'msg_1' } }), from: 'a@b.com' })
    expect(assertDelivered(await mailer.send(base))).toBe('msg_1')
  })

  it('assertDelivered throws on failure rather than returning undefined', async () => {
    const mailer = createMailer({ provider: null, from: 'a@b.com' })
    const result = await mailer.send(base)
    expect(() => assertDelivered(result)).toThrow(MailNotDeliveredError)
  })

  it('deliveredOr forces both branches to be written', async () => {
    const mailer = createMailer({ provider: null, from: 'a@b.com' })
    const message = deliveredOr(await mailer.send(base), {
      delivered: () => 'shown to the user',
      failed: (reason) => `not shown: ${reason}`,
    })
    expect(message).toContain('not shown')
  })
})
