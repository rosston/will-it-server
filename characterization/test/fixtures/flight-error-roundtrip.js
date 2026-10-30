// Reproduces how Next.js serializes values across the RSC boundary through
// React Flight (`react-server-dom-webpack`): return values (server -> client,
// rendered with renderToPipeableStream and decoded with createFromNodeStream)
// and arguments (client -> server, encoded with encodeReply and decoded with
// decodeReply) — exactly the machinery Next uses for server functions.
//
// Next.js runs the *same* serializer in production (`next build && next start`)
// and development (`next dev`); the build is picked by NODE_ENV. This fixture is
// spawned once with NODE_ENV=development and once with NODE_ENV=production so a
// test can compare the two.
//
// Usage: node --conditions react-server test/fixtures/flight-error-roundtrip.js
// (the react-server condition is required by the Flight server build, exactly
// like Next.js configures it when bundling server code)
//
// Prints a JSON object with sections:
//   cases     — the core repro (top-level Error, nested Error, class instance);
//               this section's field names are the historical contract used by
//               flightReturnedError.test.js
//   family    — everything `instanceof Error` + rejected promises (server -> client)
//   symmetric — corruptions that behave the SAME in dev and prod
//   args      — client -> server arguments
//   matrix    — value matrix: every value probed in BOTH directions
//               ({ ret, arg }); pinned by flightValueMatrix.test.js.
//               NOTE: the arg probes mimic Next's REAL action path — both
//               Next 15 and 16 create a client-side TemporaryReferenceSet and
//               pass it to encodeReply (see server-action-reducer.js), and the
//               server decodes with its own fresh set (action-handler.js).
//               With refs, unknown objects (classes, Errors, elements, any
//               symbol) encode as opaque "$T" placeholders instead of
//               throwing client-side — unlike the bare path pinned in `args`.
//   serverRefs — Server-Function VALUES (docs: supported both directions):
//               $h handles with manifest metadata; decode into live tagged
//               callables ($$typeof react.server.reference), NOT opaque refs.
//   logs      — React's dev-build console noise (prod builds log nothing here)
'use strict'

const { PassThrough } = require('node:stream')
const path = require('node:path')
const React = require('react')
// react-server-dom-webpack's manifest resolution assumes the bundler runtime
// (Next/Turbopack provide it); emulate it so $h server-reference handles can
// resolve to real modules in this bare-Node fixture.
if (typeof globalThis.__webpack_require__ === 'undefined') {
  globalThis.__webpack_require__ = (id) => require(id)
}
const { renderToPipeableStream, decodeReply, createTemporaryReferenceSet: createServerTempRefs, registerServerReference } = require('react-server-dom-webpack/server.node')
const { createFromNodeStream } = require('react-server-dom-webpack/client.node')
const { encodeReply, createTemporaryReferenceSet: createClientTempRefs, createServerReference: createClientServerRef } = require('react-server-dom-webpack/client.edge')

// Next-equivalent server-reference manifest (what the action handler injects
// into decodeReply): action id -> module + export name.
const SERVER_REF_MANIFEST = {
  'fixture:ref': {
    id: path.join(__dirname, 'server-ref-target.js'),
    name: 'fixtureAction',
    chunks: [],
  },
}

// Capture React's dev-build console noise so stdout stays pure JSON.
const logs = []
for (const kind of ['error', 'warn']) {
  console[kind] = ((k) => (...a) => { logs.push([k, String(a[0]).slice(0, 180)]) })(kind)
}

const ERROR_MESSAGE = 'could not complete the todo'

function makeError () {
  const error = new Error(ERROR_MESSAGE)
  // custom fields are common in returned "result" errors:
  error.code = 'E_TODO'
  return error
}

class TodoValidationError {
  constructor (message) {
    this.message = message
  }
}

class ValidationError extends Error {}

// -- core repro cases (shape consumed by flightReturnedError.test.js) --------
const cases = {
  // 1. The value returned is an Error (not thrown).
  topError: () => makeError(),
  // 2. The Error is a field of an otherwise serializable object
  //    (the { ok: false, error } pattern).
  nestedError: () => ({ ok: false, error: makeError() }),
  // 3. A plain (non-Error) class instance — the hard "unserializable" case.
  classInstance: () => new TodoValidationError(ERROR_MESSAGE),
}

// -- the rest of the Error family + the rejected-promise variant -------------
const familyCases = {
  typeError: () => new TypeError(ERROR_MESSAGE),
  domException: () => new DOMException(ERROR_MESSAGE, 'AbortError'),
  aggregateError: () => new AggregateError([new Error('inner')], ERROR_MESSAGE),
  customErrorSubclass: () => new ValidationError(ERROR_MESSAGE),
  promiseResolvedError: () => Promise.resolve(makeError()),
  rejectedPromise: () => Promise.reject(makeError()),
}

// -- corruptions that behave the SAME in both modes ---------------------------
const symmetricCases = {
  url: () => new URL('https://example.com/p'),
  invalidDate: () => new Date('nope'),
  nodeBuffer: () => Buffer.from([1, 2]),
  objectWithToJSON: () => ({ toJSON: () => 'replaced' }),
}

// -- client -> server arguments ----------------------------------------------
const argCases = {
  plainObject: () => ({ ok: true }),
  errorArg: () => makeError(),
  functionArg: () => function noop () {},
  classInstanceArg: () => new TodoValidationError(ERROR_MESSAGE),
  urlArg: () => new URL('https://example.com/q'),
}

// -- value matrix --------------------------------------------------------------
// Every value here is probed in BOTH directions ({ ret: server->client,
// arg: client->server }) by dedicated helpers; the fresh-factory call per
// direction keeps cycles and one-shot streams honest.
const matrixCases = {
  // Dates
  invalidDate: () => new Date('nope'),
  validDate: () => new Date(1234567890000),

  // Nested promises
  promiseInObject: () => ({ p: Promise.resolve('inner'), plain: 1 }),
  promiseInArray: () => [Promise.resolve('a'), 'b'],
  promiseInMapValue: () => new Map([['k', Promise.resolve('v')]]),
  // pre-attached catch: if the ENCODER never touches this rejection we still
  // must not crash the fixture process with an unhandled rejection.
  rejectedPromiseInObject: () => {
    const p = Promise.reject(new Error('nested-reject'))
    p.catch(() => {})
    return { p }
  },

  // Cycles and shared references
  cycleSelf: () => { const o = { name: 'self' }; o.self = o; return o },
  cycleViaArray: () => { const o = { list: [] }; o.list.push(o); return o },
  sharedRefPair: () => { const s = { x: 1 }; return [s, s] },

  // FormData
  formDataTop: () => { const fd = new FormData(); fd.set('a', 'b'); return fd },
  formDataNested: () => { const fd = new FormData(); fd.set('a', 'b'); return { fd } },

  // React elements
  elementTop: () => React.createElement('div', null, 'hi'),
  elementNested: () => ({ el: React.createElement('span', null, 'in') }),
  elementWithFnProp: () => ({ el: React.createElement('div', { onClick: () => {} }) }),

  // Binary
  arrayBuffer: () => new ArrayBuffer(4),
  uint8Array: () => new Uint8Array([1, 2, 3]),
  dataView: () => new DataView(new ArrayBuffer(4)),

  // File/Blob
  blob: () => new Blob(['hello']),
  file: () => new File(['hello'], 'a.txt'),

  // Other built-ins
  regExp: () => /ab+c/gi,
  weakMap: () => new WeakMap(),
  weakSet: () => new WeakSet(),

  // Object shapes
  nullProto: () => { const o = Object.create(null); o.a = 1; return o },
  symbolKeyedObject: () => ({ [Symbol('hidden')]: 'lost?', visible: 1 }),
  unregisteredSymbolDeep: () => ({ s: Symbol('nope') }),
  registeredSymbolTop: () => Symbol.for('matrix.registered'),
  // Error VALUES as args under Next's temp-ref path (finding 5 pinned only
  // the bare path, where encode throws).
  errorValue: () => makeError(),

  // toJSON (the arg direction is the unmeasured half)
  toJSONObject: () => ({ toJSON: () => 'replaced' }),

  // Class instance with methods, return direction (new half of finding 5)
  classInstanceWithMethod: () => new TodoValidationError('class-method-probe'),

  // Numeric edges
  nan: () => NaN,
  infinity: () => Infinity,
  negativeZero: () => -0,

  // Second measurement round (source dive of the Next temp-ref encode path):
  plainObjectTop: () => ({ ok: true }),
  fnTop: () => function noop () {},
  readableStreamTop: () => new ReadableStream({ start (c) { c.close() } }),
  asyncIterableTop: () => (async function * g () { yield 1; yield 2 })(),
  // Flight touches getters during serialization (in BOTH directions); this
  // pins what happens when one throws.
  throwingGetter: () => ({ ok: 1, get boom () { throw new Error('getter-boom') } }),
  // With temp refs the symbol's registration (Symbol.for vs not) is moot on
  // the encode side: both become $T placeholders. Pin it.
  registeredSymbolInObject: () => ({ s: Symbol.for('matrix.r') }),
  // Date serialization is ISO-only: custom fields are silent casualties.
  dateWithCustomField: () => Object.assign(new Date(1234567890000), { note: 'lost?' }),
  // The realistic upload arg: File identity inside FormData.
  formDataWithFile: () => {
    const fd = new FormData()
    fd.set('f', new File(['x'], 'x.txt', { type: 'text/plain' }))
    return fd
  },
}

// -- legacy shape helpers (do not rename: existing tests depend on these) ----
function describeValue (value) {
  const out = {
    isError: value instanceof Error,
    constructorName: value === null || value === undefined
      ? String(value)
      : value.constructor && value.constructor.name,
  }
  if (value !== null && typeof value === 'object') {
    out.message = typeof value.message === 'string' ? value.message : undefined
    out.code = value.code
    out.stackHasOriginalMessage = typeof value.stack === 'string' && value.stack.includes(ERROR_MESSAGE)
    if ('ok' in value) out.ok = value.ok
    if (value.error !== undefined) {
      out.errorIsError = value.error instanceof Error
      out.errorMessage = value.error && value.error.message
      out.errorCode = value.error && value.error.code
      out.errorStackHasOriginalMessage = Boolean(
        value.error && value.error.stack && String(value.error.stack).includes(ERROR_MESSAGE)
      )
    }
  } else {
    out.message = typeof value.message === 'string' ? value.message : undefined
  }
  return out
}

async function deserializeLegacy (wire) {
  const input = new PassThrough()
  input.end(Buffer.from(wire))
  const decoded = createFromNodeStream(input, {
    moduleMap: {},
    serverModuleMap: {},
    moduleLoading: null,
  })
  try {
    const result = await Promise.race([
      decoded,
      new Promise((_resolve, reject) => setTimeout(() => reject(new Error('__decode-timeout__')), 3000)),
    ])
    return { outcome: 'resolved', value: Array.isArray(result) ? result[0] : result }
  } catch (err) {
    return { outcome: 'rejected', error: String((err && err.message) || err) }
  }
}

// -- richer helpers for the new sections --------------------------------------
function withTimeout (promise, ms = 3000) {
  let to
  return Promise.race([
    Promise.resolve(promise).then(
      (v) => { clearTimeout(to); return { ok: true, v } },
      (e) => { clearTimeout(to); return { ok: false, e } }
    ),
    new Promise((resolve) => { to = setTimeout(() => resolve({ ok: false, timeout: true }), ms) }),
  ])
}

// Attach no-op handlers so rejected promises inside decoded tuples don't crash
// the process with unhandled rejections. Walks plain-object members too (the
// matrix has rejected promises nested in object members), cycle-safe.
function guardUnhandled (v, seen = new Set()) {
  try {
    if (!v || typeof v !== 'object' || seen.has(v)) return
    seen.add(v)
    if (Array.isArray(v)) { v.forEach((x) => guardUnhandled(x, seen)); return }
    if (typeof v.then === 'function') { v.then(() => {}, () => {}); return }
    for (const k of Object.keys(v)) guardUnhandled(v[k], seen)
  } catch (e) {}
}

function describeError (value) {
  return {
    isError: value instanceof Error,
    constructorName: value && value.constructor && value.constructor.name,
    name: value.name,
    message: value.message,
    code: value.code,
    stackHasOriginalMessage: typeof value.stack === 'string' && value.stack.includes(ERROR_MESSAGE),
    errorsCount: Array.isArray(value.errors) ? value.errors.length : undefined,
    digestPresent: typeof value.digest === 'string' && value.digest.length > 0,
    isOpaqueStandIn: typeof value.message === 'string' &&
      /An error occurred in the Server Components render/.test(value.message),
  }
}

function normalizeNumber (value) {
  if (Object.is(value, NaN)) return 'NaN'
  if (Object.is(value, -0)) return '-0'
  if (value === Infinity) return 'Infinity'
  if (value === -Infinity) return '-Infinity'
  return value
}

// Next-style arg encode/decode hands unknown objects back as opaque
// temporary-reference placeholders: a Proxy over a throwing function with
// $$typeof TEMPORARY_REFERENCE_TAG. Any property read (other than $$typeof,
// name, then, toJSON, ...) throws "Cannot access X on the server". Detect
// BEFORE touching anything else on the value.
const TEMP_REF_TAG = Symbol.for('react.temporary.reference')
function isTempRef (v) {
  try {
    return typeof v === 'function' && v.$$typeof === TEMP_REF_TAG
  } catch (e) {
    return false
  }
}

function describeAny (value) {
  if (isTempRef(value)) return { kind: 'opaqueTemporaryReference' }
  if (typeof value === 'function') return { kind: 'function' }
  if (value instanceof Error) return describeError(value)
  if (value === null || typeof value !== 'object') {
    let normalized = value
    if (typeof value === 'bigint') normalized = String(value) + 'n'
    else if (typeof value === 'symbol') normalized = String(value)
    else if (typeof value === 'number') normalized = normalizeNumber(value)
    return { kind: value === null ? 'null' : typeof value, value: normalized }
  }
  let json
  try {
    json = JSON.stringify(value).slice(0, 140)
  } catch (e) {
    json = String(e.message || e).startsWith('Converting circular structure') ? '<cycle>' : '<throws>'
  }
  return { kind: 'object', constructorName: value.constructor && value.constructor.name, json }
}

// Shallow member-level view of a decoded root/arg: enough to see WHERE a
// transformation happened (symbol keys dropped? promise survived as a member?
// cycle restored? two array slots share one object?). Never recurses past
// depth 1 and never awaits thenable members (awaiting would change what we
// are characterizing).
function describeMember (v, root) {
  if (v === null) return 'null'
  if (isTempRef(v)) return 'opaqueTempRef'
  if (typeof v === 'function') return 'function'
  if (typeof v !== 'object') {
    if (typeof v === 'symbol') return String(v)
    if (typeof v === 'bigint') return String(v) + 'n'
    if (typeof v === 'number') return normalizeNumber(v)
    return v
  }
  if (v === root) return { selfRef: true }
  if (typeof v.then === 'function') return { thenable: true }
  return { ctor: v.constructor && v.constructor.name }
}

function describeShape (value) {
  if (isTempRef(value)) return { opaqueTemporaryReference: true }
  if (value === null || typeof value !== 'object') return undefined
  const shape = {
    proto: value.constructor && value.constructor.name,
    keys: [],
    symbolKeys: [],
    members: {},
  }
  try {
    shape.symbolKeys = Object.getOwnPropertySymbols(value).map(String)
  } catch (e) { shape.symbolKeys = '<throws>' }
  if (value instanceof Map) {
    shape.mapEntries = [...value].slice(0, 8).map(([k, v]) => [describeMember(k, value), describeMember(v, value)])
    return shape
  }
  if (value instanceof Set) {
    shape.setItems = [...value].slice(0, 8).map((v) => describeMember(v, value))
    return shape
  }
  if (typeof Blob !== 'undefined' && value instanceof Blob) {
    shape.blob = { size: value.size, type: value.type, name: typeof value.name === 'string' ? value.name : undefined }
    return shape
  }
  if (typeof FormData !== 'undefined' && value instanceof FormData) {
    try {
      shape.formDataEntries = [...value.entries()].slice(0, 6).map(([k, v]) => {
        if (typeof v !== 'object' || v === null) return [k, v]
        if (isTempRef(v)) return [k, 'opaqueTempRef']
        const kind = v.constructor && v.constructor.name
        return [k, typeof v.name === 'string' ? `${kind}:${v.name}:${v.size}b` : `${kind}:${v.size || ''}`]
      })
    } catch (e) {
      shape.formDataEntries = '<throws>'
    }
    return shape
  }
  if (typeof ReadableStream !== 'undefined' && value instanceof ReadableStream) {
    shape.readableStream = { locked: value.locked }
    return shape
  }
  if (typeof value[Symbol.asyncIterator] === 'function') {
    shape.asyncIterable = true
    return shape
  }
  let keys
  try {
    keys = Object.keys(value).slice(0, 12)
  } catch (e) {
    shape.keys = '<throws>'
    return shape
  }
  shape.keys = keys
  const seenObjects = []
  const shared = []
  for (const k of keys) {
    let v
    try {
      v = value[k]
    } catch (e) {
      shape.members[k] = { getThrows: true }
      continue
    }
    shape.members[k] = describeMember(v, value)
    if (v && typeof v === 'object') {
      const dup = seenObjects.findIndex((x) => x.ref === v)
      if (dup >= 0) shared.push([seenObjects[dup].key, k])
      else seenObjects.push({ key: k, ref: v })
    }
  }
  if (shared.length) shape.sharedRefs = shared
  return shape
}

function serialize (value) {
  return new Promise((resolve) => {
    const passthrough = new PassThrough()
    const chunks = []
    passthrough.on('data', (chunk) => chunks.push(Buffer.from(chunk)))
    const serializationErrors = []
    let pipeable
    try {
      // Next.js encodes action return values as a tuple: [result]
      pipeable = renderToPipeableStream([value], {}, {
        onError: (err) => { serializationErrors.push(err) },
      })
    } catch (err) {
      resolve({ wire: '', serializationErrors: [err], streamAborted: true })
      return
    }
    const finish = () => {
      clearTimeout(timer)
      resolve({
        wire: Buffer.concat(chunks).toString('utf8'),
        serializationErrors,
        streamAborted: false,
      })
    }
    const timer = setTimeout(() => {
      try { pipeable.abort() } catch (e) {}
      finish()
    }, 3000)
    timer.unref()
    pipeable.pipe(passthrough)
    passthrough.on('end', finish)
    passthrough.on('error', finish)
  })
}

async function clientOutcome (wire) {
  const input = new PassThrough()
  input.end(Buffer.from(wire))
  const decoded = createFromNodeStream(input, {
    moduleMap: {},
    serverModuleMap: {},
    moduleLoading: null,
  })
  const rootRes = await withTimeout(Promise.resolve(decoded))
  if (rootRes.timeout) return { outcome: 'timeout' }
  if (!rootRes.ok) {
    return { outcome: 'rejected', ...describeAny(rootRes.e) }
  }
  let root = Array.isArray(rootRes.v) ? rootRes.v[0] : rootRes.v
  guardUnhandled(root)
  // A server function's value arrives as a tuple whose element may itself be a
  // promise (fulfilled or rejected) — unwrap one level, like `await fn()` does.
  if (root && typeof root.then === 'function') {
    const inner = await withTimeout(Promise.resolve(root))
    if (inner.timeout) return { outcome: 'promise-timeout' }
    if (!inner.ok) return { outcome: 'rejected', ...describeAny(inner.e) }
    root = inner.v
  }
  return { outcome: 'resolved', ...describeAny(root) }
}

async function probeCase (value) {
  const { wire, serializationErrors } = await serialize(value)
  const serErr = serializationErrors.length ? String(serializationErrors[0].message || serializationErrors[0]) : null
  return {
    serializationThrew: serializationErrors.length > 0,
    serverErrorMessage: serErr ? serErr.slice(0, 140) : null,
    wireHasOriginalMessage: wire.includes(ERROR_MESSAGE),
    wire: wire.length > 400 ? wire.slice(0, 400) + '…' : wire,
    client: wire ? await clientOutcome(wire) : { outcome: 'no-wire' },
  }
}

async function runArgCase (value) {
  const enc = await withTimeout(Promise.resolve(encodeReply([value])))
  if (enc.timeout) return { outcome: 'encode-timeout' }
  if (!enc.ok) {
    return { outcome: 'encode-rejected', message: String((enc.e && enc.e.message) || enc.e).slice(0, 140) }
  }
  const dec = await withTimeout(Promise.resolve(decodeReply(enc.v, { serverModuleMap: {}, clientModules: {} })))
  if (dec.timeout) return { outcome: 'decode-timeout' }
  if (!dec.ok) {
    return { outcome: 'decode-rejected', message: String((dec.e && dec.e.message) || dec.e).slice(0, 140) }
  }
  return { outcome: 'decoded', arg: describeAny(Array.isArray(dec.v) ? dec.v[0] : dec.v) }
}

// -- matrix-specific probes: same round-trips, plus the describeShape view ----
async function matrixClientOutcome (wire) {
  const input = new PassThrough()
  input.end(Buffer.from(wire))
  const decoded = createFromNodeStream(input, {
    moduleMap: {},
    serverModuleMap: {},
    moduleLoading: null,
  })
  const rootRes = await withTimeout(Promise.resolve(decoded))
  if (rootRes.timeout) return { outcome: 'timeout' }
  if (!rootRes.ok) {
    return { outcome: 'rejected', ...describeAny(rootRes.e) }
  }
  let root = Array.isArray(rootRes.v) ? rootRes.v[0] : rootRes.v
  guardUnhandled(root)
  if (root && typeof root.then === 'function') {
    const inner = await withTimeout(Promise.resolve(root))
    if (inner.timeout) return { outcome: 'promise-timeout' }
    if (!inner.ok) return { outcome: 'rejected', ...describeAny(inner.e) }
    root = inner.v
  }
  return { outcome: 'resolved', ...describeAny(root), shape: describeShape(root) }
}

async function probeMatrixReturn (value) {
  const { wire, serializationErrors } = await serialize(value)
  const serErr = serializationErrors.length
    ? String(serializationErrors[0].message || serializationErrors[0]).slice(0, 140)
    : null
  return {
    serializationThrew: serializationErrors.length > 0,
    serverErrorMessage: serErr,
    wire: wire.length > 400 ? wire.slice(0, 400) + '…' : wire,
    client: wire ? await matrixClientOutcome(wire) : { outcome: 'no-wire' },
  }
}

// Next-faithful arg probe: client-side encodeReply with a fresh temporary
// reference set (server-action-reducer.js), server-side decodeReply with its
// OWN fresh set (action-handler.js). The client's set cannot help the server
// resolve anything — it only round-trips references back to the client.
async function probeMatrixArg (value) {
  const enc = await withTimeout(Promise.resolve(encodeReply([value], { temporaryReferences: createClientTempRefs() })))
  if (enc.timeout) return { outcome: 'encode-timeout' }
  if (!enc.ok) {
    return { outcome: 'encode-rejected', message: String((enc.e && enc.e.message) || enc.e).slice(0, 140) }
  }
  const dec = await withTimeout(Promise.resolve(decodeReply(enc.v, { serverModuleMap: {}, clientModules: {} }, { temporaryReferences: createServerTempRefs() })))
  if (dec.timeout) return { outcome: 'decode-timeout' }
  if (!dec.ok) {
    return { outcome: 'decode-rejected', message: String((dec.e && dec.e.message) || dec.e).slice(0, 140) }
  }
  const arg = Array.isArray(dec.v) ? dec.v[0] : dec.v
  guardUnhandled(arg)
  return { outcome: 'decoded', arg: { ...describeAny(arg), shape: describeShape(arg) } }
}

// -- server-function VALUES (docs: supported both directions) -----------------
// The library's runtime walker must let through functions tagged
// $$typeof === Symbol.for('react.server.reference') (what registerServerReference
// applies — and what Next's codegen applies to every 'use server' export).
// Everything proves out: those cross as live callables, NOT as opaque refs.
async function probeServerRefs () {
  const out = { arg: {}, ret: {} }
  const SERVER_REF_TAG = Symbol.for('react.server.reference')

  // args direction: client passes an imported server function (as created by
  // the bundler's createServerReference) — top-level and nested in a plain object.
  const clientAction = createClientServerRef('fixture:ref')
  out.arg.clientSide = { typeof: typeof clientAction, tag: String(clientAction.$$typeof) }
  const enc = await withTimeout(Promise.resolve(
    encodeReply([clientAction, { act: clientAction }], { temporaryReferences: createClientTempRefs() })
  ))
  if (!enc.ok) {
    out.arg.encode = 'rejected: ' + String((enc.e && enc.e.message) || enc.e).slice(0, 160)
    return out
  }
  out.arg.encoded = true
  const wireJSON = enc.v instanceof FormData
    ? String([...enc.v.entries()].find(([k]) => k === '0')?.[1] ?? '').slice(0, 200)
    : String(enc.v).slice(0, 200)
  out.arg.wireJSON = wireJSON
  const dec = await withTimeout(Promise.resolve(
    decodeReply(enc.v, SERVER_REF_MANIFEST, { temporaryReferences: createServerTempRefs() })
  ))
  if (!dec.ok) {
    out.arg.decode = 'rejected: ' + String((dec.e && dec.e.message) || dec.e).slice(0, 160)
    return out
  }
  const top = dec.v[0]
  const nested = dec.v[1] && dec.v[1].act
  out.arg.decodedTop = {
    typeof: typeof top,
    tag: String(top && top.$$typeof),
    tagMatches: top && top.$$typeof === SERVER_REF_TAG,
    call: typeof top === 'function' ? String(top()) : undefined,
  }
  out.arg.decodedNested = {
    typeof: typeof nested,
    tagMatches: nested && nested.$$typeof === SERVER_REF_TAG,
    sameAsTop: nested === top,
  }

  // return direction: a registered server function (as Next's 'use server'
  // modules are) renders as a $h handle with metadata, no serialization error.
  const serverFn = registerServerReference(function fixtureRet () { return 'ret-called' }, 'fixture:ret', 'fixtureRet')
  out.ret.registeredSide = { typeof: typeof serverFn, tagMatches: serverFn.$$typeof === SERVER_REF_TAG }
  const { wire, serializationErrors } = await serialize([serverFn, { act: serverFn }])
  out.ret.serializationThrew = serializationErrors.length > 0
  out.ret.serverErrorMessage = serializationErrors.length ? String(serializationErrors[0].message || serializationErrors[0]).slice(0, 160) : null
  out.ret.wireHasHandle = wire.includes('"$h')
  out.ret.wire = wire.length > 400 ? wire.slice(0, 400) + '…' : wire
  return out
}

async function main () {
  const out = {
    mode: process.env.NODE_ENV || 'not-set',
    flightBuild: require('react-server-dom-webpack/package.json').version,
    react: require('react/package.json').version,
    cases: {},
    family: {},
    symmetric: {},
    args: {},
    matrix: {},
  }

  // Core cases keep their historical shape exactly.
  for (const [name, makeValue] of Object.entries(cases)) {
    const value = makeValue()
    out.cases[name] = { originalMessage: ERROR_MESSAGE, originalCode: 'E_TODO' }
    const { wire, serializationErrors } = await serialize(value)
    out.cases[name].serializationThrew = serializationErrors.length > 0
    out.cases[name].serverErrorMessage = serializationErrors.length
      ? String(serializationErrors[0].message || serializationErrors[0])
      : null
    out.cases[name].wireHasOriginalMessage = wire.includes(ERROR_MESSAGE)
    out.cases[name].wire = wire.length > 400 ? wire.slice(0, 400) + '…' : wire
    const client = await deserializeLegacy(wire)
    if (client.outcome === 'resolved') {
      out.cases[name].client = { outcome: 'resolved', ...describeValue(client.value) }
    } else {
      out.cases[name].client = { outcome: 'rejected', error: client.error }
    }
  }

  for (const [name, makeValue] of Object.entries(familyCases)) {
    out.family[name] = await probeCase(makeValue())
  }
  for (const [name, makeValue] of Object.entries(symmetricCases)) {
    out.symmetric[name] = await probeCase(makeValue())
  }
  for (const [name, makeValue] of Object.entries(argCases)) {
    out.args[name] = await runArgCase(makeValue())
  }
  for (const [name, makeValue] of Object.entries(matrixCases)) {
    // fresh value per direction: cycles, one-shot streams, and the factories
    out.matrix[name] = {
      ret: await probeMatrixReturn(makeValue()),
      arg: await probeMatrixArg(makeValue()),
    }
  }
  out.serverRefs = await probeServerRefs()

  out.logs = logs.slice(0, 40)
  process.stdout.write(JSON.stringify(out, null, 2) + '\n')
  process.exit(0)
}

main().catch((err) => {
  process.stderr.write('FIXTURE CRASHED ' + String(err) + '\n')
  process.exit(1)
})
