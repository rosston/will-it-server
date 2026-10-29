'use strict'

// Characterization tests for the wider fallout of the fuzz sweep across the
// Flight value matrix (types x directions x dev/prod builds). Findings pinned
// here (react-server-dom-webpack@19.3.1, same behavior as Next 16's bundled
// flight):
//
// 1. The dev-OK/prod-corrupt divergence is NOT specific to `new Error()` — it
//    covers EVERY `instanceof Error` value in a return position: TypeError,
//    DOMException, AggregateError, custom subclasses, errors behind promises,
//    and nested errors. The serializer branches on instanceof Error, so the
//    whole family shares one fate: dev keeps message+stack, prod replaces
//    each with the opaque stand-in.
// 2. Even dev degrades error *identity*: subclasses arrive as plain Errors
//    (`instanceof MyError` fails client-side); only name/message/stack are
//    rebuilt (and AggregateError's `errors` only in dev).
// 3. Rejected promises (the "just throw it" workaround) are NOT safe either:
//    both modes reject, but only dev tells you why — the prod rejection
//    reason is the same opaque stand-in.
// 4. Other silent corruptions (URL -> string, invalid Date -> null, Buffer ->
//    {type:'Buffer',data}) behave IDENTICALLY in dev and prod — no footgun
//    asymmetry — but dev additionally console.warns about Buffers, which prod
//    never tells you.
// 5. The arguments direction is mode-symmetric in OUTCOME: Errors/classes/
//    functions passed as arguments fail at ENCODE in both dev and prod with the
//    same headline message, so this class of mistake is loud everywhere. (Dev
//    appends a pointer to the offending value for some of them; prod doesn't.)

const assert = require('node:assert').strict
const { execFileSync } = require('node:child_process')
const path = require('node:path')

const FIXTURE = path.join(__dirname, 'fixtures', 'flight-error-roundtrip.js')
const ERROR_MESSAGE = 'could not complete the todo'

function runFixture (nodeEnv) {
  const stdout = execFileSync(
    process.execPath,
    ['--conditions', 'react-server', FIXTURE],
    { env: { ...process.env, NODE_ENV: nodeEnv }, encoding: 'utf8' }
  )
  return JSON.parse(stdout)
}

const dev = runFixture('development')
const prod = runFixture('production')

module.exports = {
  flightErrorFamily: {
    'dev: the entire Error family keeps message + stack on the wire' () {
      const members = ['typeError', 'domException', 'aggregateError', 'customErrorSubclass', 'promiseResolvedError']
      for (const name of members) {
        const { client, wireHasOriginalMessage } = dev.family[name]
        assert.equal(client.outcome, 'resolved', name)
        assert.equal(client.isError, true, name)
        assert.equal(client.message, ERROR_MESSAGE, name)
        assert.equal(client.stackHasOriginalMessage, true, name)
        assert.equal(client.isOpaqueStandIn, false, name)
        assert.equal(wireHasOriginalMessage, true, name)
      }
      // AggregateError's inner errors survive in dev...
      assert.equal(dev.family.aggregateError.client.errorsCount, 1)
    },

    'dev: error identity is degraded even in development' () {
      // Dev rebuilds errors from {name, message, stack} — the constructor is a
      // plain Error. `instanceof ValidationError` / `instanceof DOMException`
      // checks on the client will fail even in development.
      assert.equal(dev.family.customErrorSubclass.client.constructorName, 'Error')
      assert.equal(dev.family.customErrorSubclass.client.name, 'Error')
      assert.equal(dev.family.typeError.client.constructorName, 'Error')
      assert.equal(dev.family.typeError.client.name, 'TypeError')
      assert.equal(dev.family.domException.client.constructorName, 'Error')
      assert.equal(dev.family.domException.client.name, 'AbortError')
    },

    'prod: every family member collapses to the opaque stand-in' () {
      const members = ['typeError', 'domException', 'aggregateError', 'customErrorSubclass', 'promiseResolvedError']
      for (const name of members) {
        const { client, wireHasOriginalMessage } = prod.family[name]
        assert.equal(client.outcome, 'resolved', name)
        assert.equal(client.isError, true, name)
        assert.equal(client.isOpaqueStandIn, true, name)
        assert.notEqual(client.message, ERROR_MESSAGE, name)
        assert.equal(client.stackHasOriginalMessage, false, name)
        assert.equal(wireHasOriginalMessage, false, name)
      }
      // AggregateError's inner errors are gone; custom fields are gone too.
      assert.equal(prod.family.aggregateError.client.errorsCount, undefined)
      assert.equal(prod.family.promiseResolvedError.client.code, undefined)
    },

    'rejected promises: both modes reject, but only dev says why' () {
      // This kills the common workaround of "throw the error instead of
      // returning it" as a serialization fix: thrown/rejected errors arrive
      // client-side as rejections whose reason is the SAME opaque stand-in in
      // prod. (They differ from the returned case: rejection is at least
      // loud in both modes — outcome 'rejected' everywhere.)
      assert.equal(dev.family.rejectedPromise.client.outcome, 'rejected')
      assert.equal(dev.family.rejectedPromise.client.message, ERROR_MESSAGE)
      assert.equal(dev.family.rejectedPromise.client.isOpaqueStandIn, false)

      assert.equal(prod.family.rejectedPromise.client.outcome, 'rejected')
      assert.equal(prod.family.rejectedPromise.client.isOpaqueStandIn, true)
    },

    'symmetric corruptions: identical dev/prod results (no mode trap)' () {
      const expectations = {
        // URL arrives as its href STRING (the object shape is lost)...
        url: { outcome: 'resolved', kind: 'string', value: 'https://example.com/p' },
        // invalid Dates arrive as null (silently)...
        invalidDate: { outcome: 'resolved', kind: 'null', value: null },
        // Node Buffers arrive as {type:'Buffer',data:[...]} (JSON.stringify
        // semantics via toJSON, not as binary)...
        nodeBuffer: { outcome: 'resolved', kind: 'object' },
        // toJSON values are invoked at BOTH boundaries in both modes...
        objectWithToJSON: { outcome: 'resolved', kind: 'string', value: 'replaced' },
      }
      for (const [name, expected] of Object.entries(expectations)) {
        for (const report of [dev, prod]) {
          const { client } = report.symmetric[name]
          assert.equal(client.outcome, expected.outcome, `${name} in ${report.mode}`)
          if (expected.kind !== undefined) assert.equal(client.kind, expected.kind, `${name} in ${report.mode}`)
          if (expected.value !== undefined) assert.equal(client.value, expected.value, `${name} in ${report.mode}`)
        }
        // the point of this test: dev and prod AGREE on these
        assert.deepEqual(dev.symmetric[name].client, prod.symmetric[name].client, name)
      }
      assert.equal(dev.symmetric.nodeBuffer.client.json, '{"type":"Buffer","data":[1,2]}')
    },

    'dev console-warns about the Buffer corruption; prod is silent' () {
      const joined = dev.logs.map(([, m]) => m).join('\n')
      assert.match(joined, /Binary data with a toJSON method, such as a Node\.js Buffer/)
      const prodJoined = prod.logs.map(([, m]) => m).join('\n')
      assert.doesNotMatch(prodJoined, /Binary data with a toJSON method/)
    },

    'arguments direction: outcomes are mode-symmetric; dev may add context to the error text' () {
      for (const name of Object.keys(dev.args)) {
        assert.equal(dev.args[name].outcome, prod.args[name].outcome, `arg case ${name} outcome differs across modes`)
      }
      // The successful cases are byte-identical across modes.
      assert.deepEqual(dev.args.plainObject, prod.args.plainObject)
      assert.deepEqual(dev.args.urlArg, prod.args.urlArg)
      assert.equal(dev.args.plainObject.arg.json, '{"ok":true}')
      // URLs cross as strings here too — matching the return direction.
      assert.equal(dev.args.urlArg.arg.value, 'https://example.com/q')

      // Errors/classes/functions as arguments fail at ENCODE time, client-side, in
      // both modes with the same headline message — this class of mistake is loud
      // everywhere, unlike the silent return-side corruption.
      assert.match(prod.args.errorArg.message, /Only plain objects, and a few built-ins/)
      assert.match(prod.args.classInstanceArg.message, /Only plain objects, and a few built-ins/)
      assert.match(prod.args.functionArg.message, /Client Functions cannot be passed/)

      // The dev build appends a pointer to the offending value on top of prod's
      // exact message; functionArg has no such tail in either mode.
      for (const name of ['errorArg', 'classInstanceArg']) {
        assert.ok(dev.args[name].message.startsWith(prod.args[name].message), name)
        assert.notEqual(dev.args[name].message, prod.args[name].message, name)
      }
      assert.equal(dev.args.functionArg.message, prod.args.functionArg.message)
    },

    'headline invariant: only Error-bearing returns diverge across modes' () {
      // Sweep every return case in both reports. Two claims:
      // (a) no case SUCCEEDS in one mode and FAILS in the other (success/failure
      //     is mode-independent for everything tested), and
      // (b) among cases that succeed in both modes, the set whose client-visible
      //     content differs across modes is EXACTLY the Error-family values.
      const expectedDivergent = new Set([
        'topError', 'nestedError', // from the historical `cases` section
        'typeError', 'domException', 'aggregateError',
        'customErrorSubclass', 'promiseResolvedError',
      ])
      const divergent = new Set()
      for (const section of ['cases', 'family', 'symmetric']) {
        for (const [name, entry] of Object.entries(dev[section])) {
          const d = entry.client
          const p = prod[section][name].client
          if (d.outcome === 'resolved') {
            assert.equal(p.outcome, 'resolved', `${section}.${name} resolves in dev but fails in prod`)
            if (JSON.stringify(d) !== JSON.stringify(p)) divergent.add(name)
          } else {
            assert.notEqual(p.outcome, 'resolved', `${section}.${name} fails in dev but resolves in prod`)
          }
        }
      }
      assert.deepEqual(
        [...divergent].sort(),
        [...expectedDivergent].sort()
      )
    },
  },
}
