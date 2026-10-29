import { expectError, expectType } from 'tsd'
import type { ReactElement, ReactNode } from 'react'
import { serverFunction } from '../../src/index'

// Boundary type-checks, pinned as executable tests. Each arm mirrors a
// behavior observed in the characterization suite; the walkers in
// src/index.ts document how they are derived.

interface PlainTodo { id: number; text: string; completed: boolean }
interface TodoLike extends Record<string, any> { id: number; text: string; completed: boolean }
class Greeter { constructor (public name: string) {} greet () { return `hi ${this.name}` } }
class Point { constructor (public x: number, public y: number) {} }
class ValidationError extends Error {}
interface Callback { (): void }

// =========================================================================
// Accepted — the existing API must keep compiling these (and more)
// =========================================================================

// primitives, Date, symbols stay acceptable (loose, as before)
serverFunction((s: string, n: number, b: boolean, d: Date, sym: symbol) => ({ s, n, b, d, sym }))
// interface-typed data objects: pinned by the existing test-d files — must
// stay accepted (this is why the check walks members instead of demanding
// an index signature)
serverFunction((t: PlainTodo) => [t, null, 'x'])
// the exact example-app shapes (examples/next-16 todoActions.ts)
serverFunction(async function getTodos (): Promise<TodoLike[]> { return [] })
const createTodo = serverFunction(async function createTodo (text: string): Promise<TodoLike> {
  return { id: 1, text, completed: false }
})
expectType<Promise<TodoLike>>(createTodo('x'))
// deep nesting, readonly arrays, tuples, optional/rest parameters
serverFunction((t: { deep: { nested: { list: ReadonlyArray<PlainTodo> } } }) => 1 as const)
serverFunction((a?: string, ...rest: number[]) => a ?? 'x')
serverFunction((t: readonly [string, number]) => 1)
// Map/Set with nested plain values (looser than the old unions allowed)
serverFunction((m: Map<string, PlainTodo>) => new Set<number>([1, 2, 3]))
// top-level promises both directions
serverFunction((p: Promise<string>) => Promise.resolve({ ok: true }))
// FormData client -> server, ArrayBuffer/typed arrays both directions
serverFunction((f: FormData) => 'stored')
serverFunction((buf: Uint8Array, ab: ArrayBuffer) => buf)
// any/unknown passthrough (runtime checks are the backstop)
serverFunction((x: unknown, y: any) => 1)
// void / side-effect functions
serverFunction(() => { console.log('side effect') })
// ReactElement / ReactNode returns pass wholesale (what Flight does with
// element internals is React's own concern)
declare const el: ReactElement
serverFunction(() => el)
declare const node: ReactNode
serverFunction(() => node)
// data-only class: invisible to the type layer (a method-free class is
// structurally indistinguishable from a plain object/interface). NOTE: the
// runtime check is STRICTER here — canPassFromServerToClient({p: new Point()})
// is false (isPlainObject fails on the prototype) — so types may allow what
// the runtime console.errors. Known, deliberate gap.
serverFunction((p: Point) => 1)
// recursive interfaces walk lazily
interface Cyclic { child: Cyclic }
serverFunction((c: Cyclic) => 1)
// generic passthrough definitions stay usable
const passThrough = serverFunction(<T extends PlainTodo>(x: T) => x)
expectType<Promise<PlainTodo>>(passThrough({ id: 1, text: 'a', completed: false }))
// option object position unaffected by the brand
serverFunction(() => 1, { checksEnabled: false })

// =========================================================================
// Rejected — argument direction (client -> server)
// =========================================================================

// callback argument
expectError(serverFunction((cb: () => void) => 1))
// callable interface argument
expectError(serverFunction((cb: Callback) => 1))
// function-valued property
expectError(serverFunction((x: { cb: () => void }) => 1))
// optional function property
expectError(serverFunction((x: { cb?: () => void }) => 1))
// union property including a function
expectError(serverFunction((x: { cb: (() => void) | null }) => 1))
// function array
expectError(serverFunction((fns: Array<() => void>) => 1))
// URL argument (toJSON(): string is a function member)
expectError(serverFunction((u: URL) => 1))
// URLSearchParams argument (structural ReadonlyMap impostor)
expectError(serverFunction((p: URLSearchParams) => 1))
// class with methods as argument
expectError(serverFunction((g: Greeter) => 1))
// Map with function values
expectError(serverFunction((m: Map<string, () => void>) => 1))
// nested promise argument (matches runtime policy)
expectError(serverFunction((x: { p: Promise<string> }) => 1))
// doubly-wrapped promise
expectError(serverFunction((p: Promise<Promise<string>>) => 1))
// WeakMap argument
expectError(serverFunction((w: WeakMap<object, string>) => 1))
// hazard at depth 12
type Deep12 = { l1: { l2: { l3: { l4: { l5: { l6: { l7: { l8: { l9: { l10: { l11: { l12: { cb: () => void } } } } } } } } } } } } }
expectError(serverFunction((d: Deep12) => 1))

// Nesting headroom: measured against TypeScript 5.9 (Oct 2026), the walkers
// descend linear chains cleanly and detect hazards to at
// least depth 80 in BOTH directions. The real limit is TS's own relation-
// comparison stack budget (~depth 90+), and past it the check FAILS CLOSED:
// TS2321 aborts the comparison as not-assignable, so even a legitimate deep
// type starts erroring at the serverFunction call — a hazard can never slip
// through silently by being "too deep". Pinning depth 32 as comfortably
// supported; if a future TS release moves the cliff below this, these lines
// fail loudly instead of quietly.
type Deep32Clean = { l1: { l1: { l1: { l1: { l1: { l1: { l1: { l1: { l1: { l1: { l1: { l1: { l1: { l1: { l1: { l1: { l1: { l1: { l1: { l1: { l1: { l1: { l1: { l1: { l1: { l1: { l1: { l1: { l1: { l1: { l1: { l1: string } } } } } } } } } } } } } } } } } } } } } } } } } } } } } } } }
serverFunction(() => null as unknown as Deep32Clean)
serverFunction((c: Deep32Clean) => 1)
type Deep32Hazard = { l1: { l1: { l1: { l1: { l1: { l1: { l1: { l1: { l1: { l1: { l1: { l1: { l1: { l1: { l1: { l1: { l1: { l1: { l1: { l1: { l1: { l1: { l1: { l1: { l1: { l1: { l1: { l1: { l1: { l1: { l1: { l1: { cb: () => void } } } } } } } } } } } } } } } } } } } } } } } } } } } } } } } } }
expectError(serverFunction(() => null as unknown as Deep32Hazard))
expectError(serverFunction((h: Deep32Hazard) => 1))

// =========================================================================
// Rejected — return direction (server -> client)
// =========================================================================

// FLAGSHIP: returned Error (opaque stand-in in prod)
expectError(serverFunction(() => new Error('could not complete the todo')))
// Error in a union with good members
expectError(serverFunction(async (id: string) => {
  if (id.length === 0) return new Error('invalid id')
  return { id, done: false }
}))
// nested Error in a returned object
expectError(serverFunction(() => ({ error: new Error('x') })))
// Error behind a resolved promise
expectError(serverFunction(() => Promise.resolve(new Error('x'))))
// TypeError (whole instanceof-Error family)
expectError(serverFunction(() => new TypeError('x')))
// custom Error subclass
expectError(serverFunction(() => new ValidationError('x')))
// Error with custom fields (Error & { code })
expectError(serverFunction(() => Object.assign(new Error('x'), { code: 'BAD' })))
// annotated widened union that admits Error
expectError(serverFunction((): PlainTodo | Error => null as never))
// union including URL
expectError(serverFunction((): PlainTodo | URL => null as never))
// returned function
expectError(serverFunction(() => () => 1))
// returned object with a method
expectError(serverFunction(() => ({ greet () { return 'hi' } })))
// returned class instance with methods
expectError(serverFunction(() => new Greeter('x')))
// class instance with methods inside a returned array
expectError(serverFunction(() => [new Greeter('x')]))
// returned FormData (cannot cross server->client)
expectError(serverFunction(() => new FormData()))
// returned URL
expectError(serverFunction(() => new URL('https://example.com')))
// Error in Map value return
expectError(serverFunction(() => new Map<string, Error>([['e', new Error('x')]])))

// =========================================================================
// Documented limits — these compile and MUST stay that way
// =========================================================================

// invalid Date is invisible to the type system
serverFunction((d: Date) => d)
serverFunction(() => new Date('nope'))
// Record<string, unknown> payloads pass (opaque members)
serverFunction((): Record<string, unknown> => ({}))

// KNOWN FALSE POSITIVE: a data-only { name, message } return is
// structurally indistinguishable from Error. Pinned so the tradeoff stays
// visible (and can be revisited if we ever scope it to non-literals).
interface Chat { name: string; message: string }
expectError(serverFunction(() => ({ name: 'chat', message: 'hello' })))

// The FP is deliberately return-only: in the argument direction, Errors fail
// loudly at ENCODE in both modes (characterization finding 5), so banning the
// lookalike shape there buys no new signal — Chat passes args freely.
serverFunction((c: Chat) => 'ok')
// Supersets don't help: extra members still extend Error.
expectError(serverFunction(() => ({ name: 'a', message: 'b', code: 500 })))
// And the FP mechanism is exactly what blocks Error-in-disguise: a `(): Chat`
// annotation is a legal Error carrier (Error is assignable to Chat!), so the
// same structural match that false-positives on the chat shape also refuses
// to let a real Error hide behind it.
expectError(serverFunction((): Chat => new Error('x') as unknown as Chat))
// The surgical escape (cheaper than .unchecked): rename either required
// member and the type stops extending Error.
serverFunction(() => ({ title: 'chat', message: 'hello' }))

// =========================================================================
// The escape hatch: serverFunction.unchecked
// =========================================================================

// hazards on the static walk compile through .unchecked…
const esc1 = serverFunction.unchecked((cb: () => void) => cb)
const esc2 = serverFunction.unchecked(() => new Error('x'))
const esc3 = serverFunction.unchecked(() => ({ name: 'chat', message: 'hello' }))
// …while wrapper types are fully preserved: correct calls work,
expectType<Promise<() => void>>(esc1(() => {}))
expectType<Promise<Error>>(esc2())
expectType<Promise<{ name: string; message: string }>>(esc3())
// arity/order are still enforced through the escape
expectError(esc1())
expectError(esc1('not a function'))
// and the checked path is unchanged
expectError(serverFunction(() => new Error('x')))
