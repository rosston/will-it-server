import { expectType } from 'tsd'
import { serverFunction } from '../../src/index'

const someServerFunction = serverFunction(async (input: string) => {
  return { input }
})

expectType<Promise<{ input: string }>>(someServerFunction('test'))
// TODO: test that async-ification happens?
