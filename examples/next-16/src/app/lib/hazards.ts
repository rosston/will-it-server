'use server'

import { serverFunction } from 'will-it-server'

// Hazard demos, wired to the will-it-server README's boundary matrix.
//
// Every @ts-expect-error below is a load-bearing test pin, not a cleanup
// TODO: `tsc --noEmit` fails if the will-it-server walk STOPS rejecting the
// site (the directive goes unused, TS2578) — and if the walk starts
// rejecting a site that must stay accepted, that error shows up here too.
// Two authoring rules worth remembering:
//   1. The directives sit on the `serverFunction(...)` call line — the
//      brand reports at the wrapper call site, not inside the body.
//   2. Hazards are annotated honestly (`Promise<Error>`, never widened to
//      `unknown`): widening is exactly how values hide from the walk.
//      That's the runtime layer's job — see crossUnknownArg below.

// Flagship hazard: a server function RETURNING an Error instead of
// throwing it. Dev delivers the real error; a production build silently
// swaps it for an opaque stand-in. The type layer rejects the shape
// outright, in every mode.
// @ts-expect-error — Error in return position: dev delivers it, prod swaps it for an opaque stand-in
export const saveBuggy = serverFunction(async function saveBuggy (text: string): Promise<Error> {
  return new Error(`could not save "${text}"`)
})

// Callbacks can never cross the boundary (Server Function VALUES excepted).
// @ts-expect-error — callback argument: rejected by the static walk
export const withCallback = serverFunction(async function withCallback (onChange: () => void): Promise<string> {
  return `registered (callback: ${typeof onChange})`
})

// The documented compile-time false positive: a returned plain
// `{ name, message }` is structurally indistinguishable from an Error and
// is rejected on purpose. The fix is the result shape below (saveResult).
// @ts-expect-error — { name, message } reads as an Error: the intentional, documented false positive
export const toChatMessage = serverFunction(async function toChatMessage (): Promise<{ name: string; message: string }> {
  return { name: 'new chat', message: 'straight across — unless it reads as an Error' }
})

// Clean contrast: the recommended result shape passes the walk untouched.
export const saveResult = serverFunction(async function saveResult (text: string): Promise<{ ok: boolean; reason?: string }> {
  if (text.trim() === '') {
    return { ok: false, reason: 'text must not be empty' }
  }
  return { ok: true }
})

// Runtime-only hazards: the `unknown` annotations hide these from the type
// layer BY DESIGN, so the runtime walker is what flags them — in dev/test
// runs; production builds never run checks.

// A URL argument: the runtime walker warns client->server when the real
// value crosses. The body only reads `typeof` on it — property access can
// still throw on Next's throw-on-touch stand-ins.
export const crossUnknownArg = serverFunction(async function crossUnknownArg (value: unknown): Promise<string> {
  return `received ${typeof value}, untouched`
})

// A URL return: the runtime walker warns server->client; whatever crosses
// arrives as the href string.
export const crossUnknownReturn = serverFunction(async function crossUnknownReturn (): Promise<unknown> {
  return new URL('https://will-it-server.dev/probe')
})

// The escape hatch: `unchecked` skips the static walk, so the `{ name,
// message }` shape compiles. Deliberate: the actual value IS a plain
// object, not an Error — the runtime walker agrees and lets it cross
// intact. See the README for when `unchecked` is justified.
export const uncheckedChatMessage = serverFunction.unchecked(async function uncheckedChatMessage (text: string): Promise<{ name: string; message: string }> {
  return { name: 'unchecked chat', message: `echo: ${text}` }
})
