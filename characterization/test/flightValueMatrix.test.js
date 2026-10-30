'use strict'

// Characterization tests for the value matrix. Every case in
// the fixture's `matrix` section is probed in BOTH directions (server ->
// client returns via render/decode, client -> server args via encode/reply)
// in dev and prod Flight builds (react-server-dom-webpack@19.3.1).
//
// The ARG probes mimic Next's REAL action path, not bare Flight: both Next 15
// and 16 create a client-side TemporaryReferenceSet and pass it to
// encodeReply (server-action-reducer.js), and the server decodes with its own
// fresh set (action-handler.js). This matters: the bare-path pins in
// flightErrorFamily.test.js ("arguments fail at ENCODE, loudly, in both
// modes") are true only WITHOUT temporary references. With them — the code
// path users actually ship — these instead become silent opaque placeholders:
//
//   class instances · null-prototype objects · RegExp · WeakMap/WeakSet ·
//   React elements (top-level and nested) · ANY symbol incl. Symbol.for ones ·
//   plain functions
//
// all encode fine and arrive server-side as a Proxy-of-a-throwing-function
// (typeof 'function', property access throws "Cannot access X on the
// server"). Only functions-in-props of plain objects aside, the loud encode
// failure was a fixture artifact of the bare path.
//
// Headline return-direction findings pinned here:
// - Nested promises cross as live thenables (resolved OR rejected members
//   arrive as promises; a rejected member does not sink the root).
// - Cycles and shared references round-trip with object IDENTITY RESTORED —
//   Flight dedups by reference ($0:0 wire refs).
// - FormData crosses server -> client (top-level and nested), entries intact.
// - ArrayBuffer/typed arrays/DataView/Blob/ReadableStream/async iterables
//   all cross both ways. File -> client arrives as Blob (identity lost);
//   Blob -> server arrives upgraded to File.
// - Invalid Date -> null in BOTH directions (symmetric corruption).
// - Symbol-KEYED members are silently dropped both ways (dev console.errors,
//   prod never does). Registered symbols cross as values S->C but not as
//   args. Date custom own-properties are dropped (ISO time only).
// - Throwing getters sink both the render AND the encode, in both modes.
// - Rejected promise as arg member rejects the whole encode; as return
//   member it arrives as a rejected promise (root still resolves).

const assert = require('node:assert').strict
const { execFileSync } = require('node:child_process')
const path = require('node:path')

const FIXTURE = path.join(__dirname, 'fixtures', 'flight-error-roundtrip.js')

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

const OPAQUE_MSG = /An error occurred in the Server Components render/

function row (name) {
  return { d: dev.matrix[name], p: prod.matrix[name] }
}

module.exports = {
  flightValueMatrix: {
    'headline: every matrix row has a mode-symmetric outcome' () {
      // The library's premise: nothing flips success/failure across modes —
      // only Error-bearing content diverges. Every row of the new matrix
      // holds that invariant too.
      for (const name of Object.keys(dev.matrix)) {
        assert.equal(dev.matrix[name].ret.client.outcome, prod.matrix[name].ret.client.outcome, `${name} ret outcome`)
        assert.equal(dev.matrix[name].arg.outcome, prod.matrix[name].arg.outcome, `${name} arg outcome`)
      }
    },

    'returns: valid Dates pass; invalid Dates arrive as null in BOTH directions' () {
      const { d, p } = row('validDate')
      assert.equal(d.ret.client.constructorName, 'Date')
      assert.equal(p.ret.client.constructorName, 'Date')
      assert.equal(d.arg.arg.constructorName, 'Date')
      assert.equal(p.arg.arg.constructorName, 'Date')

      for (const report of [row('invalidDate').d, row('invalidDate').p]) {
        assert.equal(report.ret.client.outcome, 'resolved')
        assert.equal(report.ret.client.kind, 'null', 'invalid Date -> null (server->client)')
        assert.equal(report.arg.outcome, 'decoded')
        assert.equal(report.arg.arg.kind, 'null', 'invalid Date -> null (client->server)')
      }
      // Date is ISO-time-only: custom own properties are silent casualties.
      for (const report of [row('dateWithCustomField').d, row('dateWithCustomField').p]) {
        assert.equal(report.ret.client.constructorName, 'Date')
        assert.deepEqual(report.ret.client.shape.keys, [], 'no own props survive Date')
        assert.equal(report.ret.client.shape.members.note, undefined)
      }
    },

    'returns: nested promises cross as live thenables; arg direction too' () {
      for (const report of [row('promiseInObject').d, row('promiseInObject').p]) {
        assert.equal(report.ret.client.outcome, 'resolved')
        assert.deepEqual(report.ret.client.shape.members, { p: { thenable: true }, plain: 1 })
        assert.equal(report.arg.outcome, 'decoded')
        assert.deepEqual(report.arg.arg.shape.members, { p: { thenable: true }, plain: 1 })
      }
      const arr = row('promiseInArray').d
      assert.deepEqual(arr.ret.client.shape.members, { 0: { thenable: true }, 1: 'b' })
      const map = row('promiseInMapValue').d
      assert.deepEqual(map.ret.client.shape.mapEntries, [['k', { thenable: true }]])
      assert.deepEqual(map.arg.arg.shape.mapEntries, [['k', { thenable: true }]])
    },

    'returns: a REJECTED promise member still lets the root resolve (args: sinks the encode)' () {
      for (const report of [row('rejectedPromiseInObject').d, row('rejectedPromiseInObject').p]) {
        assert.equal(report.ret.client.outcome, 'resolved', 'root still resolves')
        assert.equal(report.ret.client.shape.members.p.thenable, true)
        assert.equal(report.ret.serializationThrew, true, 'the error is reported to onError')
        // Client->server: encodeReply awaits members; a rejection rejects the
        // whole reply — in BOTH modes (this is local encode, no Flight opaque
        // stand-in applies).
        assert.equal(report.arg.outcome, 'encode-rejected')
        assert.match(report.arg.message, /nested-reject/)
      }
    },

    'cycles and shared references round-trip with identity restored (BOTH directions)' () {
      for (const name of ['cycleSelf', 'cycleViaArray']) {
        for (const report of [row(name).d, row(name).p]) {
          assert.equal(report.ret.client.outcome, 'resolved', `${name} ret`)
          assert.equal(report.ret.client.json, '<cycle>', 'cycle survives decode')
          assert.equal(report.arg.outcome, 'decoded', `${name} arg`)
          assert.equal(report.arg.arg.json, '<cycle>')
        }
      }
      const self = row('cycleSelf').d
      assert.equal(self.ret.client.shape.members.self.selfRef, true, 'o.self === o on the client')
      assert.equal(self.arg.arg.shape.members.self.selfRef, true, 'and server-side in args')

      const shared = row('sharedRefPair')
      for (const report of [shared.d, shared.p]) {
        assert.deepEqual(report.ret.client.shape.sharedRefs, [['0', '1']], 'shared refs dedup to one client object')
        assert.deepEqual(report.arg.arg.shape.sharedRefs, [['0', '1']])
      }
    },

    'FormData crosses BOTH directions, top-level AND nested, entries intact' () {
      // Flips the previously guessed rules: the type layer's
      // `FormData ? never` in returns and the runtime's top-level-only
      // `|| instanceof FormData` were both wrong.
      for (const report of [row('formDataTop').d, row('formDataTop').p]) {
        assert.equal(report.ret.client.constructorName, 'FormData')
        assert.deepEqual(report.ret.client.shape.formDataEntries, [['a', 'b']])
        assert.equal(report.arg.arg.constructorName, 'FormData')
        assert.deepEqual(report.arg.arg.shape.formDataEntries, [['a', 'b']])
      }
      for (const report of [row('formDataNested').d, row('formDataNested').p]) {
        assert.deepEqual(report.ret.client.shape.members, { fd: { ctor: 'FormData' } })
        assert.deepEqual(report.arg.arg.shape.members, { fd: { ctor: 'FormData' } })
      }
      // File inside FormData: client->server keeps name+size; server->client
      // loses the name (arrives as 'blob').
      const fdFile = row('formDataWithFile')
      assert.deepEqual(fdFile.d.arg.arg.shape.formDataEntries, [['f', 'File:x.txt:1b']])
      assert.deepEqual(fdFile.p.arg.arg.shape.formDataEntries, [['f', 'File:x.txt:1b']])
      assert.deepEqual(fdFile.d.ret.client.shape.formDataEntries, [['f', 'File:blob:1b']])
    },

    'React elements cross returns (top-level and nested); as args they are opaque placeholders' () {
      for (const report of [row('elementTop').d, row('elementTop').p]) {
        assert.equal(report.ret.client.outcome, 'resolved')
        assert.equal(report.ret.client.shape.members['$$typeof'], 'Symbol(react.transitional.element)')
        assert.equal(report.ret.client.shape.members.type, 'div')
      }
      assert.deepEqual(row('elementNested').d.ret.client.shape.members, { el: { ctor: 'Object' } })

      // Next path: elements as args do NOT throw at encode — they arrive as
      // opaque placeholders server-side.
      for (const name of ['elementTop', 'elementNested', 'elementWithFnProp']) {
        for (const report of [row(name).d, row(name).p]) {
          if (name === 'elementNested' || name === 'elementWithFnProp') {
            assert.equal(report.arg.outcome, 'decoded')
            assert.equal(report.arg.arg.shape.members.el, 'opaqueTempRef')
          } else {
            assert.equal(report.arg.arg.kind, 'opaqueTemporaryReference')
          }
        }
      }
      // Function props inside returned elements: Flight errors the prop but
      // the root still resolves.
      const fnProp = row('elementWithFnProp')
      assert.equal(fnProp.d.ret.serializationThrew, true)
      assert.match(fnProp.d.ret.serverErrorMessage, /Event handlers cannot be passed/)
      assert.match(fnProp.p.ret.serverErrorMessage, /Event handlers cannot be passed/)
      assert.equal(fnProp.d.ret.client.outcome, 'resolved')
    },

    'binary, file-ish, stream: cross both directions with constructors preserved' () {
      for (const name of ['arrayBuffer', 'uint8Array', 'dataView']) {
        for (const report of [row(name).d, row(name).p]) {
          assert.equal(report.ret.client.outcome, 'resolved', `${name} ret`)
          assert.equal(report.arg.outcome, 'decoded', `${name} arg`)
        }
      }
      const u8 = row('uint8Array').d
      assert.equal(u8.ret.client.constructorName, 'Uint8Array')
      assert.deepEqual(u8.ret.client.shape.members, { 0: 1, 1: 2, 2: 3 }, 'contents intact')
      assert.equal(u8.arg.arg.constructorName, 'Uint8Array')
      assert.deepEqual(u8.arg.arg.shape.members, { 0: 1, 1: 2, 2: 3 })
      assert.equal(row('dataView').d.ret.client.constructorName, 'DataView')
      assert.equal(row('dataView').d.arg.arg.constructorName, 'DataView')
      assert.equal(row('arrayBuffer').d.ret.client.constructorName, 'ArrayBuffer')

      // File/Blob identity is NOT symmetric:
      //   Blob  -> server: UPGRADED to File (name 'blob')
      //   File  -> server: File with name+type preserved
      //   File  -> client: DOWNGRADED to Blob (name lost)
      const blob = row('blob')
      assert.equal(blob.d.ret.client.constructorName, 'Blob')
      assert.deepEqual(blob.d.ret.client.shape.blob, { size: 5, type: '' }, 'Blob keeps size/type')
      assert.equal(blob.d.arg.arg.constructorName, 'File')
      assert.equal(blob.d.arg.arg.shape.blob.name, 'blob')
      const file = row('file')
      assert.equal(file.d.ret.client.constructorName, 'Blob', 'File arrives as Blob — identity lost')
      assert.equal(file.d.arg.arg.constructorName, 'File')
      assert.equal(file.d.arg.arg.shape.blob.name, 'a.txt')

      const stream = row('readableStreamTop')
      assert.equal(stream.d.ret.client.constructorName, 'ReadableStream')
      assert.equal(stream.d.arg.arg.constructorName, 'ReadableStream')
      assert.equal(stream.d.arg.arg.shape.readableStream.locked, false)
      const iter = row('asyncIterableTop')
      assert.equal(iter.d.arg.arg.shape.asyncIterable, true)
      assert.equal(iter.d.ret.client.shape.asyncIterable, true)
    },

    'returns: hard rejections sink the whole value in BOTH modes (dev names it, prod is opaque)' () {
      const cases = {
        regExp: /Only plain objects/,
        weakMap: /Only plain objects/,
        weakSet: /Only plain objects/,
        nullProto: /Only plain objects/,
        classInstanceWithMethod: /Only plain objects/,
        fnTop: /Functions cannot be passed/,
        unregisteredSymbolDeep: /Only global symbols/,
        throwingGetter: /getter-boom/,
      }
      for (const [name, devPattern] of Object.entries(cases)) {
        const { d, p } = row(name)
        assert.equal(d.ret.client.outcome, 'rejected', `${name} dev ret`)
        assert.equal(p.ret.client.outcome, 'rejected', `${name} prod ret`)
        assert.match(String(d.ret.client.message || d.ret.client.error || ''), devPattern, `${name} dev says why`)
        assert.match(String(p.ret.client.message || p.ret.client.error || ''), OPAQUE_MSG, `${name} prod hides why`)
      }
    },

    'args (Next temp-ref path): those same hard-fail values arrive as OPAQUE PLACEHOLDERS, not encode errors' () {
      // This is the Next-faithful counterpart of the previous test. The bare
      // Flight path (no temporary references) throws at encode — pinned in
      // flightErrorFamily.test.js's args section. Next always passes a set,
      // so users see silent placeholders instead: a Proxy over a throwing
      // function (typeof 'function'); any property read other than $$typeof/
      // name/then/toJSON throws "Cannot access X on the server".
      const opaqueTops = ['regExp', 'weakMap', 'weakSet', 'nullProto', 'classInstanceWithMethod', 'fnTop', 'registeredSymbolTop']
      for (const name of opaqueTops) {
        for (const report of [row(name).d, row(name).p]) {
          assert.equal(report.arg.outcome, 'decoded', `${name} encodes fine under Next`)
          assert.equal(report.arg.arg.kind, 'opaqueTemporaryReference', `${name} arrives as a placeholder`)
        }
      }
      // Nested members get the same treatment:
      const nested = row('unregisteredSymbolDeep')
      assert.equal(nested.d.arg.arg.shape.members.s, 'opaqueTempRef')
      assert.equal(row('registeredSymbolInObject').d.arg.arg.shape.members.s, 'opaqueTempRef')
    },

    'symbol values and keys: registered symbols cross returns as values; symbol-KEYED members are silently dropped; no symbol crosses as an arg value' () {
      for (const report of [row('registeredSymbolTop').d, row('registeredSymbolTop').p]) {
        assert.equal(report.ret.client.kind, 'symbol', 'Symbol.for values arrive as symbols')
        assert.equal(report.ret.client.value, 'Symbol(matrix.registered)')
      }
      assert.equal(row('registeredSymbolInObject').d.ret.client.shape.members.s, 'Symbol(matrix.r)')

      // Symbol keys are dropped in BOTH directions, with dev-only warnings:
      for (const report of [row('symbolKeyedObject').d, row('symbolKeyedObject').p]) {
        assert.deepEqual(report.ret.client.shape.keys, ['visible'])
        assert.deepEqual(report.ret.client.shape.symbolKeys, [])
        assert.deepEqual(report.arg.arg.shape.keys, ['visible'])
        assert.deepEqual(report.arg.arg.shape.symbolKeys, [])
      }
    },

    'toJSON is honored both directions (object replaced by its JSON)' () {
      for (const report of [row('toJSONObject').d, row('toJSONObject').p]) {
        assert.equal(report.ret.client.value, 'replaced')
        assert.equal(report.arg.arg.kind, 'string')
        assert.equal(report.arg.arg.value, 'replaced')
      }
    },

    'numeric specials arrive exactly: NaN, Infinity, -0' () {
      const expect = { nan: 'NaN', infinity: 'Infinity', negativeZero: '-0' }
      for (const [name, value] of Object.entries(expect)) {
        for (const report of [row(name).d, row(name).p]) {
          assert.equal(report.ret.client.kind, 'number')
          assert.equal(report.ret.client.value, value)
          assert.equal(report.arg.arg.value, value, `${name} arg`)
        }
      }
    },

    'throwing getters sink the render and the encode in both modes' () {
      const { d, p } = row('throwingGetter')
      assert.equal(d.arg.outcome, 'encode-rejected')
      assert.match(d.arg.message, /getter-boom/)
      assert.equal(p.arg.outcome, 'encode-rejected')
      assert.match(p.arg.message, /getter-boom/)
      assert.equal(d.ret.client.outcome, 'rejected')
      assert.equal(p.ret.client.outcome, 'rejected')
    },

    'dev-only console noise accompanies the corruption classes; prod is silent' () {
      const joined = dev.logs.map(([, m]) => m).join('\n')
      assert.match(joined, /Objects with symbol properties/, 'symbol keys: dev console.errors')
      assert.match(joined, /Objects with toJSON methods/, 'toJSON objects: dev console.errors')
      assert.equal(prod.logs.length, 0, 'prod never tells you')
    },

    'plain baselines stay intact' () {
      for (const report of [row('plainObjectTop').d, row('plainObjectTop').p]) {
        assert.deepEqual(report.ret.client.shape.members, { ok: true })
        assert.deepEqual(report.arg.arg.shape.members, { ok: true })
      }
    },

    'Server-Function VALUES cross BOTH directions as live $h references' () {
      // The docs list "Functions that are Server Functions" as supported in
      // both directions, and the runtime exception will be: a function whose
      // $$typeof === Symbol.for('react.server.reference') passes. Pinned:
      // those encode as $h handles (NOT $T opaque), decode server-side into
      // live tagged callables, and render server->client with no error.
      for (const { d, p } of [{ d: dev.serverRefs, p: prod.serverRefs }]) {
        assert.equal(d.arg.encoded, true)
        assert.match(d.arg.wireJSON, /\$h1/, 'server-reference handle on the wire')
        assert.equal(d.arg.decodedTop.tagMatches, true, 'decoded arg carries the tag')
        assert.equal(d.arg.decodedTop.call, 'fixture-called', 'decoded arg is the callable')
        assert.equal(d.arg.decodedNested.tagMatches, true)
        assert.equal(d.arg.decodedNested.sameAsTop, true, 'nested occurrence dedups to one ref')

        assert.equal(d.ret.registeredSide.tagMatches, true, 'registerServerReference tags the fn')
        assert.equal(d.ret.serializationThrew, false, 'renders without error')
        assert.equal(d.ret.wireHasHandle, true, '$h in the render wire')

        // prod agrees (its metadata row is just leaner — no dev location info)
        assert.equal(p.arg.decodedTop.tagMatches, true)
        assert.equal(p.arg.decodedTop.call, 'fixture-called')
        assert.equal(p.ret.serializationThrew, false)
        assert.equal(p.ret.wireHasHandle, true)
      }
    },

    'Error VALUES as args arrive opaque under the Next temp-ref path' () {
      // The Next-path counterpart of finding 5's bare errorArg pin (which
      // encodes the same values at the args section). Errors are class
      // instances; with refs they do NOT throw at encode — silent placeholder.
      for (const report of [row('errorValue').d, row('errorValue').p]) {
        assert.equal(report.arg.outcome, 'decoded')
        assert.equal(report.arg.arg.kind, 'opaqueTemporaryReference')
        // S->C resolution/content divergence is already pinned by the family
        // suite (dev real / prod stand-in).
        assert.equal(report.ret.client.outcome, 'resolved')
      }
    },
  },
}
