This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

Same app as `../next-15`, upgraded to Next 16 (React 19.3) — kept as a second version so this repo can observe how RSC serialization behavior changes across Next majors. The scripts in the repo root (`example-dev` / `example-start` / `example16-dev` / `example16-start`) drive these apps.

## Getting Started

```bash
npm install
npm run dev    # Turbopack is the default in Next 16; no flag needed
npm run build && npm start   # production
```
