This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

Same app as `../next-15`, upgraded to Next 16 (React 19.3) — kept as a second version so this repo can observe how RSC serialization behavior changes across Next majors. The scripts in the repo root (`example-dev` / `example-start` / `example16-dev` / `example16-start`) drive these apps.

## Hazard demos

`/hazards` turns the will-it-server README's boundary matrix into live
buttons: server functions shaped so the boundary must reject or corrupt
them. Under `npm run dev`, each call logs a `will-it-server:` console.error
from the server; in a production build the same calls are library-silent by
design (checks never run there). The type-layer pins behind these
demos double as tests — `npm run type-check` here fails the build if
the walk stops (or wrongly starts) rejecting them.

## Getting Started

```bash
npm install
npm run dev    # Turbopack is the default in Next 16; no flag needed
npm run build && npm start   # production
```
