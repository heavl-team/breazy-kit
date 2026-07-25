/**
 * Transactional email, where success is a boolean you cannot quietly ignore.
 *
 * Lifted from greenmedicalcare/lib/email.ts, which is the reference
 * implementation in the portfolio and gets three things right:
 *
 *  1. It returns whether the send actually succeeded.
 *  2. It never throws, so a provider outage cannot 500 a form.
 *  3. The server action refuses to show success unless the send was accepted.
 *
 * That third point is the important one and it is the rule this package exists to
 * make hard to break: a booking or order that is not emailed is lost, because for
 * several of these apps email is the system of record. Green Medical Care runs
 * live with no database at all.
 *
 * A note on what TypeScript can and cannot do here. There is no must_use
 * attribute, so nothing stops somebody writing `void send(...)` and moving on.
 * What this design does enforce is that the delivery id is unreachable without
 * narrowing on `delivered`, so you cannot accidentally treat a failure as a
 * success while reading a field off it. For the rest, use `deliveredOr` or
 * `assertDelivered` rather than touching the union by hand.
 */

export interface SendOptions {
  readonly to: string | readonly string[]
  readonly subject: string
  readonly text: string
  readonly html?: string
  readonly replyTo?: string
  /**
   * POPIA: the exact wording the person agreed to, kept with the record.
   *
   * Straight from greenmedicalcare, where the consent text is written into the
   * notification email so the email itself is the evidence. A consent record
   * that points at "the privacy policy" is worthless once the policy changes.
   */
  readonly consentText?: string
}

export type SendResult =
  | { readonly delivered: true; readonly id: string }
  | { readonly delivered: false; readonly reason: string }

/** The minimum surface this package needs. Keeps `resend` an optional peer. */
export interface MailProvider {
  emails: {
    send(payload: {
      from: string
      to: string | string[]
      subject: string
      text: string
      html?: string
      replyTo?: string
    }): Promise<{ data?: { id?: string } | null; error?: { message?: string } | null }>
  }
}

export interface MailerOptions {
  readonly provider: MailProvider | null
  readonly from: string
  readonly defaultTo?: string | readonly string[]
  /** Called on every failure. Wire this to Sentry so a silent outage is visible. */
  readonly onFailure?: (reason: string, options: SendOptions) => void
}

export interface Mailer {
  /** Send. Never throws. Check `delivered` before reporting success to anybody. */
  send(options: SendOptions): Promise<SendResult>
  /** True when a provider is configured. False means every send will fail. */
  readonly configured: boolean
}

export class MailNotDeliveredError extends Error {
  override readonly name = 'MailNotDeliveredError'
  constructor(public readonly reason: string) {
    super(`email was not delivered: ${reason}`)
  }
}

/** Narrow a result, or throw. Use where a failure genuinely must abort the flow. */
export function assertDelivered(result: SendResult): string {
  if (!result.delivered) throw new MailNotDeliveredError(result.reason)
  return result.id
}

/** Fork on the result. Forces both branches to be written. */
export function deliveredOr<T>(
  result: SendResult,
  handlers: { readonly delivered: (id: string) => T; readonly failed: (reason: string) => T },
): T {
  return result.delivered ? handlers.delivered(result.id) : handlers.failed(result.reason)
}

function appendConsent(text: string, consentText?: string): string {
  if (!consentText) return text
  return [
    text,
    '',
    'POPIA record of consent',
    consentText,
    '',
    'Keep this email. It is the record of this request and of the consent given.',
  ].join('\n')
}

export function createMailer(options: MailerOptions): Mailer {
  const { provider, from, defaultTo, onFailure } = options

  return {
    configured: Boolean(provider),

    async send(sendOptions: SendOptions): Promise<SendResult> {
      const to = sendOptions.to ?? defaultTo
      if (!to || (Array.isArray(to) && to.length === 0)) {
        const reason = 'no recipient'
        onFailure?.(reason, sendOptions)
        return { delivered: false, reason }
      }

      if (!provider) {
        // Loud, because this is the failure that loses bookings. Green Medical
        // Care had bookings failing into a deleted database for weeks.
        const reason = 'no mail provider configured, the submission cannot be captured'
        console.error(`[breazy/mail] ${reason}`)
        onFailure?.(reason, sendOptions)
        return { delivered: false, reason }
      }

      // Array.isArray does not narrow `string | readonly string[]` usefully, so
      // build the mutable recipient list explicitly.
      const recipients: string | string[] = typeof to === 'string' ? to : [...to]

      try {
        const payload = {
          from,
          to: recipients,
          subject: sendOptions.subject,
          text: appendConsent(sendOptions.text, sendOptions.consentText),
          ...(sendOptions.html ? { html: sendOptions.html } : {}),
          ...(sendOptions.replyTo ? { replyTo: sendOptions.replyTo } : {}),
        }
        const response = await provider.emails.send(payload)

        if (response.error) {
          const reason = response.error.message || 'provider rejected the send'
          console.error(`[breazy/mail] send rejected: ${reason}`)
          onFailure?.(reason, sendOptions)
          return { delivered: false, reason }
        }

        const id = response.data?.id
        if (!id) {
          // No error and no id means we cannot prove it was accepted, so we do
          // not claim it was. Reporting success without evidence is the exact
          // failure this package exists to prevent.
          const reason = 'provider returned no id, delivery unconfirmed'
          console.error(`[breazy/mail] ${reason}`)
          onFailure?.(reason, sendOptions)
          return { delivered: false, reason }
        }

        return { delivered: true, id }
      } catch (error) {
        const reason = error instanceof Error ? error.message : 'unknown send failure'
        console.error(`[breazy/mail] send failed: ${reason}`)
        onFailure?.(reason, sendOptions)
        return { delivered: false, reason }
      }
    },
  }
}
