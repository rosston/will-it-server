import { strict as assert } from 'node:assert'
import { createElement } from 'react'
import { canPassFromClientToServer, canPassFromServerToClient } from '../../src/index'

// Runtime rules mirror the characterization value matrix
// (characterization/test/flightValueMatrix.test.js, pinned at
// react-server-dom-webpack 19.3.1) and the README admission rule:
// "can pass" means ARRIVES INTACT, not "crosses at all".

function sharedCanPassTests (canPassFn: (value: unknown) => Promise<boolean>) {
  return {
    async 'returns true for strings' () {
      assert(await canPassFn(''))
      assert(await canPassFn('Hello, World!'))
    },
    async 'returns true for numbers' () {
      assert(await canPassFn(0))
      assert(await canPassFn(1))
    },
    async 'returns true for numeric specials (measured exact on the wire)' () {
      assert(await canPassFn(NaN))
      assert(await canPassFn(Infinity))
      assert(await canPassFn(-Infinity))
      assert(await canPassFn(-0))
    },
    async 'returns true for bigints' () {
      assert(await canPassFn(BigInt('9007199254740991')))
      assert(await canPassFn(BigInt('0x1fffffffffffff')))
      assert(await canPassFn(BigInt('0o377777777777777777')))
      assert(await canPassFn(BigInt('0b11111111111111111111111111111111111111111111111111111')))
    },
    async 'returns true for booleans' () {
      assert(await canPassFn(true))
      assert(await canPassFn(false))
    },
    async 'returns true for undefined' () {
      assert(await canPassFn(undefined))
    },
    async 'returns true for null' () {
      assert(await canPassFn(null))
    },
    async 'returns true for valid date' () {
      assert(await canPassFn(new Date()))
    },
    async 'returns false for invalid date (arrives as null, silently, both modes)' () {
      assert.equal(await canPassFn(new Date('nope')), false)
      assert.equal(await canPassFn({ d: new Date('nope') }), false)
    },
    async 'returns false for locally registered symbol' () {
      assert.equal(await canPassFn(Symbol('test')), false)
    },
    async 'returns true for array with primitive values' () {
      assert(await canPassFn([
        'foo',
        123,
        BigInt(42),
        true,
        false,
        undefined,
        null,
        new Date(),
      ]))
    },
    async 'returns false for array with locally registered symbol' () {
      assert.equal(
        await canPassFn([
          'foo',
          123,
          BigInt(42),
          true,
          false,
          undefined,
          null,
          new Date(),
          Symbol('other_test'),
        ]),
        false
      )
    },
    async 'returns true for set with primitive values' () {
      assert(await canPassFn(new Set<any>([
        'foo',
        123,
        BigInt(42),
        true,
        false,
        undefined,
        null,
        new Date(),
      ])))
    },
    async 'returns false for set with locally registered symbol' () {
      assert.equal(
        await canPassFn(new Set<any>([
          'foo',
          123,
          BigInt(42),
          true,
          false,
          undefined,
          null,
          Symbol('other_test'),
        ])),
        false
      )
    },
    async 'returns true for map with primitive values' () {
      assert(await canPassFn(new Map<any, any>([
        ['foo', 'bar'],
        [123, 456],
        [BigInt(42), BigInt(84)],
        [true, false],
        [false, true],
        ['null', null],
        ['undefined', undefined],
        ['date', new Date()],
      ])))
    },
    async 'returns false for map with locally registered symbol' () {
      assert.equal(
        await canPassFn(new Map<any, any>([
          ['date', new Date()],
          ['unregistered symbol', Symbol('nope')],
        ])),
        false
      )
    },
    async 'returns true for object with primitive values' () {
      assert(await canPassFn({
        foo: 'bar',
        123: 456,
        42: BigInt(84),
        true: false,
        false: true,
        null: null,
        blank: undefined,
        date: new Date(),
      }))
    },
    async 'returns false for object with locally registered symbol' () {
      assert.equal(
        await canPassFn({
          foo: 'bar',
          'unregistered symbol': Symbol('nope'),
        }),
        false
      )
    },
    async 'returns true for complex nested object full of allowed types' () {
      assert(
        await canPassFn([
          {
            foo: 'bar',
            false: true,
            null: null,
            blank: undefined,
          },
          new Map()
            .set(123, 456)
            .set(42, BigInt(84))
            .set(
              'nested',
              new Map()
                .set(true, false)
                .set('set', new Set([1, 2, 3, 3]))
                .set('arr', [
                  { 'nested arr': ['foo', new Date()] },
                ])
            )
        ])
      )
    },
    async 'returns true for promise resolving to complex nested object full of allowed types' () {
      assert(
        await canPassFn(Promise.resolve([
          { foo: 'bar' },
          new Map().set('set', new Set([1, 2, 3, 3])),
        ]))
      )
    },
    async 'returns false for complex nested object full of allowed types and unregistered symbol' () {
      assert.equal(
        await canPassFn([
          {
            foo: 'bar',
            false: true,
            null: null,
            blank: undefined,
          },
          new Map()
            .set(123, 456)
            .set(
              'nested',
              new Map()
                .set(true, false)
                .set('set', new Set([1, 2, 3, 3]))
                .set('arr', [
                  { 'nested arr': ['foo', new Date(), Symbol('unregistered')] },
                ])
            )
        ]),
        false
      )
    },
    async 'returns false for complex nested object full of allowed types and non-plain object' () {
      assert.equal(
        await canPassFn([
          {
            foo: 'bar',
            false: true,
            null: null,
            blank: undefined,
          },
          new Map()
            .set(123, 456)
            .set(
              'nested',
              new Map()
                .set(true, false)
                .set('set', new Set([1, 2, 3, 3]))
                .set('arr', [
                  {
                    'nested arr': [
                      'foo',
                      new Date(),
                      new Error('this is an error object')
                    ],
                  },
                ])
            )
        ]),
        false
      )
    },
    async 'returns false for complex nested object full of allowed types and object with null prototype' () {
      const nullProtoObj = Object.create(null)

      assert.equal(
        await canPassFn([
          {
            foo: 'bar',
            false: true,
            null: null,
            blank: undefined,
          },
          new Map()
            .set(123, 456)
            .set(
              'nested',
              new Map()
                .set(true, false)
                .set('set', new Set([1, 2, 3, 3]))
                .set('arr', [
                  { 'nested arr': ['foo', new Date(), nullProtoObj] },
                ])
            )
        ]),
        false
      )
    },
    async 'returns false for complex nested object full of allowed types and arbitrary class' () {
      class ThisIsAClass {}

      assert.equal(
        await canPassFn([
          {
            foo: 'bar',
            false: true,
            null: null,
            blank: undefined,
          },
          new Map()
            .set(123, 456)
            .set(
              'nested',
              new Map()
                .set(true, false)
                .set('set', new Set([1, 2, 3, 3]))
                .set('arr', [
                  { 'nested arr': ['foo', new Date(), ThisIsAClass] },
                ])
            )
        ]),
        false
      )
    },
    async 'returns false for complex nested object full of allowed types and arbitrary class instance' () {
      class ThisIsAClass {}

      assert.equal(
        await canPassFn([
          {
            foo: 'bar',
            false: true,
            null: null,
            blank: undefined,
          },
          new Map()
            .set(123, 456)
            .set(
              'nested',
              new Map()
                .set(true, false)
                .set('set', new Set([1, 2, 3, 3]))
                .set('arr', [
                  { 'nested arr': ['foo', new Date(), new ThisIsAClass()] },
                ])
            )
        ]),
        false
      )
    },
    async 'returns false for complex nested object full of allowed types and a function' () {
      assert.equal(
        await canPassFn([
          {
            foo: 'bar',
            false: true,
            null: null,
            blank: undefined,
          },
          new Map()
            .set(123, 456)
            .set(
              'nested',
              new Map()
                .set(true, false)
                .set('set', new Set([1, 2, 3, 3]))
                .set('arr', [
                  { 'nested arr': ['foo', new Date(), () => 'foo'] },
                ])
            )
        ]),
        false
      )
    },

    // --- value-matrix cases (characterization/test/flightValueMatrix.test.js)

    async 'returns true for binary types: ArrayBuffer and typed arrays (docs-listed, measured intact)' () {
      assert(await canPassFn(new ArrayBuffer(4)))
      assert(await canPassFn(new Uint8Array([1, 2, 3])))
      assert(await canPassFn({ b: new Int16Array([1]) }))
    },
    async 'returns false for DataView / Buffer (docs-gate / corruption)' () {
      assert.equal(await canPassFn(new DataView(new ArrayBuffer(4))), false)
      assert.equal(await canPassFn(Buffer.from([1, 2])), false)
      assert.equal(await canPassFn({ x: Buffer.from([1, 2]) }), false)
    },
    async 'returns false for docs-unlisted instance types even where they work today' () {
      // measured: these CROSS in 19.3.1 but appear on neither serializable-
      // types list ("works today, un-promised")
      assert.equal(await canPassFn(new Blob(['hello'])), false)
      assert.equal(await canPassFn(new File(['hello'], 'a.txt')), false)
      assert.equal(await canPassFn(new ReadableStream({ start (c) { c.close() } })), false)
      assert.equal(await canPassFn((async function * g () { yield 1 })()), false)
    },
    async 'returns false for RegExp / WeakMap / WeakSet' () {
      assert.equal(await canPassFn(/ab+c/gi), false)
      assert.equal(await canPassFn(new WeakMap()), false)
      assert.equal(await canPassFn(new WeakSet()), false)
    },
    async 'returns false for URL (arrives as its href string)' () {
      assert.equal(await canPassFn(new URL('https://example.com/p')), false)
    },
    async 'returns false for toJSON-bearing objects (arrive as their JSON)' () {
      assert.equal(await canPassFn({ toJSON: () => 'replaced' }), false)
      assert.equal(await canPassFn({ nested: { toJSON: () => 'replaced' } }), false)
    },
    async 'returns false for enumerable symbol-KEYED members (silently dropped from the wire)' () {
      assert.equal(await canPassFn({ [Symbol('hidden')]: 'lost?', visible: 1 }), false)
      assert.equal(await canPassFn({ visible: 1, [Symbol('hidden')]: 'lost?' }), false)
    },
    async 'returns false for a throwing getter, without crashing the check' () {
      // measured: Flight touches getters during serialization and sinks the
      // render AND the encode in both modes; the check must never crash
      const withThrower = {
        ok: 1,
        get boom () { throw new Error('getter-boom') },
      }
      assert.equal(await canPassFn(withThrower), false)
    },
    async 'returns true for cycles and shared references (identity restored; walk must terminate)' () {
      const cyclic: any = { name: 'self' }
      cyclic.self = cyclic
      assert(await canPassFn(cyclic))
      assert(await canPassFn([cyclic, { also: cyclic }]))

      const viaArray: any = { list: [] }
      viaArray.list.push(viaArray)
      assert(await canPassFn(viaArray))

      const shared = { x: 1 }
      assert(await canPassFn([shared, shared, { a: shared, b: shared }]))
    },
    async 'returns true for resolved promise members and promise-of-promise chains' () {
      assert(await canPassFn({ p: Promise.resolve('inner'), plain: 1 }))
      assert(await canPassFn([Promise.resolve('a'), 'b']))
      assert(await canPassFn(new Map([['k', Promise.resolve('v')]])))
      assert(await canPassFn({ p: Promise.resolve(Promise.resolve('deep')) }))
    },
    async 'returns false for rejected promise members' () {
      // s2c: the member arrives rejected (reason opaque in prod); c2s: the
      // encoder awaits members and the whole call sinks
      const rejected = Promise.reject(new Error('nested-reject'))
      assert.equal(await canPassFn({ p: rejected }), false)
    },
    async 'returns true for Server-Function values (docs-listed; live $h callables)' () {
      const serverRef = function serverAction () {}
      Object.defineProperty(serverRef, '$$typeof', {
        value: Symbol.for('react.server.reference'),
      })
      assert(await canPassFn(serverRef))
      assert(await canPassFn({ act: serverRef }))
      assert(await canPassFn([serverRef, serverRef]))
    },

    // promise members that are still pending must not block the check
    // (documented streaming pattern) — asserted only for the return
    // direction below, where it differs.
  }
}

export const canPassFromClientToServerTest = {
  ...sharedCanPassTests(canPassFromClientToServer),

  async 'returns false for registered symbol values (arrive as opaque placeholders as args)' () {
    // reality vetoes the docs here: even Symbol.for values arrive as
    // throw-on-touch placeholders under Next's temp-ref encode path
    assert.equal(await canPassFromClientToServer(Symbol.for('test')), false)
    assert.equal(await canPassFromClientToServer({ s: Symbol.for('test') }), false)
    assert.equal(await canPassFromClientToServer([Symbol.for('test')]), false)
  },

  async 'returns true for FormData at top level and nested (docs-listed arg type)' () {
    const fd = new FormData()
    fd.set('a', 'b')
    assert(await canPassFromClientToServer(fd))
    assert(await canPassFromClientToServer({ fd }))
    assert(await canPassFromClientToServer([fd, { nested: { fd } }]))

    const withFile = new FormData()
    withFile.set('f', new File(['x'], 'x.txt', { type: 'text/plain' }))
    assert(await canPassFromClientToServer(withFile))
  },

  async 'returns false for React elements (opaque placeholders as args)' () {
    assert.equal(await canPassFromClientToServer(createElement('div', null, 'hi')), false)
    assert.equal(await canPassFromClientToServer({ el: createElement('span') }), false)
  },

  async 'returns false for a rejected top-level promise arg (encoder awaits it; whole call sinks)' () {
    const rejected = Promise.reject(new Error('arg-reject'))
    assert.equal(await canPassFromClientToServer(rejected), false)
  },
}

export const canPassFromServerToClientTest = {
  ...sharedCanPassTests(canPassFromServerToClient),

  async 'returns true for globally registered symbol' () {
    assert(await canPassFromServerToClient(Symbol.for('test')))
    assert(await canPassFromServerToClient({ s: Symbol.for('test') }))
  },

  async 'returns true for React elements at top level and nested (docs-listed prop type)' () {
    assert(await canPassFromServerToClient(createElement('div', null, 'hi')))
    assert(await canPassFromServerToClient({ el: createElement('span') }))
    assert(await canPassFromServerToClient([createElement('p'), 'text']))
  },

  async 'returns false for FormData in returns (works in 19.3.1, un-promised by the docs)' () {
    const fd = new FormData()
    fd.set('a', 'b')
    assert.equal(await canPassFromServerToClient(fd), false)
    assert.equal(await canPassFromServerToClient({ fd }), false)
  },

  async 'returns true for a still-pending promise member without blocking (streaming pattern)' () {
    let release: ((v: unknown) => void) | undefined
    const neverSettled = new Promise((resolve) => { release = resolve })
    const start = Date.now()
    assert(await canPassFromServerToClient({ p: neverSettled }))
    assert(Date.now() - start < 1000, 'probe must not await unsettled members')
    release!(0)
  },

  async 'propagates a rejected top-level promise (contract: the caller sees the app\'s rejection)' () {
    const rejected = Promise.reject(new Error('top-reject'))
    await assert.rejects(canPassFromServerToClient(rejected), /top-reject/)
  },
}
