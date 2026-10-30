import isPlainObject from 'is-plain-obj'
import type { ReactNode } from 'react'
import * as ReactIs from 'react-is'

export type SerializablePrimitive =
  | string
  | number
  | bigint
  | boolean
  | undefined
  | null
  // symbol is overly broad and not always serializable, but keep the types loose
  | symbol

// https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/TypedArray#typedarray_objects
type TypedArray =
  | Int8Array
  | Uint8Array
  | Uint8ClampedArray
  | Int16Array
  | Uint16Array
  | Int32Array
  | Uint32Array
  | Float16Array
  | Float32Array
  | Float64Array
  | BigInt64Array
  | BigUint64Array

export type SerializableIterable =
  | Array<SerializablePrimitive>
  | ReadonlyArray<SerializablePrimitive>
  | Map<SerializablePrimitive, SerializablePrimitive>
  | ReadonlyMap<SerializablePrimitive, SerializablePrimitive>
  | Set<SerializablePrimitive>
  | ReadonlySet<SerializablePrimitive>
  | ArrayBuffer
  | TypedArray

type SerializableValue = SerializablePrimitive | SerializableIterable | Date

// Try to enforce
// https://react.dev/reference/rsc/use-server#serializable-parameters-and-return-values
type ClientToServerSerializableSyncValue =
  | SerializableValue
  | FormData
  | Record<string, SerializableValue>
  // this is overly broad and not always serializable, but keep the types loose
  | { }

export type ClientToServerSerializableValue =
  | ClientToServerSerializableSyncValue
  | Promise<ClientToServerSerializableSyncValue>

// Try to enforce https://react.dev/reference/rsc/use-client#serializable-types
type ServerToClientSerializableSyncValue =
  | SerializableValue
  | Record<string, SerializableValue>
  | ReactNode
  // this is overly broad and not always serializable, but keep the types loose
  | { }

export type ServerToClientSerializableValue =
  | ServerToClientSerializableSyncValue
  | Promise<ServerToClientSerializableSyncValue>

// ---------------------------------------------------------------------------
// Compile-time boundary checks.
//
// The unions above bottom out in `{ }` and so accept nearly anything. These
// walkers instead DERIVE the check from the value's own inferred type: walk
// the shape, replacing members that cannot cross the boundary with `never`,
// then require the original type to still be assignable to its walked form.
// The check lives in an intersection on the `fn` parameter (not in a generic
// constraint — `T extends Walk<T>` is banned by TS2313, and a constraint's
// contravariance would flip `never` back to permissive for arguments; nor as
// a spread-parameter check like `...checks: [] | [error]`, whose deferred
// conditional can't be proven to accept the empty spread by generic
// pass-through functions). The brand runs on the DECLARED type: an annotated
// or union return like `(): Todo | Error` is still rejected — only
// deliberately opaque widenings (`any`, `unknown`, `Record<string, unknown>`)
// escape.
//
// What this catches: functions/callbacks anywhere (including class methods,
// URL.toJSON, callable interfaces); the whole instanceof-Error family in
// return position (dev-rebuilt, prod-opaque — the flagship hazard);
// FormData going server->client; WeakMap/WeakSet; DataView and other
// undocumented-but-working types (docs-gate: React hasn't promised them);
// known structural impostors (URLSearchParams poses as a ReadonlyMap; Buffer
// poses as a Uint8Array when @types/node is present).
//
// Nested Promises PASS at any depth in both directions (pinned by the
// characterization value matrix: Flight resolves/streams them faithfully),
// so the walkers carry PromiseLike members through rather than banning them.
//
// What it cannot catch (runtime checks remain the backstop): invalid Dates
// (`new Date('nope')` crosses as `null`), runtime class instances typed via
// data-only interfaces, throwing getters, symbol-keyed members, Server
// Function VALUES (a server reference is typed as a plain function — the
// runtime tag check accepts them; here they stay a documented false
// positive with `.unchecked` as the escape), symbol registration (whether a
// given runtime symbol was made via `Symbol.for` is invisible to types), and
// values widened through
// `any`/`unknown` annotations. One deliberate FALSE POSITIVE: a return value
// shaped exactly `{ name, message }` is indistinguishable from `Error` — a
// structural type system's irreducible limit; annotate or restructure (which
// is the right fix for prod anyway).
// ---------------------------------------------------------------------------

type BoundaryLeaf =
  | string
  | number
  | bigint
  | boolean
  | symbol // overly broad (only registered symbols cross, and never as args) but kept loose
  | null
  | undefined
  | void

// lib.dom classes that structurally satisfy the built-in arms below and
// would otherwise walk as legitimate: URLSearchParams is structurally a
// ReadonlyMap<string, string | null>, Buffer (when @types/node is in scope)
// is structurally a Uint8Array, and DataView is an ArrayBufferView — yet
// React's serializable-types lists name only Map/Set/Array, TypedArray +
// ArrayBuffer, and FormData (args only). Measured: DataView crosses fine in
// 19.3.1, but "works today, un-promised" ⇒ rejected per the admission rule.
// They must be rejected before the Date/ArrayBuffer/Map/Set/FormData arms get
// a chance to wave them through.
type BoundaryImpostors =
  | URLSearchParams
  | { readUInt8 (...args: any[]): any }
  | DataView

// Client -> server (arguments). Errors are NOT rejected here: as arguments
// they fail loudly at encode in the bare path, and arrive as opaque
// placeholders under Next's temp-ref path (characterization value matrix) —
// either way a structural ban would add only the `{ name, message }`
// lookalike false positive without new signal. Promises are carried at any
// depth (measured: the encoder awaits them; the server gets live thenables).
type ClientToServerSync<T> =
  T extends BoundaryLeaf ? T
    : T extends (...args: never[]) => unknown ? never
      : T extends abstract new (...args: never[]) => unknown ? never
        : T extends BoundaryImpostors ? never
          : T extends PromiseLike<infer V> ? PromiseLike<ClientToServerSync<V>>
            : T extends Date ? T
              : T extends ArrayBuffer | ArrayBufferView ? T
                : T extends FormData ? T
                  : T extends Map<infer K, infer V> ? Map<ClientToServerSync<K>, ClientToServerSync<V>>
                    : T extends ReadonlyMap<infer K, infer V> ? ReadonlyMap<ClientToServerSync<K>, ClientToServerSync<V>>
                      : T extends Set<infer V> ? Set<ClientToServerSync<V>>
                        : T extends ReadonlySet<infer V> ? ReadonlySet<ClientToServerSync<V>>
                          : T extends WeakMap<object, unknown> ? never
                            : T extends WeakSet<object> ? never
                            // homomorphic mapped type: preserves optionality, readonly, index
                            // signatures, arrays/tuples; recurses one member level at a time.
                              : T extends object ? { [K in keyof T]: ClientToServerSync<T[K]> }
                              // any / unknown: opaque. The runtime check is the backstop.
                                : unknown extends T ? T
                                  : never

type ClientToServerArgument<T> =
  T extends PromiseLike<infer V> ? PromiseLike<ClientToServerSync<V>>
    : ClientToServerSync<T>

// Server -> client (return values). Errors collapse (silently opaque in
// prod — the reason this library exists). ReactNode passes wholesale:
// ReactElement.type legitimately holds function types, and what Flight does
// with element internals is React's own concern. FormData cannot cross this
// direction per the docs (it measures working in 19.3.1 — un-promised).
// Promises cross at any depth as live thenables.
type ServerToClientSync<T> =
  T extends Error ? never
    : T extends BoundaryLeaf ? T
      : T extends (...args: never[]) => unknown ? never
        : T extends abstract new (...args: never[]) => unknown ? never
          : T extends BoundaryImpostors ? never
            : T extends PromiseLike<infer V> ? PromiseLike<ServerToClientSync<V>>
              : T extends ReactNode ? T
                : T extends Date ? T
                  : T extends ArrayBuffer | ArrayBufferView ? T
                    : T extends FormData ? never
                      : T extends Map<infer K, infer V> ? Map<ServerToClientSync<K>, ServerToClientSync<V>>
                        : T extends ReadonlyMap<infer K, infer V> ? ReadonlyMap<ServerToClientSync<K>, ServerToClientSync<V>>
                          : T extends Set<infer V> ? Set<ServerToClientSync<V>>
                            : T extends ReadonlySet<infer V> ? ReadonlySet<ServerToClientSync<V>>
                              : T extends WeakMap<object, unknown> ? never
                                : T extends WeakSet<object> ? never
                                  : T extends object ? { [K in keyof T]: ServerToClientSync<T[K]> }
                                    : unknown extends T ? T
                                      : never

type ServerToClientReturn<T> =
  T extends PromiseLike<infer V> ? PromiseLike<ServerToClientSync<V>>
    : ServerToClientSync<T>

type WalkedArguments<Args extends readonly unknown[]> = { [K in keyof Args]: ClientToServerArgument<Args[K]> }

// Tuple-wrapped comparisons are NON-distributive on purpose. Bare
// `Ret extends Walk<Ret>` distributes per union member, so a valid member
// produces the passing branch and the spread/intersection check never
// fires for `Todo | Error`.
type BoundaryViolation<Args extends readonly unknown[], Ret> =
  [Args] extends [WalkedArguments<Args>]
    ? [Ret] extends [ServerToClientReturn<Ret>]
      // the "clean" brand: an optional property nothing has, so every
      // function remains assignable to it
        ? { readonly __willItServerBoundaryOk?: never }
        : { readonly __willItServerReturnHazard: 'will-it-server: this return type cannot survive the server->client boundary intact (see the will-it-server README boundary matrix for detail)' }
    : { readonly __willItServerArgsHazard: 'will-it-server: these argument types cannot cross the client->server boundary (see the will-it-server README boundary matrix for detail)' }

// ---------------------------------------------------------------------------
// Runtime checks.
//
// The predicate semantics are "ARRIVES INTACT", not "crosses at all":
// values that hard-fail, arrive degraded (Error → opaque stand-in in prod),
// or arrive silently corrupted (URL → string, invalid Date → null, symbol
// members → dropped) are all rejected — flagged in every dev/test run, in
// every hazard class, wherever types can't see.
//
// Admission rule: documented-as-supported (the react.dev serializable-type
// lists linked above) ∧ measured-to-arrive-intact (the characterization
// value matrix, pinned at react-server-dom-webpack 19.3.1). Reality vetoes
// the docs where reality is worse (registered symbols as ARGS arrive as
// opaque placeholders despite the docs); the docs veto reality where reality
// is more generous (FormData-returns, DataView, bare File/Blob, Readable-
// Streams, async iterables — all work today, none are promised).
//
// Direction-specific findings encoded below (all pinned by
// characterization/test/flightValueMatrix.test.js):
// - Args travel Next's TemporaryReferenceSet path: unknown objects (classes,
//   Errors, elements, symbols, even plain functions) do NOT throw at encode —
//   they arrive server-side as opaque throw-on-touch proxies. Only documented
//   types are safe.
// - Promises: the encoder awaits them at any depth (so the args walk awaits
//   too — a rejected member sinks the whole call, matching Flight); the
//   return side streams them as live thenables, so member promises are
//   probed settled-only — never awaited — because deliberately-unsettled
//   members are the documented streaming pattern.
// - Cycles and shared references round-trip with object identity restored.
//   The walk's seen-set is for WALKER termination only, never a rejection.
// - Functions are rejected EXCEPT registered Server Functions
//   ($$typeof === Symbol.for('react.server.reference')): the encoder's $h
//   branch carries them as live callables in both directions (docs support
//   them; the opaque temp-ref path never swallows them).
// ---------------------------------------------------------------------------

const SERVER_REFERENCE_TAG = Symbol.for('react.server.reference')
// Flight's own "objects with symbol properties are not serialized" territory:
// enumerable symbol-keyed members are dropped from the wire in both
// directions, silently in prod. See walkObject.
const asyncIteratorSymbol = (Symbol as unknown as { asyncIterator?: symbol }).asyncIterator

function isServerFunctionValue (value: unknown): boolean {
  return typeof value === 'function' &&
    (value as { $$typeof?: symbol }).$$typeof === SERVER_REFERENCE_TAG
}

function isThenable (value: unknown): value is PromiseLike<unknown> {
  return value != null && typeof (value as PromiseLike<unknown>).then === 'function'
}

// Duck-typing rather than instanceof so the lib needs no "dom" build:
// these categories are REJECTED either way (docs-gate), and a mis-duck in a
// weird environment degrades to "flag something that would have failed
// anyway", never to a missed hazard... except that it could miss — so keep
// the shapes tight and documented by the value matrix.
function isBlobLike (value: object): boolean {
  const c = value as { arrayBuffer?: unknown, text?: unknown, size?: unknown, type?: unknown }
  return typeof c.arrayBuffer === 'function' && typeof c.text === 'function' &&
    typeof c.size === 'number' && typeof c.type === 'string'
}

function isReadableStreamLike (value: object): boolean {
  const c = value as { getReader?: unknown, locked?: unknown }
  return typeof c.getReader === 'function' && typeof c.locked === 'boolean'
}

function isAsyncIterableLike (value: object): boolean {
  return asyncIteratorSymbol != null &&
    typeof (value as Record<symbol, unknown>)[asyncIteratorSymbol] === 'function'
}

function isBufferLike (value: object): boolean {
  // Node Buffer: a Uint8Array subclass carrying legacy read/write methods
  // that serializes through toJSON to {type:'Buffer',data:[...]} — a
  // measured corruption (finding 4).
  return value instanceof Uint8Array &&
    typeof (value as { readUInt8?: unknown }).readUInt8 === 'function'
}

type WalkDirection = 'clientToServer' | 'serverToClient'

// Settledness probe for promise MEMBERS on the return side. Two microtask
// hops give an already-settled promise's reaction jobs time to run without
// ever blocking on a promise the app may be deliberately streaming. A
// promise that settles mid-probe is fine to observe — either outcome
// (settled ⇒ inspect; pending ⇒ accept unverified) is sound.
async function probeMemberPromise (promise: PromiseLike<unknown>): Promise<
  { settled: false } | { settled: true, ok: true, value: unknown } | { settled: true, ok: false }
> {
  return Promise.race([
    Promise.resolve(promise).then(
      (value) => ({ settled: true as const, ok: true as const, value }),
      () => ({ settled: true as const, ok: false as const })
    ),
    Promise.resolve().then(() => Promise.resolve().then(() => ({ settled: false as const }))),
  ])
}

function walkPrimitive (value: unknown, direction: WalkDirection): boolean | null {
  if (value === null || value === undefined) return true
  switch (typeof value) {
    case 'string':
    case 'number': // NaN, Infinity, -0 all arrive exactly (pinned)
    case 'bigint':
    case 'boolean':
      return true
    case 'symbol':
      // Return side: Flight carries Symbol.for values as symbols (measured).
      // Args side: EVERY symbol — registered or not — arrives as an opaque
      // temp-ref placeholder under Next's path (measured; the docs' claim to
      // the contrary is reality-vetoed).
      if (direction === 'clientToServer') return false
      return Boolean(Symbol.keyFor(value))
    case 'function':
      return isServerFunctionValue(value)
    default:
      return null
  }
}

async function walkValue (
  value: unknown,
  direction: WalkDirection,
  seen: WeakSet<object>
): Promise<boolean> {
  const primitive = walkPrimitive(value, direction)
  if (primitive !== null) return primitive

  if (isThenable(value)) {
    if (direction === 'clientToServer') {
      // The encoder awaits promise args itself; awaiting here mirrors it.
      // A rejection sinks the entire action call (measured, both modes).
      // Recursing through walkValue flattens promise-of-promise chains,
      // exactly like `await` does for the app.
      let resolved: unknown
      try {
        resolved = await Promise.resolve(value)
      } catch {
        return false
      }
      return await walkValue(resolved, direction, seen)
    }
    // Return side: a promise MEMBER streams — never await it. Probe
    // settledness; unsettled members pass unverified (documented
    // streaming pattern), settled ones get their contents inspected.
    const probe = await probeMemberPromise(value)
    if (!probe.settled) return true
    if (!probe.ok) return false // arrives rejected; reason opaque in prod
    return await walkValue(probe.value, direction, seen)
  }

  if (value === null || typeof value !== 'object') return false

  // Cycles / shared refs: arrive intact with identity restored, so a repeat
  // visit is a PASS, not a rejection. The set exists purely so the walk
  // terminates (the pre-rewrite walk stack-overflowed on `o.self = o`).
  if (seen.has(value)) return true
  seen.add(value)

  if (value instanceof Date) {
    // Measured: an invalid Date arrives as `null` — silently, both modes,
    // both directions. Closes the false negative in the old `instanceof
    // Date` arm.
    return !Number.isNaN(value.getTime())
  }

  if (value instanceof Error) {
    // Return side: dev rebuilds from {name, message, stack} only, prod
    // swaps the opaque stand-in (the flagship). Args side: opaque
    // placeholder under Next's path. Neither "arrives intact".
    return false
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      if (!await walkValue(item, direction, seen)) return false
    }
    return true
  }

  if (value instanceof Map) {
    for (const [k, v] of value) {
      if (!await walkValue(k, direction, seen)) return false
      if (!await walkValue(v, direction, seen)) return false
    }
    return true
  }

  if (value instanceof Set) {
    for (const item of value) {
      if (!await walkValue(item, direction, seen)) return false
    }
    return true
  }

  // Binary: ArrayBuffer + typed arrays are docs-listed and measured intact.
  // DataView also measures intact — but is NOT docs-listed ⇒ rejected
  // ("works today, un-promised"). Buffer is corruption ⇒ rejected.
  if (value instanceof DataView) return false
  if (value instanceof ArrayBuffer) return true
  if (ArrayBuffer.isView(value)) return !isBufferLike(value)

  if (value instanceof FormData) {
    // Args: docs-listed, measured intact nested at any depth (File entries
    // keep name+size). Returns: props list has no FormData (class-instance
    // catch-all) — measured working in 19.3.1, un-promised ⇒ rejected.
    return direction === 'clientToServer'
  }

  if (value instanceof RegExp || value instanceof WeakMap || value instanceof WeakSet) {
    return false
  }

  // Undocumented-but-working categories, rejected per the docs gate: bare
  // Blob/File (identity quirk both ways), ReadableStream + async iterables.
  if (isBlobLike(value) || isReadableStreamLike(value) || isAsyncIterableLike(value)) {
    return false
  }

  if (ReactIs.isElement(value)) {
    // Elements (JSX) are docs-listed for props/returns and measured crossing
    // nested at any depth. Return side: accepted wholesale, mirroring the
    // type layer's ReactNode arm — ReactElement.type legitimately holds
    // functions, and element internals are React's own render-time concern.
    // Args side: opaque placeholders (measured under Next's temp-ref path).
    return direction === 'serverToClient'
  }

  if (isPlainObject(value) && Object.getPrototypeOf(value) !== null) {
    return await walkObject(value as Record<PropertyKey, unknown>, direction, seen)
  }

  // Anything else — class instances, null-prototype objects, exotic objects —
  // is a hard fail S→C (measured: "Only plain objects..." in both modes) and
  // an opaque placeholder C→S (measured under Next's temp-ref path).
  return false
}

async function walkObject (
  value: Record<PropertyKey, unknown>,
  direction: WalkDirection,
  seen: WeakSet<object>
): Promise<boolean> {
  // toJSON-bearing objects arrive as their JSON.stringify replacement in
  // BOTH directions (measured; React dev console.errors, prod never warns).
  // Buffer and URL are the classic instances — both corrupt, both rejected.
  if (typeof value.toJSON === 'function') return false

  // Flight walks own enumerable STRING keys only; symbol-keyed members are
  // dropped from the wire silently (measured both directions). The object
  // arrives, minus your member: that's corruption ⇒ flag.
  for (const sym of Object.getOwnPropertySymbols(value)) {
    const desc = Object.getOwnPropertyDescriptor(value, sym)
    if (desc?.enumerable) return false
  }

  for (const key of Object.keys(value)) {
    let member: unknown
    try {
      member = value[key]
    } catch {
      // Throwing getters: Flight touches getters during serialization and
      // sinks the render AND the encode itself (measured, both modes). The
      // check must report the hazard, never crash on it.
      return false
    }
    if (!await walkValue(member, direction, seen)) return false
  }
  return true
}

// Try to enforce
// https://react.dev/reference/rsc/use-server#serializable-parameters-and-return-values
export async function canPassFromClientToServer (value: unknown): Promise<boolean> {
  return await walkValue(value, 'clientToServer', new WeakSet())
}

// Try to enforce https://react.dev/reference/rsc/use-client#serializable-types
export async function canPassFromServerToClient (value: unknown): Promise<boolean> {
  // Top-level promises are awaited (they ARE the app's result — the caller
  // is about to await it anyway). A rejection propagates, matching the
  // pre-existing contract.
  const resolvedValue = isThenable(value) ? await Promise.resolve(value) : value
  return await walkValue(resolvedValue, 'serverToClient', new WeakSet())
}

export type CheckMode = 'off' | 'warn'

export interface ServerFunctionOptions {
  /**
   * `'warn'` (the default) console.errors on values that won't arrive
   * intact; `'off'` silences the runtime checks. A `'throw'` mode may be
   * added later for CI fail-fast — deliberately not shipped yet.
   *
   * Production builds FORCE checks off: this library has no code path that
   * RUNS in a production build. The literal `process.env.NODE_ENV`
   * comparison below is bundler-folded, and the residual `typeof process`
   * guard is true on a Node server, so the walker short-circuits before it
   * executes. The guarantee is behavioral, not about bundle content: the
   * `typeof process` term can't be folded statically, so prod server chunks
   * may ship the walker inert — present, but never firing.
   */
  mode?: CheckMode
}

function checksActive (options?: ServerFunctionOptions): boolean {
  if (typeof process !== 'undefined' && process.env.NODE_ENV === 'production') {
    return false
  }
  return options?.mode !== 'off'
}

function checkedServerFunction<
  Args extends readonly unknown[],
  Ret
> (
  fn: ((...args: Args) => Ret) & BoundaryViolation<Args, Ret>,
  options?: ServerFunctionOptions
): (...receivedArgs: Args) => Promise<Awaited<Ret>> {
  return async (...receivedArgs: Args): Promise<Awaited<Ret>> => {
    if (!checksActive(options)) {
      return Promise.resolve(fn(...receivedArgs))
    }

    if (!await canPassFromClientToServer(receivedArgs)) {
      console.error(
        'will-it-server: Server function was called with arguments that will ' +
        'not safely cross the client->server boundary (see the ' +
        'will-it-server README boundary matrix for detail).'
      )
    }
    const result = fn(...receivedArgs)
    if (!await canPassFromServerToClient(result)) {
      console.error(
        'will-it-server: Server function returned a value that will not ' +
        'safely cross the server->client boundary (see the will-it-server ' +
        'README boundary matrix for detail).'
      )
    }
    return Promise.resolve(result)
  }
}

// Escape hatch for when the compile-time walk is WRONG about your function —
// the documented false positives (a returned `{ name, message }` that is a
// chat message, not an Error; a Server Function VALUE passed as an arg or
// return, which is docs-supported and runtime-accepted but untypeable) and
// pathological cases (declared nesting beyond TypeScript's comparison
// budget, where TS2321 fires while the brand is being *computed* and no cast
// can dodge it).
//
// What this skips: the static walk only. The wrapper keeps every other type
// (argument arity/order/labels, awaited return). The RUNTIME checks are not
// skipped — the boundary still console.errors what actually crosses, unless
// `mode: 'off'` is passed. This is an assertion that the type layer is
// mistaken about this function, not that the boundary is safe. Pair every
// use with a comment saying which; that discipline is policy, not
// enforcement, and is deliberate: a per-call opt-out the user must *justify*
// in review is better than a type-only escape (a cast erased from the
// bundle, ungreppable in audits) or a second overload (muddying every
// legitimate error message with two-branch noise).
function uncheckedServerFunction<
  Args extends readonly unknown[],
  Ret
> (
  fn: (...args: Args) => Ret,
  options?: ServerFunctionOptions
): (...receivedArgs: Args) => Promise<Awaited<Ret>> {
  // the contained `as any` is load-bearing: it skips assignability to the
  // deferred BoundaryViolation (a generic-context pass-through cannot prove
  // itself against a deferred brand), while the explicit type args pin the
  // wrapper signature, so callers keep full types
  return checkedServerFunction<Args, Ret>(fn as any, options)
}

export const serverFunction = Object.assign(checkedServerFunction, {
  unchecked: uncheckedServerFunction
})

export function isSerializablePrimitive (
  value: unknown
): value is SerializablePrimitive {
  return (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'bigint' ||
    typeof value === 'boolean' ||
    typeof value === 'undefined' ||
    value === null ||
    (typeof value === 'symbol' && Boolean(Symbol.keyFor(value)))
  )
}
