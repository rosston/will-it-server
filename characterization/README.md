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
- `test/flightErrorFamily.test.js` — the fuzz sweep's findings, pinned: the
  divergence covers the whole `instanceof Error` family (TypeError,
  DOMException, AggregateError, subclasses, errors behind promises); dev
  rebuilds them from `{name, message, stack}` only — subclass identity and
  custom fields are lost even in dev. Rejected promises are loud in both
  modes but prod hides the reason. Other silent corruptions (URL→string,
  invalid Date→null, Buffer→`{type:'Buffer',data}`) behave the same in both
  modes. Arguments fail at encode time symmetrically. Headline invariant:
  nothing flips success/failure across modes — only Error-bearing returns
  diverge in content. (Note: the arguments pins here characterize the BARE
  Flight encode path — see the next bullet for what Next actually does.)
- `test/flightValueMatrix.test.js` — the value matrix: 40
  values probed in BOTH directions × dev/prod, plus a `serverRefs` section
  for Server-Function VALUES. Pins: nested promises cross as live thenables
  both ways; cycles/shared refs round-trip with identity
  restored; FormData crosses both directions (nested included); binary types
  (ArrayBuffer/typed arrays/DataView/Blob/File/ReadableStream/async
  iterables) cross with ctors intact; symbol-KEYED members are silently
  dropped; registered symbols pass S→C but never as args; invalid Dates
  arrive `null` both ways; throwing getters sink everything; Error VALUES
  as args arrive opaque under refs. Server-Function values are the one
  function class that crosses cleanly: `$h` handles that decode into live,
  tagged callables (`$$typeof === Symbol.for('react.server.reference')`).
  Its ARG probes
  mimic Next's real action path (client `encodeReply` with a fresh
  TemporaryReferenceSet, server decode with its own) — which turns the
  "loud encode failure" class into SILENT opaque placeholders: classes,
  elements, symbols, Errors, even functions arrive server-side as
  throw-on-touch proxies instead of erroring client-side.
- `test/fixtures/flight-error-roundtrip.js` — drives the actual
  `react-server-dom-webpack` serializer and deserializer for both builds
  (via `NODE_ENV`, the same mechanism Next.js uses) in both directions
  (server→client returns, client→server args) and reports what the client
  side ends up with. Its `matrix` section uses the Next-faithful
  temp-references arg path; the older `args` section keeps the bare path.
  The `serverRefs` section decodes `$h` handles through a simulated
  server-reference manifest (`test/fixtures/server-ref-target.js` plays the
  part of a `'use server'` module, registering its exports the way Next's
  codegen does).

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

## If you write browser-targeted tests: message text differs by client build

The prod opaque stand-in error's `message` is not one string.
`client.node.production.js` keeps the literal sentence ("An error occurred in
the Server Components render..."), but browser-targeted bundles — npm's
`client.browser.production.js` **and** Next's bundled client — generate it via
`formatProdErrorMessage(441)`, so a real browser shows "Minified React error
#441; visit https://react.dev/errors/441..." (code 441 maps to the literal
text). This suite decodes with the node client; any test that asserts decoded
error text must know which client build decoded the wire.
