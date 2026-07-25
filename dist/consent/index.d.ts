/**
 * POPIA consent, with the three things the existing VibesMap banner is missing:
 * per purpose granularity, the version of the wording that was agreed to, and a
 * way to change your mind.
 *
 * See projects/DATA-STANDARD.md.
 *
 * The pattern for storing the wording verbatim with the record comes from
 * greenmedicalcare/lib/consent.ts, which keeps PROCESSING_CONSENT and
 * MARKETING_CONSENT as exported strings and writes the exact text alongside each
 * booking. That is the right instinct and this generalises it: a consent record
 * that points at "the privacy policy" is worthless once the policy is rewritten.
 */
/**
 * The three purposes. POPIA requires consent to be specific, so one blanket
 * accept cannot cover three different uses of the same data.
 *
 *  analytics       counting and aggregate reporting
 *  personalisation using this person's own behaviour to change what they see
 *  cross_product   forwarding to the signal layer so other products can use it
 *
 * Precise location is deliberately absent. It is a different proposition from a
 * city name and needs its own purpose if it is ever persisted, rather than being
 * folded in here. VibesMap currently holds precise coordinates in memory only.
 */
export declare const CONSENT_PURPOSES: readonly ["analytics", "personalisation", "cross_product"];
export type ConsentPurpose = (typeof CONSENT_PURPOSES)[number];
export type ConsentState = Record<ConsentPurpose, boolean>;
/** Everything off. The only lawful default. */
export declare const CONSENT_DENIED: ConsentState;
export interface ConsentRecord {
    readonly purposes: ConsentState;
    /** ISO 8601, when the decision was made. */
    readonly decidedAt: string;
    /**
     * The version of the wording that was shown. Bump it whenever the copy
     * changes, so a later rewrite cannot silently rewrite what people agreed to.
     */
    readonly wordingVersion: string;
    /** Where it was given, for example "banner" or "settings" or "signup". */
    readonly surface: string;
}
/**
 * Storage for the record. Deliberately an interface rather than localStorage,
 * because POPIA wants provable consent and localStorage alone proves nothing:
 * it is client side, clearable, and has no server witness. Implement this
 * against localStorage for the immediate UI read and mirror it to your database
 * for the record that actually counts.
 */
export interface ConsentStorage {
    read(): ConsentRecord | null | Promise<ConsentRecord | null>;
    write(record: ConsentRecord): void | Promise<void>;
    clear(): void | Promise<void>;
}
export interface ConsentStoreOptions {
    storage: ConsentStorage;
    /** Current wording version. A stored record from an older version is treated as undecided. */
    wordingVersion: string;
    /**
     * Called when consent is withdrawn, so the caller can rotate the anonymous id.
     * Withdrawal must break the link between the old trail and the new one,
     * otherwise "withdrawn" only means "stopped adding to the same profile".
     */
    onWithdraw?: () => void | Promise<void>;
    /** Injectable clock, so tests do not depend on the wall clock. */
    now?: () => Date;
}
export interface ConsentStore {
    /** The current record, or null if nothing has been decided under the current wording. */
    current(): Promise<ConsentRecord | null>;
    /** Resolved purposes. Everything false when undecided, never a permissive default. */
    purposes(): Promise<ConsentState>;
    /** True when the banner should be shown. */
    needsDecision(): Promise<boolean>;
    /** Record a decision. Partial input, anything unspecified is denied. */
    decide(purposes: Partial<ConsentState>, surface?: string): Promise<ConsentRecord>;
    /** Accept every purpose. Convenience for an "accept all" button. */
    acceptAll(surface?: string): Promise<ConsentRecord>;
    /** Deny every purpose. This is a decision and is recorded as one. */
    denyAll(surface?: string): Promise<ConsentRecord>;
    /** Withdraw entirely, clearing the record and triggering onWithdraw. */
    withdraw(): Promise<void>;
    /** Check one purpose. */
    allows(purpose: ConsentPurpose): Promise<boolean>;
}
export declare function isConsentRecord(value: unknown): value is ConsentRecord;
export declare function createConsentStore(options: ConsentStoreOptions): ConsentStore;
/**
 * A localStorage backed storage, for the immediate UI read.
 *
 * Not sufficient on its own. Mirror every write to the server, because a record
 * that only exists in the visitor's browser cannot be produced if the
 * Information Regulator asks what somebody agreed to.
 */
export declare function localStorageConsent(key?: string): ConsentStorage;
/** In memory storage, for tests and for server rendering. */
export declare function memoryConsent(initial?: ConsentRecord | null): ConsentStorage;
//# sourceMappingURL=index.d.ts.map