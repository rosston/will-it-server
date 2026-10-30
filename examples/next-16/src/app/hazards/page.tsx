import { HazardsDemo } from './HazardsDemo'

export default function HazardsPage () {
  return (
    <main>
      <h1>Boundary hazards</h1>
      <p>
        Buttons that hand the React server boundary values it must reject or
        corrupt. Every static shape is pinned by the type layer in
        lib/hazards.ts; the runtime layer logs will-it-server warnings on the
        server in dev — and, by design, nothing at all in a production
        build.
      </p>
      <HazardsDemo />
    </main>
  )
}
