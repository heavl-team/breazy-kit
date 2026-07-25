# breazy-kit

The shared standard every app in Brendon's portfolio installs. One place for consent, event capture, cross product identity, transactional email and the security baseline, so a fix goes in once instead of eleven times.

Nothing here was written from scratch. Every module is extracted from code already running in production, with the gaps closed. The standard it implements is [`projects/APP-STANDARD.md`](https://github.com/Brendon1109/Breazy) in the Breazy repo, with the data design in `DATA-STANDARD.md`.

## Install

Consumed by git tag. No registry, no auth, no cost.

```bash
npm install github:Brendon1109/breazy-kit#v0.1.0
```

`dist/` is committed deliberately so a consumer needs no build step and no toolchain. Pinning by tag means a client site never moves until the tag is bumped.

```ts
import { createTracker, SHARED_EVENTS } from '@breazy/kit/events'
import { createConsentStore, localStorageConsent } from '@breazy/kit/consent'
import { personKey, pepperFromEnv } from '@breazy/kit/identity'
import { createMailer, deliveredOr } from '@breazy/kit/mail'
import { securityHeaders, createRateLimiter, checkBot } from '@breazy/kit/guard'
```

## What is in it

| Subpath | What it does | Extracted from |
| --- | --- | --- |
| `@breazy/kit/events` | The event envelope, the closed vocabulary, the client tracker, and server side normalisation. The single write path for behavioural data. | `tsakani-sessions-app` `/api/track` and `lib/analytics.ts` |
| `@breazy/kit/consent` | Three purpose POPIA consent with versioned wording, a timestamp and a withdrawal path. | `vibesmap` `CookieConsent.tsx`, plus the per record consent evidence pattern from `greenmedicalcare` `lib/consent.ts` |
| `@breazy/kit/identity` | The pseudonymous cross product key. Server only. | New, per `DATA-STANDARD.md` |
| `@breazy/kit/mail` | Resend wrapper where success is a boolean you cannot quietly ignore. | `greenmedicalcare` `lib/email.ts` |
| `@breazy/kit/guard` | Security headers, CSP builder, origin allowlist, bot defence, rate limiter. | `vibesmap` `middleware.ts`, `MM-Order-Form-ED` order route |

## The five rules it enforces

Each one exists because it was missed on a real project here.

**1. Never claim success without evidence.** `mail.send()` reports delivered only when the provider returns an id. No error and no id is a failure, not a success, because you cannot prove it was accepted. It never throws, so a provider outage cannot 500 a form. Email is the system of record for Green Medical Care, which runs live with no database, so a booking that is not emailed is lost.

**2. Consent is enforced in code, not in policy.** `mayForward()` is the one conditional that decides whether an event reaches the signal layer, and `normaliseEvent()` drops anything without analytics consent even if a stale client sent it. Neither lives in a config flag somebody can flip.

**3. Personal data cannot get into an event.** `cleanProps()` strips forbidden keys, strips anything that looks like an email regardless of its key, and strips nested objects where personal data hides from the key check. Minimisation is a POPIA condition, not a code review convention.

**4. Consent has a version.** A record that points at "the privacy policy" is worthless once the policy is rewritten, so every decision stores the wording version it agreed to. A record under older wording is treated as undecided and the person is asked again.

**5. A broken dependency degrades, it does not block.** The rate limiter returns allowed when anything throws, including its own clock. Taken from how MM Cellars treats Redis: a broken limiter must never fail a real order.

## Development

```bash
npm install
npm run check   # clean, build, test
```

96 tests. The suite is written against the failures above rather than for coverage, so a passing suite means those specific mistakes cannot recur silently.

## What is not in it yet

Deferred to v0.2.0, in this order:

- `@breazy/kit/legal`, the POPIA notice generator. The template is written and lives in `legal/popia-privacy-notice-template-v1.md` in the Breazy repo, generalised from the live VibesMap policy. The generator plus VibesMap's working section 23 export and delete routes come next
- `@breazy/kit/site`, the one config drives metadata, sitemap, robots, JSON-LD and `llms.txt` pattern from `greenmedicalcare/lib/site.ts`
- `@breazy/kit/tokens`, the accessible premium design tokens
- A React consent banner. The consent core here is deliberately framework agnostic and testable, so the banner is a thin layer on top rather than the thing itself

## Style

No dash punctuation in prose. Commas, full stops and the word "and".
