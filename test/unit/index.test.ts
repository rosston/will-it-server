import { strict as assert } from 'node:assert'
import { serverFunction } from '../../src/index'

export const serverFunctionTest = {
  'returns a function that calls the provided function' () {
    const func = serverFunction(() => 'Hello, World!')
    assert.equal(func(), 'Hello, World!')
  },
}
