/**
 * The security baseline: headers, an origin allowlist, bot defence and a rate
 * limiter that degrades to a no op rather than blocking a request.
 *
 * Every piece here is extracted from something already running:
 *  - the CSRF origin allowlist from vibesmap/web/middleware.ts
 *  - the honeypot and timing check from MM-Order-Form-ED/app/api/order/route.ts
 *  - the degrade to a no op rule from how MM Cellars treats Redis
 *
 * And every default here answers a hole that is live right now in SpaniSpace,
 * which ships no CSP, no X-Frame-Options, no Referrer-Policy and no
 * Permissions-Policy at all.
 */
export interface CspOptions {
    /** Extra hosts per directive. Anything not listed is blocked. */
    readonly scriptSrc?: readonly string[];
    readonly styleSrc?: readonly string[];
    readonly imgSrc?: readonly string[];
    readonly connectSrc?: readonly string[];
    readonly fontSrc?: readonly string[];
    readonly frameSrc?: readonly string[];
    /** Next.js needs unsafe-inline for styles, and unsafe-eval in development. */
    readonly allowUnsafeInlineStyles?: boolean;
    readonly development?: boolean;
}
/**
 * Build a Content Security Policy.
 *
 * Starts closed and opens only what is passed in. Two repos already have a strict
 * CSP, vibesmap in next.config.js and planner with connect-src 'self', and the
 * thing to remember about both is that a missing origin fails silently in
 * production: the script simply never loads and nothing is logged.
 */
export declare function buildCsp(options?: CspOptions): string;
export interface SecurityHeaderOptions extends CspOptions {
    /** Omit HSTS only when serving over plain HTTP in development. */
    readonly hsts?: boolean;
}
/**
 * The header set ship-check verifies. Returns a plain object so it can be spread
 * into a Next.js config, a middleware response, or a Cloudflare Worker.
 */
export declare function securityHeaders(options?: SecurityHeaderOptions): Record<string, string>;
export interface OriginCheckOptions {
    readonly allowed: readonly string[];
    /**
     * Paths exempt from the check. Webhooks belong here because the sender cannot
     * present an allowed Origin. In VibesMap that is /api/auth, /api/scrape and
     * critically /api/payfast/notify, and removing that last exemption breaks
     * payment notifications silently.
     */
    readonly exempt?: readonly string[];
}
/**
 * Is this mutation allowed to proceed?
 *
 * Ported from vibesmap/web/middleware.ts. Applies to mutating methods only, so a
 * curl POST without an allowed Origin gets refused while reads are untouched.
 */
export declare function isAllowedMutation(input: {
    readonly method: string;
    readonly origin: string | null;
    readonly path: string;
}, options: OriginCheckOptions): boolean;
export interface BotCheckInput {
    /** The honeypot field's submitted value. Any content means a bot filled it. */
    readonly honeypot?: unknown;
    /** Milliseconds between the form rendering and submitting. */
    readonly elapsedMs?: number;
}
export interface BotCheckOptions {
    /** Anything faster than this is not a human typing. MM Cellars uses 500. */
    readonly minElapsedMs?: number;
}
export type BotVerdict = {
    readonly bot: false;
} | {
    readonly bot: true;
    readonly signal: string;
};
/**
 * Honeypot plus timing.
 *
 * Two things learned the hard way in this portfolio. MM Cellars names its
 * honeypot `company` and returns a silent fake success rather than an error, so a
 * bot cannot tell it was caught. And Green Medical Care deliberately does not use
 * the name `company`, because browsers autofill it and real people get dropped.
 * So: keep the silent success, and pick a field name no browser will fill.
 */
export declare function checkBot(input: BotCheckInput, options?: BotCheckOptions): BotVerdict;
/**
 * A honeypot field name unlikely to be autofilled.
 *
 * Avoid company, organisation, address, fax and anything else in a browser's
 * autofill vocabulary.
 */
export declare const SAFE_HONEYPOT_FIELD = "referral_window";
export interface RateLimitOptions {
    /** Requests allowed per window. */
    readonly limit: number;
    /** Window length in milliseconds. */
    readonly windowMs: number;
    /** Injectable clock for tests. */
    readonly now?: () => number;
}
export interface RateLimitResult {
    readonly allowed: boolean;
    readonly remaining: number;
    readonly resetAt: number;
}
export interface RateLimiter {
    check(key: string): RateLimitResult;
    reset(key?: string): void;
}
/**
 * An in memory fixed window limiter.
 *
 * Per instance and reset on deploy, which is a known limitation rather than a
 * defect. Say so when you use it. It is enough to stop casual abuse of a public
 * write, and it costs nothing, which matters when the alternative is Upstash and
 * the app is pre revenue.
 *
 * It never throws and never blocks on anything external, which is the rule taken
 * from how MM Cellars treats Redis: a broken limiter silently allows the request
 * rather than failing the order.
 */
export declare function createRateLimiter(options: RateLimitOptions): RateLimiter;
//# sourceMappingURL=index.d.ts.map