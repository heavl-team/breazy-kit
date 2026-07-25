import { LIMITS } from './envelope.js';
const DEFAULT_IDLE_MS = 30 * 60 * 1000;
function hasStorage() {
    try {
        return typeof localStorage !== 'undefined';
    }
    catch {
        // Safari private mode throws on access.
        return false;
    }
}
function randomId() {
    try {
        if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
            return crypto.randomUUID();
        }
    }
    catch {
        /* fall through */
    }
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
/**
 * Do Not Track.
 *
 * Honoured because Tsakani already honours it and removing a privacy control
 * while writing a privacy standard would be indefensible.
 */
function doNotTrack() {
    if (typeof navigator === 'undefined')
        return false;
    const nav = navigator;
    const win = typeof window !== 'undefined' ? window : undefined;
    const signals = [nav.doNotTrack, nav.msDoNotTrack, win?.doNotTrack];
    return signals.some((s) => s === '1' || s === 'yes');
}
export function createTracker(options) {
    const { app, endpoint, getConsent, vocabulary, enabled = true, anonIdKey = `breazy_anon_${app}`, sessionKey = `breazy_session_${app}`, sessionIdleMs = DEFAULT_IDLE_MS, } = options;
    function readAnonId() {
        if (!hasStorage())
            return null;
        try {
            let id = localStorage.getItem(anonIdKey);
            if (!id) {
                id = randomId().slice(0, LIMITS.anonId);
                localStorage.setItem(anonIdKey, id);
            }
            return id;
        }
        catch {
            return null;
        }
    }
    function readSessionId() {
        if (!hasStorage())
            return null;
        try {
            const raw = localStorage.getItem(sessionKey);
            const now = Date.now();
            if (raw) {
                const parsed = JSON.parse(raw);
                if (parsed.id && typeof parsed.last === 'number' && now - parsed.last < sessionIdleMs) {
                    localStorage.setItem(sessionKey, JSON.stringify({ id: parsed.id, last: now }));
                    return parsed.id;
                }
            }
            const id = randomId().slice(0, LIMITS.sessionId);
            localStorage.setItem(sessionKey, JSON.stringify({ id, last: now }));
            return id;
        }
        catch {
            return null;
        }
    }
    function status() {
        if (!enabled)
            return { sending: false, reason: 'disabled' };
        if (typeof window === 'undefined')
            return { sending: false, reason: 'not in a browser' };
        if (doNotTrack())
            return { sending: false, reason: 'do not track' };
        if (!getConsent().analytics)
            return { sending: false, reason: 'no analytics consent' };
        if (!hasStorage())
            return { sending: false, reason: 'no storage for an anonymous id' };
        return { sending: true };
    }
    function send(body) {
        try {
            // text/plain is a CORS safelisted content type, so sendBeacon works without
            // a preflight it cannot perform. The ingest parses content type agnostically.
            const blob = new Blob([body], { type: 'text/plain;charset=UTF-8' });
            if (typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
                if (navigator.sendBeacon(endpoint, blob))
                    return;
            }
            void fetch(endpoint, {
                method: 'POST',
                body,
                keepalive: true,
                headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
            }).catch(() => {
                // Fire and forget. A dropped event is not worth an error in the console.
            });
        }
        catch {
            /* nothing to do */
        }
    }
    return {
        anonId: readAnonId,
        rotateAnonId() {
            if (!hasStorage())
                return;
            try {
                localStorage.removeItem(anonIdKey);
                localStorage.removeItem(sessionKey);
            }
            catch {
                /* nothing to do */
            }
        },
        status,
        track(event, props) {
            const state = status();
            if (!state.sending)
                return;
            if (vocabulary && !vocabulary.includes(event)) {
                if (typeof process !== 'undefined' && process.env?.NODE_ENV !== 'production') {
                    console.warn(`[breazy/events] "${event}" is not in the vocabulary and was dropped. Add it deliberately rather than by typo.`);
                }
                return;
            }
            const anonId = readAnonId();
            const sessionId = readSessionId();
            if (!anonId || !sessionId)
                return;
            const body = JSON.stringify({
                app,
                event,
                occurredAt: new Date().toISOString(),
                anonId,
                sessionId,
                path: typeof location !== 'undefined' ? location.pathname.slice(0, LIMITS.path) : undefined,
                referrer: typeof document !== 'undefined' && document.referrer ? document.referrer : undefined,
                props: props ?? {},
                consent: getConsent(),
            });
            send(body);
        },
    };
}
//# sourceMappingURL=tracker.js.map