# will-it-server

Will this value survive the trip across the React Server Components boundary —
*in production?*

## The problem

Next.js apps have a class of bug that only appears after deploy: a value that
crosses the RSC boundary (a server function's arguments or return value)
behaves differently in `next dev` than in a production build. The canonical
example: a server function that **returns** an `Error` (rather than throwing
it). In development, the client component awaits the call and gets the real
error — message and stack intact. In production, the client component awaits
the call and gets... an `Error`, but not *yours*. React Flight silently
replaces it with an opaque stand-in ("An error occurred in the Server
Components render..."). Same code, different value. CI is green, dev is green,
prod is broken.

React's own feedback about these hazards is inconsistent: some lossy
transformations (a `URL` arriving as a string, a `Buffer` arriving as
`{type: 'Buffer', data: [...]}`) produce a dev-only `console.error` that
rendering blows past anyway; the returned-`Error` case warns about nothing at
all; and the production build never tells you anything, by design.

## The approach

Catch the hazard at the call site, before the boundary — in every mode, for
every value. Think of it as the dev-only `console.error` that React emits for
some types, generalized: applied to everything Flight cares about, surfaced
consistently, and available to run in CI where it can fail a build instead of
a user.

```ts
'use server'

import { serverFunction } from 'will-it-server'

export const saveTodo = serverFunction(async function saveTodo (todo: Todo) {
  if (!isValid(todo)) {
    return new Error('invalid todo') // flagged: won't survive the boundary
  }
  ...
})
```

The core predicates (`canPassFromClientToServer`, `canPassFromServerToClient`)
are also exported for building your own checks, serializers, or lint rules.

## Status

Early. The behavioral claims above aren't folklore — they're pinned by the
characterization suite in [`characterization/`](./characterization), which runs
the exact React Flight serializer at an explicit version and records what
actually crosses the boundary in dev and prod builds. When React changes, that
suite changes first — and the library's rules follow.
