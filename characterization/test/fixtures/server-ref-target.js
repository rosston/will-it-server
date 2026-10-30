// Simulates a 'use server' module for the serverRef probes. Next's bundler
// codegen calls registerServerReference on every server-function export at
// module init — the tag it applies ($$typeof = Symbol.for('react.server.reference'))
// is what will-it-server's runtime walker detects to let server-function
// VALUES cross (docs list them as supported in both directions).
'use strict'

const { registerServerReference } = require('react-server-dom-webpack/server.node')

module.exports = {
  fixtureAction: registerServerReference(
    function fixtureAction () { return 'fixture-called' },
    'fixture:ref',
    'fixtureAction'
  ),
}
