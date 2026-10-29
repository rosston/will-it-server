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

// ---------------------------------------------------------------------------
// Compile-time boundary checks.
//
// The unions above bottom out in `{ }` and so accept nearly anything. These
// walkers instead DERIVE the check from the value's own inferred type: walk
// the shape, replacing members that cannot cross the boundary with `never`,
// then require the original type to still be assignable to its walked form.
// The check lives in an intersection on the `fn` parameter (not in a generic
// constraint — `T extends Walk<T>` is banned by TS2313, and a constraint's
// contravariance would flip `never` back to permissive for arguments).
//
// What this catches: functions/callbacks anywhere (including class methods,
// URL.toJSON, callable interfaces); the whole instanceof-Error family in
// return position (dev-rebuilt, prod-opaque — the flagship hazard); nested
// promises beyond the top level; FormData going server->client; WeakMap/
// WeakSet; known structural impostors (URLSearchParams poses as a
// ReadonlyMap; Buffer poses as a Uint8Array when @types/node is present).
//
// What it cannot catch (runtime checks remain the backstop): invalid Dates
// (`new Date('nope')` crosses as `null`), runtime class instances typed via
// data-only interfaces, throwing getters, cycles-as-values, values widened
// through `any`/`unknown` annotations. One deliberate FALSE POSITIVE: a
// return value shaped exactly `{ name, message }` is indistinguishable from
// `Error` — a structural type system's irreducible limit; annotate or
// restructure (which is the right fix for prod anyway).
// ---------------------------------------------------------------------------

type BoundaryLeaf =
  | string
  | number
  | bigint
  | boolean
  | symbol // overly broad (only registered symbols cross) but kept loose, as before
  | null
  | undefined
  | void

// lib.dom classes that structurally satisfy the built-in arms below and
// would otherwise walk as legitimate: URLSearchParams is structurally a
// ReadonlyMap<string, string | null>, and Buffer (when @types/node is in
// scope) is structurally a Uint8Array. They must be rejected before the
// Date/ArrayBuffer/Map/Set/FormData arms get a chance to wave them through.
type BoundaryImpostors = URLSearchParams | { readUInt8 (...args: any[]): any }

// Client -> server (arguments). Errors are NOT rejected here: as arguments
// they fail loudly at encode time in both dev and prod (characterization
// finding 5), so a structural ban would only add `{ name, message }`
// lookalike false positives without informing anyone about new hazards.
type ClientToServerSync<T> =
  T extends BoundaryLeaf ? T
    : T extends (...args: never[]) => unknown ? never
      : T extends abstract new (...args: never[]) => unknown ? never
        : T extends BoundaryImpostors ? never
          : T extends Date ? T
            : T extends ArrayBuffer | ArrayBufferView ? T
              : T extends FormData ? T
                : T extends Map<infer K, infer V> ? Map<ClientToServerSync<K>, ClientToServerSync<V>>
                  : T extends ReadonlyMap<infer K, infer V> ? ReadonlyMap<ClientToServerSync<K>, ClientToServerSync<V>>
                    : T extends Set<infer V> ? Set<ClientToServerSync<V>>
                      : T extends ReadonlySet<infer V> ? ReadonlySet<ClientToServerSync<V>>
                        : T extends WeakMap<object, unknown> ? never
                          : T extends WeakSet<object> ? never
                          // homomorphic mapped type: preserves optionality, readonly, index
                          // signatures, arrays/tuples; recurses one member level at a time.
                            : T extends object ? { [K in keyof T]: ClientToServerSync<T[K]> }
                            // any / unknown: opaque. The runtime check is the backstop.
                              : unknown extends T ? T
                                : never

type ClientToServerArgument<T> =
  T extends PromiseLike<infer V> ? PromiseLike<ClientToServerSync<V>>
    : ClientToServerSync<T>

// Server -> client (return values). Errors collapse (silently opaque in
// prod — the reason this library exists). ReactNode passes wholesale:
// ReactElement.type legitimately holds function types, and what Flight does
// with element internals is React's own concern. FormData cannot cross this
// direction. Promises are allowed at the top level only (matching the
// runtime checks).
type ServerToClientSync<T> =
  T extends Error ? never
    : T extends BoundaryLeaf ? T
      : T extends (...args: never[]) => unknown ? never
        : T extends abstract new (...args: never[]) => unknown ? never
          : T extends BoundaryImpostors ? never
            : T extends ReactNode ? T
              : T extends Date ? T
                : T extends ArrayBuffer | ArrayBufferView ? T
                  : T extends FormData ? never
                    : T extends Map<infer K, infer V> ? Map<ServerToClientSync<K>, ServerToClientSync<V>>
                      : T extends ReadonlyMap<infer K, infer V> ? ReadonlyMap<ServerToClientSync<K>, ServerToClientSync<V>>
                        : T extends Set<infer V> ? Set<ServerToClientSync<V>>
                          : T extends ReadonlySet<infer V> ? ReadonlySet<ServerToClientSync<V>>
                            : T extends WeakMap<object, unknown> ? never
                              : T extends WeakSet<object> ? never
                                : T extends object ? { [K in keyof T]: ServerToClientSync<T[K]> }
                                  : unknown extends T ? T
                                    : never

type ServerToClientReturn<T> =
  T extends PromiseLike<infer V> ? PromiseLike<ServerToClientSync<V>>
    : ServerToClientSync<T>

type WalkedArguments<Args extends readonly unknown[]> = { [K in keyof Args]: ClientToServerArgument<Args[K]> }

// Tuple-wrapped comparisons are NON-distributive on purpose. Bare
// `Ret extends Walk<Ret>` distributes per union member, so a valid member
// produces the passing branch and the spread/intersection check never
// fires for `Todo | Error`.
type BoundaryViolation<Args extends readonly unknown[], Ret> =
  [Args] extends [WalkedArguments<Args>]
    ? [Ret] extends [ServerToClientReturn<Ret>]
      // the "clean" brand: an optional property nothing has, so every
      // function remains assignable to it
        ? { readonly __willItServerBoundaryOk?: never }
        : { readonly __willItServerReturnHazard: 'will-it-server: this return type cannot survive the server\u2192client boundary (Errors arrive as an opaque stand-in in production; no functions; no FormData; see README)' }
    : { readonly __willItServerArgsHazard: 'will-it-server: these argument types cannot cross the client\u2192server boundary (no functions/callbacks, no nested promises, no class instances with methods; see README)' }

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
  Args extends readonly unknown[],
  Ret
> (
  fn: ((...args: Args) => Ret) & BoundaryViolation<Args, Ret>,
  { checksEnabled = true }: { checksEnabled?: boolean } = {
    checksEnabled: true,
  }
): (...receivedArgs: Args) => Promise<Awaited<Ret>> {
  return async (...receivedArgs: Args): Promise<Awaited<Ret>> => {
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
    return Promise.resolve(result)
  }
}
