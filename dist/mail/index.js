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
export class MailNotDeliveredError extends Error {
    reason;
    name = 'MailNotDeliveredError';
    constructor(reason) {
        super(`email was not delivered: ${reason}`);
        this.reason = reason;
    }
}
/** Narrow a result, or throw. Use where a failure genuinely must abort the flow. */
export function assertDelivered(result) {
    if (!result.delivered)
        throw new MailNotDeliveredError(result.reason);
    return result.id;
}
/** Fork on the result. Forces both branches to be written. */
export function deliveredOr(result, handlers) {
    return result.delivered ? handlers.delivered(result.id) : handlers.failed(result.reason);
}
function appendConsent(text, consentText) {
    if (!consentText)
        return text;
    return [
        text,
        '',
        'POPIA record of consent',
        consentText,
        '',
        'Keep this email. It is the record of this request and of the consent given.',
    ].join('\n');
}
export function createMailer(options) {
    const { provider, from, defaultTo, onFailure } = options;
    return {
        configured: Boolean(provider),
        async send(sendOptions) {
            const to = sendOptions.to ?? defaultTo;
            if (!to || (Array.isArray(to) && to.length === 0)) {
                const reason = 'no recipient';
                onFailure?.(reason, sendOptions);
                return { delivered: false, reason };
            }
            if (!provider) {
                // Loud, because this is the failure that loses bookings. Green Medical
                // Care had bookings failing into a deleted database for weeks.
                const reason = 'no mail provider configured, the submission cannot be captured';
                console.error(`[breazy/mail] ${reason}`);
                onFailure?.(reason, sendOptions);
                return { delivered: false, reason };
            }
            // Array.isArray does not narrow `string | readonly string[]` usefully, so
            // build the mutable recipient list explicitly.
            const recipients = typeof to === 'string' ? to : [...to];
            try {
                const payload = {
                    from,
                    to: recipients,
                    subject: sendOptions.subject,
                    text: appendConsent(sendOptions.text, sendOptions.consentText),
                    ...(sendOptions.html ? { html: sendOptions.html } : {}),
                    ...(sendOptions.replyTo ? { replyTo: sendOptions.replyTo } : {}),
                };
                const response = await provider.emails.send(payload);
                if (response.error) {
                    const reason = response.error.message || 'provider rejected the send';
                    console.error(`[breazy/mail] send rejected: ${reason}`);
                    onFailure?.(reason, sendOptions);
                    return { delivered: false, reason };
                }
                const id = response.data?.id;
                if (!id) {
                    // No error and no id means we cannot prove it was accepted, so we do
                    // not claim it was. Reporting success without evidence is the exact
                    // failure this package exists to prevent.
                    const reason = 'provider returned no id, delivery unconfirmed';
                    console.error(`[breazy/mail] ${reason}`);
                    onFailure?.(reason, sendOptions);
                    return { delivered: false, reason };
                }
                return { delivered: true, id };
            }
            catch (error) {
                const reason = error instanceof Error ? error.message : 'unknown send failure';
                console.error(`[breazy/mail] send failed: ${reason}`);
                onFailure?.(reason, sendOptions);
                return { delivered: false, reason };
            }
        },
    };
}
//# sourceMappingURL=index.js.map