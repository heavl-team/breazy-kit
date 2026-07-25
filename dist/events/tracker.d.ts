import type { ConsentState } from '../consent/index.js';
import { type App } from './envelope.js';
/**
 * The client tracker. The single write path for behavioural data.
 *
 * Ported from tsakani-sessions-app/lib/analytics.ts, which already honours Do
 * Not Track, carries a kill switch, and uses sendBeacon with a fetch keepalive
 * fallback so an event survives the page unloading. What is added: a stable
 * anonId separate from the session, a 30 minute idle session reset, occurredAt
 * set here rather than on the server, and a consent gate that runs before
 * anything is sent.
 */
export interface TrackerOptions {
    readonly app: App;
    /** Where events are posted. The app's own ingest, never another app's. */
    readonly endpoint: string;
    /** Read current consent. Called on every track, so a withdrawal takes effect immediately. */
    readonly getConsent: () => ConsentState;
    /** Closed vocabulary. An event outside it is dropped and warned about in development. */
    readonly vocabulary?: readonly string[];
    /** Set false to disable entirely, for example from an env var. */
    readonly enabled?: boolean;
    /** Storage keys, overridable per app so two apps on one domain do not collide. */
    readonly anonIdKey?: string;
    readonly sessionKey?: string;
    /** Idle milliseconds before a new session starts. Default 30 minutes. */
    readonly sessionIdleMs?: number;
}
export interface Tracker {
    track(event: string, props?: Record<string, unknown>): void;
    /** The current anonymous id, creating one if needed. Null when storage is unavailable. */
    anonId(): string | null;
    /** Rotate the anonymous id. Call on consent withdrawal so the old trail cannot be tied to the new one. */
    rotateAnonId(): void;
    /** True when nothing will be sent, and why. Useful in a debug panel. */
    status(): {
        sending: boolean;
        reason?: string;
    };
}
export declare function createTracker(options: TrackerOptions): Tracker;
//# sourceMappingURL=tracker.d.ts.map