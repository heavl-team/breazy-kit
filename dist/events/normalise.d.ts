import { type Device, type EventInput } from './envelope.js';
/**
 * Server side validation and normalisation of an incoming event.
 *
 * Deliberately forgiving about shape and unforgiving about content. A malformed
 * beacon is dropped silently, because the client never reads the response and a
 * 400 helps nobody. Personal data in a props bag is stripped rather than stored,
 * because minimisation is not something to leave to code review.
 */
export declare function clamp(value: unknown, max: number): string | null;
export declare function deviceFromUserAgent(ua: string): Device;
/** Host only. Never store a full referrer, which can carry a search query. */
export declare function referrerHost(referrer: unknown): string | null;
export interface PropsResult {
    readonly props: Record<string, unknown>;
    /** Keys removed because they are on the forbidden list or looked like an email. */
    readonly stripped: readonly string[];
}
/**
 * Clean a props bag.
 *
 * Drops any key on the forbidden list, and any value that looks like an email
 * address regardless of its key, because `owner` holding an email is the same
 * leak as `email` holding one. Then caps the serialised size at 2 000 bytes,
 * matching Tsakani.
 */
export declare function cleanProps(input: unknown): PropsResult;
export interface NormaliseResult {
    readonly ok: boolean;
    readonly event: EventInput | null;
    readonly stripped: readonly string[];
    readonly reason?: string;
}
/**
 * Normalise a raw payload into an EventInput, or reject it.
 *
 * Never throws. A beacon that cannot be parsed is not an error worth surfacing,
 * it is an event that did not happen.
 */
export declare function normaliseEvent(payload: unknown, allowedEvents?: readonly string[]): NormaliseResult;
/**
 * Whether a stored event may be forwarded to the signal layer.
 *
 * This is the one conditional that separates a defensible design from a fine, so
 * it lives in code rather than in a policy document or a config flag somebody
 * can flip. See projects/DATA-STANDARD.md.
 */
export declare function mayForward(event: Pick<EventInput, 'consent'>): boolean;
//# sourceMappingURL=normalise.d.ts.map