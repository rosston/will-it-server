# characterization

Characterization tests for `will-it-server`.

Unlike `test/` at the repo root — which checks *this library's* logic — this
suite pins down how **React itself** behaves today, so the library's rules can
be validated against real-world behavior and re-checked when versions move.

## What's here

- `test/flightReturnedError.test.js` — what happens when a server function
  **returns** (rather than throws) an `Error`, through React Flight's
  dev-vs-prod serialization. Summary: dev delivers the real error to the
  client component; production silently replaces it with an opaque stand-in.
  Same app code, different outcomes — the class of bug that only surfaces
  after deploy.
- `test/fixtures/flight-error-roundtrip.js` — drives the actual
  `react-server-dom-webpack` serializer and deserializer for both builds
  (via `NODE_ENV`, the same mechanism Next.js uses) and reports what the
  client side ends up with.

## Why exact version pins

`react`, `react-dom`, and `react-server-dom-webpack` are pinned to exact
versions, deliberately: this suite asserts *observed* behavior of *those*
versions (message strings, wire format, dev/prod divergence), not any
guaranteed React API. The three must stay in lockstep with *each other* —
they ship as one React release and Flight depends on matching internals —
but nothing here is chained to `examples/next-15`. The pins say "which
reality we observed"; they may lead or lag the example apps on purpose.
Bumping a pin here is a cheap way to learn what a newer React does to server
function serialization before any app stack has to move.

When you bump the pins: run the suite, read any failures as "here's what
React changed," then update the assertions to the new truth — and check
whether the library's accept/reject rules in `src/` need updating too.

## Running

From the repo root, `npm test` runs this suite as its own line item.
Directly:

```sh
npm install --prefix characterization
npm test --prefix characterization
```

The suite runs its fixture with `--conditions react-server` — the same
export condition Next.js sets for its server builds. It's not optional:
`react-server-dom-webpack/server.node` throws at load unless `react`
resolves to its server entry (`"react-server" condition must be enabled`).
Any Node version new enough for the pinned React works
(Next 15: Node 18.18+; Next 16: Node 20.9+); the flag itself predates that
(`--conditions` exists since Node 12.19/14.9, and is non-experimental as of
Node 22.9).
