import { expectAssignable } from 'tsd'
import { type ClientToServerSerializableValue } from '../../src/index'

expectAssignable<ClientToServerSerializableValue>('foo')
expectAssignable<ClientToServerSerializableValue>({ foo: 'bar' })

interface Foo {
  foo: string;
}

const foo: Foo = { foo: 'bar' }
expectAssignable<ClientToServerSerializableValue>(foo)

// TODO: fill out these tests
