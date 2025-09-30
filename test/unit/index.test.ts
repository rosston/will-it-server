import { strict as assert } from 'node:assert'
import { serverFunction } from '../../src/index'

export const serverFunctionTest = {
  'returns a function that calls the provided function' () {
    const func = serverFunction(() => 'Hello, World!')
    assert.equal(func(), 'Hello, World!')
  },
  async 'returns an async function that calls the provided async function' () {
    const func = serverFunction(() => Promise.resolve('Hello, World!'))
    assert.equal(await func(), 'Hello, World!')
  },
}
