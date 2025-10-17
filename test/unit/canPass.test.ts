import { strict as assert } from 'node:assert'
import { canPassFromClientToServer, canPassFromServerToClient } from '../../src/index'

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
    async 'returns true for globally registered symbol' () {
      assert(await canPassFn(Symbol.for('test')))
    },
    async 'returns true for date' () {
      assert(await canPassFn(new Date()))
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
        Symbol.for('test'),
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
          Symbol.for('test'),
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
        Symbol.for('test'),
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
          Symbol.for('test'),
          new Date(),
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
        ['registered symbol', Symbol.for('test')],
      ])))
    },
    async 'returns false for map with locally registered symbol' () {
      assert.equal(
        await canPassFn(new Map<any, any>([
          ['foo', 'bar'],
          [123, 456],
          [BigInt(42), BigInt(84)],
          [true, false],
          [false, true],
          ['null', null],
          ['undefined', undefined],
          ['date', new Date()],
          ['registered symbol', Symbol.for('test')],
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
        'registered symbol': Symbol.for('test'),
      }))
    },
    async 'returns false for object with locally registered symbol' () {
      assert.equal(
        await canPassFn({
          foo: 'bar',
          123: 456,
          42: BigInt(84),
          true: false,
          false: true,
          null: null,
          blank: undefined,
          date: new Date(),
          'registered symbol': Symbol.for('test'),
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
                  { 'registered symbol': Symbol.for('test') },
                  { 'nested arr': ['foo', new Date()] },
                ])
            )
        ])
      )
    },
    async 'returns true for promise resolving to complex nested object full of allowed types' () {
      assert(
        await canPassFn(Promise.resolve([
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
                  { 'registered symbol': Symbol.for('test') },
                  { 'nested arr': ['foo', new Date()] },
                ])
            )
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
            .set(42, BigInt(84))
            .set(
              'nested',
              new Map()
                .set(true, false)
                .set('set', new Set([1, 2, 3, 3]))
                .set('arr', [
                  { 'registered symbol': Symbol.for('test') },
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
            .set(42, BigInt(84))
            .set(
              'nested',
              new Map()
                .set(true, false)
                .set('set', new Set([1, 2, 3, 3]))
                .set('arr', [
                  { 'registered symbol': Symbol.for('test') },
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
            .set(42, BigInt(84))
            .set(
              'nested',
              new Map()
                .set(true, false)
                .set('set', new Set([1, 2, 3, 3]))
                .set('arr', [
                  { 'registered symbol': Symbol.for('test') },
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
            .set(42, BigInt(84))
            .set(
              'nested',
              new Map()
                .set(true, false)
                .set('set', new Set([1, 2, 3, 3]))
                .set('arr', [
                  { 'registered symbol': Symbol.for('test') },
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
            .set(42, BigInt(84))
            .set(
              'nested',
              new Map()
                .set(true, false)
                .set('set', new Set([1, 2, 3, 3]))
                .set('arr', [
                  { 'registered symbol': Symbol.for('test') },
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
            .set(42, BigInt(84))
            .set(
              'nested',
              new Map()
                .set(true, false)
                .set('set', new Set([1, 2, 3, 3]))
                .set('arr', [
                  { 'registered symbol': Symbol.for('test') },
                  { 'nested arr': ['foo', new Date(), () => 'foo'] },
                ])
            )
        ]),
        false
      )
    },
  }
}

export const canPassFromClientToServerTest = {
  ...sharedCanPassTests(canPassFromClientToServer),
  // TODO: test that FormData is allowed
  // TODO: test that React elements are not allowed
}

export const canPassFromServerToClientTest = {
  ...sharedCanPassTests(canPassFromServerToClient),
  // TODO: test that FormData is not allowed
  // TODO: test that React elements are allowed
}
