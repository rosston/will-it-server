# will-it-server

Will this value survive the trip across the React Server Components boundary —
*in production?*

## The problem

Next.js apps have a class of bug that only appears after deploy: a value that
crosses the RSC boundary (a server function's arguments or return value)
behaves differently in `next dev` than in a production build. The canonical
example: a server function that **returns** an `Error` (rather than throwing
it). In development, the client component awaits the call and gets the real
error — message and stack intact. In production, the client component awaits
the call and gets... an `Error`, but not *yours*. React Flight silently
replaces it with an opaque stand-in ("An error occurred in the Server
Components render..."). Same code, different value. CI is green, dev is green,
prod is broken.

React's own feedback about these hazards is inconsistent: some lossy
transformations (a `URL` arriving as a string, a `Buffer` arriving as
`{type: 'Buffer', data: [...]}`) produce a dev-only `console.error` that
rendering blows past anyway; the returned-`Error` case warns about nothing at
all; and the production build never tells you anything, by design.

## The approach

Catch the hazard at the call site, before the boundary — for every hazard
class, in every run where the check can do you any good (dev, tests, CI).
Think of it as the dev-only `console.error` that React emits for *some* types,
generalized: applied to everything Flight cares about, surfaced consistently.

```ts
'use server'

import { serverFunction } from 'will-it-server'

export const saveTodo = serverFunction(async function saveTodo (todo: Todo) {
  if (!isValid(todo)) {
    return new Error('invalid todo') // build failure: won't survive the boundary
  }
  ...
})
```

`serverFunction` checks in two layers. At **compile time**, the declared
argument and return types are walked structurally: callbacks, class methods,
`URL`-shaped objects, the `Error` family in return position, and types React
never promised (`DataView`, `File`/`Blob`, streams) are rejected outright —
the hazard is a build failure, in every mode, no runtime required. (The walk
can't see everything — see "What the type layer can't see" — so it never
replaces the second layer.) At **runtime**, the actual values are walked
against Flight's observed behavior and flagged via `console.error`, catching
what types can't: invalid `Date`s, class instances passed through data-shaped
types, symbol-keyed members, and any value whose type was widened to `any`.

The question both layers answer is **"arrives intact?"** — not "crosses at
all". A value that crosses but arrives corrupted, degraded, or replaced is a
failure: the returned `Error` (opaque stand-in in prod), the invalid `Date`
(arrives as `null`), the `URL` (arrives as its href string).

## The boundary matrix

What the rules actually are, in one table. **Docs** = the value's type
appears on React's serializable-types list for that direction
([`use-server`](https://react.dev/reference/rsc/use-server#serializable-parameters-and-return-values)
for arguments, [`use-client`](https://react.dev/reference/rsc/use-client#serializable-types)
for returns/props). **Measured** = what the characterization suite observed
Flight doing at the pinned version (react-server-dom-webpack 19.3.1, dev and
prod builds, both directions). **Rule** = what the library does: *pass* lets
it through, *flag* means a build failure at compile time where types can see
it, and a `console.error` at runtime.

Admission rule: **pass only when documented ∧ measured-intact**. Where
reality is worse than the docs, reality vetoes (registered symbols as args:
the docs promise them, they arrive as opaque placeholders). Where reality is
more generous than the docs, the docs veto — "works in 19.3.1, un-promised"
things can change without notice, since framework-level RSC behavior does not
follow semver.

| Value | Docs | Measured | Rule |
|---|---|---|---|
| primitives; `NaN` / `±Infinity` / `-0` | ✅ | ✅ exact | pass |
| plain objects / arrays / `Map` / `Set` of passing values | ✅ | ✅ | pass |
| cycles & shared references | ✅ | ✅ identity restored | pass |
| `Date` (valid) | ✅ | ✅ ISO-only; own props dropped | pass |
| `Date` (invalid) | ✅ | ❌ arrives `null`, silently | flag |
| `ArrayBuffer` + typed arrays | ✅ | ✅ bytes intact | pass |
| `FormData` — arguments, any depth | ✅ | ✅ entries intact | pass |
| `FormData` — return values | ❌ | ✅ works (19.3.1) | flag |
| React elements — returns, any depth | ✅ | ✅ arrive as elements | pass |
| React elements — arguments | ❌ | ❌ opaque placeholder | flag |
| `Symbol.for(...)` values — return direction | ✅ | ✅ arrive as symbols | pass |
| `Symbol.for(...)` values — arguments | ✅ | ❌ opaque placeholder | flag |
| unregistered `Symbol(...)` values | ❌ | ❌ hard-fail / opaque | flag |
| symbol-KEYED object members | ❌ | ❌ silently dropped | flag |
| Server Function values (tagged functions) | ✅ | ✅ live callables both ways | pass (runtime tag check) |
| other functions, class instances, null-prototype objects | ❌ | ❌ hard-fail / opaque | flag |
| `Error` family — return values (the flagship) | ❌ | ❌ dev degrades / prod stand-in | flag |
| `Error` values — arguments | ❌ | ❌ opaque placeholder | flag |
| `URL`, Node `Buffer`, `toJSON`-bearing objects | ❌ | ❌ arrive corrupted (string / `{type:'Buffer'}` / JSON-replaced) | flag |
| `DataView`, bare `File`/`Blob`, `ReadableStream`, async iterables | ❌ | ✅ work (19.3.1) | flag |
| resolved & pending promise members, any depth | ✅ | ✅ live thenables both ways | pass |
| rejected promise values | ✅ | ❌ sinks the encode / arrives rejected | flag |

*Opaque placeholder*: what an argument actually arrives as under Next's
`TemporaryReferenceSet` encode path — a throw-on-touch proxy standing in for
the real object, which never crossed the wire. See
[`characterization/`](./characterization) for how every row was measured.

One deliberate compile-time **false positive**: a returned plain
`{ name, message }` object is structurally indistinguishable from an `Error`
and is rejected. It's this library's own flagship hazard's shape, so the cost
is paid on purpose; the fix is to restructure the return
(`{ ok: false, reason: string }`) — which is the right move for prod anyway.

## When checks run

The runtime layer **warns; it never throws and never alters your values**. A
check that threw would manufacture a third behavior — crashing in dev where
prod merely corrupts — breaking the tool's own promise to mirror the boundary.
For CI gates: scrape the `console.error` output, or call the predicates
directly. (A `throw` mode for CI fail-fast may come later; deliberately not
shipped now.)

Checks are **force-off in production builds, overridable by nothing**: this
library has no code path that runs in a production build.
`process.env.NODE_ENV === 'production'` is folded in by the bundler (the same
mechanism React's own dev warnings use), so the walker never executes — and
the calling branch is dead code in prod bundles. An explicit `mode: 'warn'`
passed in a production build is silently ignored, by design.

Within dev/test runs, `mode` opts you down:

```ts
serverFunction(fn, { mode: 'off' })             // silence runtime checks
serverFunction.unchecked(fn)                    // skip the static walk; runtime still checks
serverFunction.unchecked(fn, { mode: 'off' })   // full silence — justify it in a comment
```

`unchecked` is for when the **compile-time walk** is wrong about your
function: the `{ name, message }` false positive above, a Server Function
value passed through (docs-supported, runtime-accepted — but a server
reference is typed as a plain function, so the static walk can't tell it from
the callback hazard), or a declared shape past TypeScript's comparison budget
where `TS2321` fires while the brand is being *computed*. Treat it like
`eslint-disable`: pair it with a comment saying why.

## What the type layer can't see

The runtime layer exists because types fundamentally cannot check: value
validity (an invalid `Date` is still `Date`), runtime class instances typed
through data-only interfaces (the runtime is *stricter* here: `new Point(1,2)`
with no methods passes the walk, fails the runtime prototype check),
throwing getters, symbol registration (`Symbol.for` vs not), and anything
widened through `any` / `unknown` / `Record<string, unknown>`. The walk runs
on *declared* types, so honest annotations like `(): Todo | Error` are still
caught — only deliberately opaque widenings escape.

## The predicates

The core predicates — `canPassFromClientToServer(value)` and
`canPassFromServerToClient(value)`, both `Promise<boolean>` over the
arrives-intact question — are exported for building your own checks,
serializers, lint rules, or CI gates, along with `isSerializablePrimitive`
for the leaf test. Note they answer the docs-and-reality contract for *plain
Flight* — the same question your app's values face under Next.

## Status

Early. The behavioral claims in the matrix aren't folklore — they're pinned
by the characterization suite in [`characterization/`](./characterization),
which runs the exact React Flight serializer at an explicit version and
records what actually crosses the boundary in dev and prod builds, in both
directions, over Next's real action-encode path. When React changes, that
suite changes first — and the library's rules follow.
