import { strict as assert } from 'node:assert'
import { isSerializablePrimitive } from '../../src/index'

export const isSerializablePrimitiveTest = {
  'returns true for strings' () {
    assert(isSerializablePrimitive(''))
    assert(isSerializablePrimitive('Hello, World!'))
  },
  'returns true for numbers' () {
    assert(isSerializablePrimitive(0))
    assert(isSerializablePrimitive(1))
  },
  'returns true for bigints' () {
    assert(isSerializablePrimitive(BigInt('9007199254740991')))
    assert(isSerializablePrimitive(BigInt('0x1fffffffffffff')))
    assert(isSerializablePrimitive(BigInt('0o377777777777777777')))
    assert(isSerializablePrimitive(BigInt('0b11111111111111111111111111111111111111111111111111111')))
  },
  'returns true for booleans' () {
    assert(isSerializablePrimitive(true))
    assert(isSerializablePrimitive(false))
  },
  'returns true for undefined' () {
    assert(isSerializablePrimitive(undefined))
  },
  'returns true for null' () {
    assert(isSerializablePrimitive(null))
  },
  'returns true for globally registered symbol' () {
    assert(isSerializablePrimitive(Symbol.for('test')))
  },
  'returns false for locally registered symbol' () {
    assert.equal(isSerializablePrimitive(Symbol('test')), false)
  },
  'returns false for date' () {
    assert.equal(isSerializablePrimitive(new Date()), false)
  },
  'returns false for array' () {
    assert.equal(isSerializablePrimitive([]), false)
  },
  'returns false for map' () {
    assert.equal(isSerializablePrimitive(new Map()), false)
  },
  'returns false for set' () {
    assert.equal(isSerializablePrimitive(new Set()), false)
  },
}
