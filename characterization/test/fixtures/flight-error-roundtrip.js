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
//   logs      — React's dev-build console noise (prod builds log nothing here)
'use strict'

const { PassThrough } = require('node:stream')
const { renderToPipeableStream, decodeReply } = require('react-server-dom-webpack/server.node')
const { createFromNodeStream } = require('react-server-dom-webpack/client.node')
const { encodeReply } = require('react-server-dom-webpack/client.edge')

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
// the process with unhandled rejections.
function guardUnhandled (v) {
  try {
    if (Array.isArray(v)) v.forEach(guardUnhandled)
    else if (v && typeof v.then === 'function') v.then(() => {}, () => {})
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

function describeAny (value) {
  if (value instanceof Error) return describeError(value)
  if (value === null || typeof value !== 'object') {
    let normalized = value
    if (typeof value === 'bigint') normalized = String(value) + 'n'
    else if (typeof value === 'symbol') normalized = String(value)
    else if (typeof value === 'number' && Object.is(value, NaN)) normalized = 'NaN'
    return { kind: value === null ? 'null' : typeof value, value: normalized }
  }
  return { kind: 'object', constructorName: value.constructor && value.constructor.name, json: JSON.stringify(value).slice(0, 140) }
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

async function main () {
  const out = {
    mode: process.env.NODE_ENV || 'not-set',
    flightBuild: require('react-server-dom-webpack/package.json').version,
    react: require('react/package.json').version,
    cases: {},
    family: {},
    symmetric: {},
    args: {},
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

  out.logs = logs.slice(0, 40)
  process.stdout.write(JSON.stringify(out, null, 2) + '\n')
  process.exit(0)
}

main().catch((err) => {
  process.stderr.write('FIXTURE CRASHED ' + String(err) + '\n')
  process.exit(1)
})
