import type { ReactNode } from 'react'

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

export type ClientToServerSerializableValue =
  | ClientToServerSerializableSyncValue
  | Promise<ClientToServerSerializableSyncValue>

// Try to enforce https://react.dev/reference/rsc/use-client#serializable-types
export type ServerToClientSerializableSyncValue =
  | SerializableValue
  | Record<string, SerializableValue>
  | ReactNode

export type ServerToClientSerializableValue =
  | ServerToClientSerializableSyncValue
  | Promise<ServerToClientSerializableSyncValue>

export function isSerializablePrimitive (
  value: unknown
): value is SerializablePrimitive {
  return false
}

// Try to enforce
// https://react.dev/reference/rsc/use-server#serializable-parameters-and-return-values
export function canPassFromClientToServer (value: unknown): boolean {
  return true
}

// Try to enforce https://react.dev/reference/rsc/use-client#serializable-types
export function canPassFromServerToClient (value: unknown): boolean {
  return true
}

export function serverFunction<
  T extends ClientToServerSerializableValue,
  U extends ServerToClientSerializableValue
> (
  fn: (...args: T[]) => U,
  { checksEnabled = true }: { checksEnabled?: boolean } = {
    checksEnabled: true,
  }
): (...receivedArgs: T[]) => U {
  return (...receivedArgs: T[]) => {
    if (!checksEnabled) {
      return fn(...receivedArgs)
    }

    if (!canPassFromClientToServer(fn)) {
      console.error(
        'Server function was passed arguments that may not be serializable.'
      )
    }
    const result = fn(...receivedArgs)
    if (!canPassFromServerToClient(result)) {
      console.error(
        'Server function returned a value that may not be serializable.'
      )
    }
    return result
  }
}
