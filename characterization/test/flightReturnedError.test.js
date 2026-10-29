'use strict'

// Characterization test, not a unit test: this pins down how React's Flight
// serializer (the machinery Next.js uses to move a server function's return
// value across the RSC boundary) behaves at a specific version — the versions
// are exact pins in this package's package.json, on purpose.
//
// The behavior being characterized: a server function that RETURNS (rather than
// throws) an Error object.
//
// - In `next dev`, the client component receives the real Error: message and
//   stack survive. App code like `result.message` works.
// - In a production build, Flight emits an opaque marker ("$Z") with no
//   payload. The client component still receives an Error instance — but it
//   is NOT the one the server returned: the message, stack, and custom fields
//   are silently replaced/dropped.
//
// We drive both the dev and prod Flight builds directly (NODE_ENV selects the
// build, exactly like it does inside Next.js), so the divergence is caught
// here — before it ships as a works-on-my-machine bug.
//
// When you bump the pinned React versions, re-run this suite and read the
// results carefully: a green suite means the characterization still holds;
// a red one is information, not necessarily a failure to "fix."
//
// See test/fixtures/flight-error-roundtrip.js for the serializer round-trip.

const assert = require('node:assert').strict
const { execFileSync } = require('node:child_process')
const path = require('node:path')

const FIXTURE = path.join(__dirname, 'fixtures', 'flight-error-roundtrip.js')
const ERROR_MESSAGE = 'could not complete the todo'

function runFixture (nodeEnv) {
  // --conditions react-server is how Next.js configures Node when running
  // Flight server code; NODE_ENV picks the dev vs prod build.
  const stdout = execFileSync(
    process.execPath,
    ['--conditions', 'react-server', FIXTURE],
    { env: { ...process.env, NODE_ENV: nodeEnv }, encoding: 'utf8' }
  )
  return JSON.parse(stdout)
}

module.exports = {
  flightReturnedErrorRepro: {
    'development: a returned Error survives Flight serialization' () {
      const report = runFixture('development')
      const { topError } = report.cases

      assert.equal(topError.serializationThrew, false)
      // Dev server build outlines the error's message/stack onto the wire...
      assert.equal(topError.wireHasOriginalMessage, true)
      // ...and the client component receives an Error carrying the returned
      // message, so app code like `result.message` works.
      assert.equal(topError.client.outcome, 'resolved')
      assert.equal(topError.client.isError, true)
      assert.equal(topError.client.message, ERROR_MESSAGE)
      assert.equal(topError.client.stackHasOriginalMessage, true)
    },

    'production: a returned Error does NOT survive Flight serialization' () {
      const report = runFixture('production')
      const { topError } = report.cases

      // The server does not hard-fail — it silently emits an opaque marker.
      assert.equal(topError.serializationThrew, false)
      // The returned message/stack never make it onto the wire.
      assert.equal(topError.wireHasOriginalMessage, false)
      assert.ok(!topError.wire.includes('E_TODO'), 'custom fields must not leak onto the wire')

      // What the client component awaits is an Error object — but not the one
      // the server returned: React replaces it with an opaque stand-in, and
      // the app breaks in exactly the way that only reproduces in production.
      assert.equal(topError.client.outcome, 'resolved')
      assert.equal(topError.client.isError, true)
      assert.notEqual(topError.client.message, ERROR_MESSAGE)
      assert.match(
        topError.client.message ?? '',
        /An error occurred in the Server Components render/
      )
      // Custom fields on the returned error are gone.
      assert.equal(topError.client.code, undefined)
      assert.equal(topError.client.stackHasOriginalMessage, false)
    },

    'production: Errors nested in the returned object are corrupted too' () {
      const report = runFixture('production')
      const { nestedError } = report.cases

      // The surrounding plain object ({ ok: false, ... }) survives...
      assert.equal(nestedError.client.outcome, 'resolved')
      assert.equal(nestedError.client.ok, false)
      assert.equal(nestedError.wireHasOriginalMessage, false)
      // ...but the Error field is replaced by the opaque stand-in: no
      // message, no stack, no custom code.
      assert.equal(nestedError.client.errorIsError, true)
      assert.notEqual(nestedError.client.errorMessage, ERROR_MESSAGE)
      assert.equal(nestedError.client.errorCode, undefined)
    },

    'development: same nested pattern works for the client' () {
      const report = runFixture('development')
      const { nestedError } = report.cases
      assert.equal(nestedError.client.outcome, 'resolved')
      assert.equal(nestedError.client.errorIsError, true)
      assert.equal(nestedError.client.errorMessage, ERROR_MESSAGE)
    },

    'both modes: non-Error class instances are a hard serialization failure' () {
      // For contrast: plain objects containing class instances (any non-Error
      // class) fail outright — the awaited call rejects client-side. In dev
      // the rejection carries the real cause; in prod it is the opaque
      // digest-only error. This is the "un-serializable" failure shape.
      const dev = runFixture('development')
      const prod = runFixture('production')

      assert.equal(dev.cases.classInstance.client.outcome, 'rejected')
      assert.match(dev.cases.classInstance.client.error ?? '', /Only plain objects/)
      assert.equal(prod.cases.classInstance.client.outcome, 'rejected')
      assert.match(
        prod.cases.classInstance.client.error ?? '',
        /An error occurred in the Server Components render/
      )
    },

    'the dev/prod divergence: identical code, different client-visible outcome' () {
      // The summary assertion: what works in dev silently breaks in prod.
      const dev = runFixture('development')
      const prod = runFixture('production')
      assert.equal(dev.cases.topError.client.message, ERROR_MESSAGE)
      assert.notEqual(prod.cases.topError.client.message, dev.cases.topError.client.message)
    }
  }
}
