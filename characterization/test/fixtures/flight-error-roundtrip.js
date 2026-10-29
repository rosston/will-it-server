// Reproduces how Next.js serializes a server function's RETURN value across the
// RSC boundary: through React Flight (`react-server-dom-webpack`).
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
// Prints a JSON object describing, for each return value:
//   - what happened server-side (serialization)
//   - the wire format bytes
//   - what happened client-side (deserialization)
'use strict'

const { PassThrough } = require('node:stream')
const { renderToPipeableStream } = require('react-server-dom-webpack/server.node')
const { createFromNodeStream } = require('react-server-dom-webpack/client.node')

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

const cases = {
  // 1. The value returned is an Error (not thrown).
  topError: () => makeError(),
  // 2. The Error is a field of an otherwise serializable object
  //    (the { ok: false, error } pattern).
  nestedError: () => ({ ok: false, error: makeError() }),
  // 3. A plain (non-Error) class instance — the hard "unserializable" case.
  classInstance: () => new TodoValidationError(ERROR_MESSAGE),
}

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

async function deserialize (wire) {
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

async function main () {
  const out = {
    mode: process.env.NODE_ENV || 'not-set',
    flightBuild: require('react-server-dom-webpack/package.json').version,
    react: require('react/package.json').version,
    cases: {},
  }
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
    const client = await deserialize(wire)
    if (client.outcome === 'resolved') {
      out.cases[name].client = { outcome: 'resolved', ...describeValue(client.value) }
    } else {
      out.cases[name].client = { outcome: 'rejected', error: client.error }
    }
  }
  process.stdout.write(JSON.stringify(out, null, 2) + '\n')
  process.exit(0)
}

main().catch((err) => {
  console.error('FIXTURE CRASHED', err)
  process.exit(1)
})
