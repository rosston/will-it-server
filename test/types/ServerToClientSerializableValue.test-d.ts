import { expectAssignable } from 'tsd'
import { type ServerToClientSerializableValue } from '../../src/index'

expectAssignable<ServerToClientSerializableValue>('foo')
expectAssignable<ServerToClientSerializableValue>({ foo: 'bar' })

interface Foo {
  foo: string;
}

const foo: Foo = { foo: 'bar' }
expectAssignable<ServerToClientSerializableValue>(foo)

// TODO: fill out these tests
