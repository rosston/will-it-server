import { strict as assert } from 'node:assert'
import { serverFunction } from '../../src/index'

export const serverFunctionTest = {
  async 'returns an async function that calls the provided function' () {
    const func = serverFunction(() => 'Hello, World!')
    assert.equal(await func(), 'Hello, World!')
  },
  async 'returns an async function that calls the provided async function' () {
    const func = serverFunction(() => Promise.resolve('Hello, World!'))
    assert.equal(await func(), 'Hello, World!')
  },
  // TODO: test that console error happens when not client to server safe
  // TODO: test that console error happens when not server to client safe
  // TODO: test that two console errors happen when not safe in either direction
}
