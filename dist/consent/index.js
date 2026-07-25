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
export const CONSENT_PURPOSES = ['analytics', 'personalisation', 'cross_product'];
/** Everything off. The only lawful default. */
export const CONSENT_DENIED = Object.freeze({
    analytics: false,
    personalisation: false,
    cross_product: false,
});
function completeState(partial) {
    return {
        analytics: partial.analytics === true,
        personalisation: partial.personalisation === true,
        cross_product: partial.cross_product === true,
    };
}
export function isConsentRecord(value) {
    if (typeof value !== 'object' || value === null)
        return false;
    const record = value;
    if (typeof record.decidedAt !== 'string')
        return false;
    if (typeof record.wordingVersion !== 'string')
        return false;
    if (typeof record.surface !== 'string')
        return false;
    if (typeof record.purposes !== 'object' || record.purposes === null)
        return false;
    return CONSENT_PURPOSES.every((p) => typeof record.purposes[p] === 'boolean');
}
export function createConsentStore(options) {
    const { storage, wordingVersion, onWithdraw } = options;
    const now = options.now ?? (() => new Date());
    if (!wordingVersion) {
        throw new Error('wordingVersion is required. Without it a change to the consent copy silently rewrites what people agreed to.');
    }
    async function current() {
        const stored = await storage.read();
        if (!isConsentRecord(stored))
            return null;
        // A record agreed to under older wording is not consent to the current
        // wording. Treat it as undecided and ask again.
        if (stored.wordingVersion !== wordingVersion)
            return null;
        return stored;
    }
    async function purposes() {
        const record = await current();
        return record ? record.purposes : { ...CONSENT_DENIED };
    }
    async function decide(partial, surface = 'banner') {
        const record = {
            purposes: completeState(partial),
            decidedAt: now().toISOString(),
            wordingVersion,
            surface,
        };
        await storage.write(record);
        return record;
    }
    return {
        current,
        purposes,
        async needsDecision() {
            return (await current()) === null;
        },
        decide,
        async acceptAll(surface = 'banner') {
            return decide({ analytics: true, personalisation: true, cross_product: true }, surface);
        },
        async denyAll(surface = 'banner') {
            return decide({}, surface);
        },
        async withdraw() {
            await storage.clear();
            if (onWithdraw)
                await onWithdraw();
        },
        async allows(purpose) {
            return (await purposes())[purpose];
        },
    };
}
/**
 * A localStorage backed storage, for the immediate UI read.
 *
 * Not sufficient on its own. Mirror every write to the server, because a record
 * that only exists in the visitor's browser cannot be produced if the
 * Information Regulator asks what somebody agreed to.
 */
export function localStorageConsent(key = 'breazy_consent') {
    const available = () => {
        try {
            return typeof localStorage !== 'undefined';
        }
        catch {
            // Safari in private mode throws on access rather than returning undefined.
            return false;
        }
    };
    return {
        read() {
            if (!available())
                return null;
            try {
                const raw = localStorage.getItem(key);
                return raw ? JSON.parse(raw) : null;
            }
            catch {
                return null;
            }
        },
        write(record) {
            if (!available())
                return;
            try {
                localStorage.setItem(key, JSON.stringify(record));
            }
            catch {
                // Storage full or blocked. The server side record is the one that counts.
            }
        },
        clear() {
            if (!available())
                return;
            try {
                localStorage.removeItem(key);
            }
            catch {
                /* nothing to do */
            }
        },
    };
}
/** In memory storage, for tests and for server rendering. */
export function memoryConsent(initial = null) {
    let record = initial;
    return {
        read: () => record,
        write: (next) => {
            record = next;
        },
        clear: () => {
            record = null;
        },
    };
}
//# sourceMappingURL=index.js.map