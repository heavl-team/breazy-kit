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
    readonly to: string | readonly string[];
    readonly subject: string;
    readonly text: string;
    readonly html?: string;
    readonly replyTo?: string;
    /**
     * POPIA: the exact wording the person agreed to, kept with the record.
     *
     * Straight from greenmedicalcare, where the consent text is written into the
     * notification email so the email itself is the evidence. A consent record
     * that points at "the privacy policy" is worthless once the policy changes.
     */
    readonly consentText?: string;
}
export type SendResult = {
    readonly delivered: true;
    readonly id: string;
} | {
    readonly delivered: false;
    readonly reason: string;
};
/** The minimum surface this package needs. Keeps `resend` an optional peer. */
export interface MailProvider {
    emails: {
        send(payload: {
            from: string;
            to: string | string[];
            subject: string;
            text: string;
            html?: string;
            replyTo?: string;
        }): Promise<{
            data?: {
                id?: string;
            } | null;
            error?: {
                message?: string;
            } | null;
        }>;
    };
}
export interface MailerOptions {
    readonly provider: MailProvider | null;
    readonly from: string;
    readonly defaultTo?: string | readonly string[];
    /** Called on every failure. Wire this to Sentry so a silent outage is visible. */
    readonly onFailure?: (reason: string, options: SendOptions) => void;
}
export interface Mailer {
    /** Send. Never throws. Check `delivered` before reporting success to anybody. */
    send(options: SendOptions): Promise<SendResult>;
    /** True when a provider is configured. False means every send will fail. */
    readonly configured: boolean;
}
export declare class MailNotDeliveredError extends Error {
    readonly reason: string;
    readonly name = "MailNotDeliveredError";
    constructor(reason: string);
}
/** Narrow a result, or throw. Use where a failure genuinely must abort the flow. */
export declare function assertDelivered(result: SendResult): string;
/** Fork on the result. Forces both branches to be written. */
export declare function deliveredOr<T>(result: SendResult, handlers: {
    readonly delivered: (id: string) => T;
    readonly failed: (reason: string) => T;
}): T;
export declare function createMailer(options: MailerOptions): Mailer;
//# sourceMappingURL=index.d.ts.map