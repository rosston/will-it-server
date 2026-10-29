import { strict as assert } from 'node:assert'
import { serverFunction } from '../../src/index'

// Swaps out console.error for the duration of `run` and hands back the
// captured messages. Restores the original even when assertions fail.
async function withCapturedConsoleErrors (run: () => Promise<unknown>): Promise<string[]> {
  const errors: string[] = []
  const originalError = console.error
  console.error = (...args: unknown[]): void => { errors.push(args.map(String).join(' ')) }
  try {
    await run()
  } finally {
    console.error = originalError
  }
  return errors
}

export const serverFunctionTest = {
  async 'returns an async function that calls the provided function' () {
    const func = serverFunction(() => 'Hello, World!')
    assert.equal(await func(), 'Hello, World!')
  },
  async 'returns an async function that calls the provided async function' () {
    const func = serverFunction(() => Promise.resolve('Hello, World!'))
    assert.equal(await func(), 'Hello, World!')
  },
  async 'console.errors when passed a value that is not client to server safe' () {
    // declared `unknown` so the static walk passes: the warning can only
    // come from the runtime layer — which is exactly what this tests
    const func = serverFunction((x: unknown) => typeof x)
    const errors = await withCapturedConsoleErrors(async () => {
      assert.equal(await func(() => {}), 'function')
    })
    assert.equal(errors.length, 1, 'only the arguments warning')
    assert.ok(errors[0].includes('arguments'), `got: ${errors[0]}`)
  },
  async 'console.errors when returned a value that is not server to client safe' () {
    const func = serverFunction((): unknown => new Error('opaque in production'))
    const errors = await withCapturedConsoleErrors(async () => {
      const result = await func() as Error
      // warns, but does not alter what the function returns
      assert.equal(result.message, 'opaque in production')
    })
    assert.equal(errors.length, 1, 'only the returned-value warning')
    assert.ok(errors[0].includes('returned'), `got: ${errors[0]}`)
  },
  async 'console.errors once per direction when neither side is safe' () {
    const func = serverFunction((x: unknown): unknown => new Error('x'))
    const errors = await withCapturedConsoleErrors(async () => {
      await func(() => {})
    })
    assert.equal(errors.length, 2, `got ${errors.length}: ${errors.join(' | ')}`)
    assert.ok(errors.some((e) => e.includes('arguments')), 'arguments warning present')
    assert.ok(errors.some((e) => e.includes('returned')), 'returned warning present')
  },
  async 'unchecked skips the static walk but the wrapper and runtime checks remain' () {
    // a callback argument is exactly what the static walk rejects…
    const func = serverFunction.unchecked((cb: () => void) => 'ok')
    const errors = await withCapturedConsoleErrors(async () => {
      // …yet the wrapper stays typed…
      assert.equal(await func(() => {}), 'ok')
    })
    // …and the runtime check still ran for the unsafely-typed arg
    assert.ok(errors.some((e) => e.includes('arguments')), 'runtime check ran')
  },
}
