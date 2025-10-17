import isPlainObject from 'is-plain-obj'
import type { ReactNode } from 'react'
import * as ReactIs from 'react-is'

export type SerializablePrimitive =
  | string
  | number
  | bigint
  | boolean
  | undefined
  | null
  // symbol is overly broad and not always serializable, but keep the types loose
  | symbol

// https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/TypedArray#typedarray_objects
type TypedArray =
  | Int8Array
  | Uint8Array
  | Uint8ClampedArray
  | Int16Array
  | Uint16Array
  | Int32Array
  | Uint32Array
  | Float16Array
  | Float32Array
  | Float64Array
  | BigInt64Array
  | BigUint64Array

export type SerializableIterable =
  | Array<SerializablePrimitive>
  | ReadonlyArray<SerializablePrimitive>
  | Map<SerializablePrimitive, SerializablePrimitive>
  | ReadonlyMap<SerializablePrimitive, SerializablePrimitive>
  | Set<SerializablePrimitive>
  | ReadonlySet<SerializablePrimitive>
  | ArrayBuffer
  | TypedArray

type SerializableValue = SerializablePrimitive | SerializableIterable | Date

// Try to enforce
// https://react.dev/reference/rsc/use-server#serializable-parameters-and-return-values
type ClientToServerSerializableSyncValue =
  | SerializableValue
  | FormData
  | Record<string, SerializableValue>
  // this is overly broad and not always serializable, but keep the types loose
  | { }

export type ClientToServerSerializableValue =
  | ClientToServerSerializableSyncValue
  | Promise<ClientToServerSerializableSyncValue>

// Try to enforce https://react.dev/reference/rsc/use-client#serializable-types
type ServerToClientSerializableSyncValue =
  | SerializableValue
  | Record<string, SerializableValue>
  | ReactNode
  // this is overly broad and not always serializable, but keep the types loose
  | { }

export type ServerToClientSerializableValue =
  | ServerToClientSerializableSyncValue
  | Promise<ServerToClientSerializableSyncValue>

export function isSerializablePrimitive (
  value: unknown
): value is SerializablePrimitive {
  return (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'bigint' ||
    typeof value === 'boolean' ||
    typeof value === 'undefined' ||
    value === null ||
    (typeof value === 'symbol' && Boolean(Symbol.keyFor(value)))
  )
}

function canPassInEitherDirection (value: unknown): boolean {
  if (isSerializablePrimitive(value)) {
    return true
  }

  if (value instanceof Date) {
    return true
  }

  if (Array.isArray(value) || value instanceof Set) {
    let isFlatIterableSerializable = true
    for (const arg of value) {
      if (!canPassInEitherDirection(arg)) {
        isFlatIterableSerializable = false
        break
      }
    }
    return isFlatIterableSerializable
  }

  if (value instanceof Map) {
    let isMapSerializable = true
    for (const [k, v] of value) {
      if (!canPassInEitherDirection(k) || !canPassInEitherDirection(v)) {
        isMapSerializable = false
        break
      }
    }
    return isMapSerializable
  }

  if (isPlainObject(value) && Object.getPrototypeOf(value) !== null) {
    let isObjectSerializable = true
    for (const [k, v] of Object.entries(value)) {
      if (!canPassInEitherDirection(k) || !canPassInEitherDirection(v)) {
        isObjectSerializable = false
        break
      }
    }
    return isObjectSerializable
  }

  return false
}

// Try to enforce
// https://react.dev/reference/rsc/use-server#serializable-parameters-and-return-values
export async function canPassFromClientToServer (value: unknown): Promise<boolean> {
  const resolvedValue = (value && typeof value === 'object' && 'then' in value)
    ? await Promise.resolve(value)
    : value
  return canPassInEitherDirection(resolvedValue) || resolvedValue instanceof FormData
}

// Try to enforce https://react.dev/reference/rsc/use-client#serializable-types
export async function canPassFromServerToClient (value: unknown): Promise<boolean> {
  const resolvedValue = (value && typeof value === 'object' && 'then' in value)
    ? await Promise.resolve(value)
    : value
  return canPassInEitherDirection(resolvedValue) || ReactIs.isElement(resolvedValue)
}

export function serverFunction<
  T extends ClientToServerSerializableValue,
  U extends ServerToClientSerializableValue
> (
  fn: (...args: T[]) => U,
  { checksEnabled = true }: { checksEnabled?: boolean } = {
    checksEnabled: true,
  }
): (...receivedArgs: T[]) => Promise<Awaited<U>> {
  return async (...receivedArgs: T[]) => {
    if (!checksEnabled) {
      return Promise.resolve(fn(...receivedArgs))
    }

    if (!await canPassFromClientToServer(receivedArgs)) {
      console.error(
        'Server function was passed arguments that may not be serializable.'
      )
    }
    const result = fn(...receivedArgs)
    if (!await canPassFromServerToClient(result)) {
      console.error(
        'Server function returned a value that may not be serializable.'
      )
    }
    return result
  }
}
