'use client'

import { useState } from 'react'
import {
  crossUnknownArg,
  crossUnknownReturn,
  saveBuggy,
  saveResult,
  uncheckedChatMessage
} from '../lib/hazards'

function describe (value: unknown): string {
  if (value instanceof Error) return value.message
  if (typeof value === 'string') return value
  return JSON.stringify(value) ?? String(value)
}

export function HazardsDemo () {
  const [results, setResults] = useState<Record<string, string>>({})

  const show = (id: string, value: unknown): void => {
    setResults((previous) => ({ ...previous, [id]: describe(value) }))
  }

  return (
    <div>
      <section>
        <h2>Returned Error (the flagship)</h2>
        <p>Dev shows the real message; a production build swaps it for an opaque stand-in.</p>
        <button id='returned-error-btn' onClick={() => saveBuggy('flagged').then((value) => show('returned-error-result', value))}>Call saveBuggy()</button>
        <p id='returned-error-result'>{results['returned-error-result'] ?? ''}</p>
      </section>

      <section>
        <h2>URL as an argument</h2>
        <p>The runtime walker flags the call in dev; server-side it arrives as a stand-in.</p>
        <button id='unknown-arg-btn' onClick={() => crossUnknownArg(new URL('https://will-it-server.dev/flagged-argument')).then((value) => show('unknown-arg-result', value))}>Call crossUnknownArg(new URL(...))</button>
        <p id='unknown-arg-result'>{results['unknown-arg-result'] ?? ''}</p>
      </section>

      <section>
        <h2>URL as a return value</h2>
        <p>The runtime walker flags the return in dev; whatever crosses arrives as the href string.</p>
        <button id='unknown-return-btn' onClick={() => crossUnknownReturn().then((value) => show('unknown-return-result', value))}>Call crossUnknownReturn()</button>
        <p id='unknown-return-result'>{results['unknown-return-result'] ?? ''}</p>
      </section>

      <section>
        <h2>{'{ name, message }'} return, via unchecked</h2>
        <p>The type layer rejects this shape — unchecked opts out — and the plain object crosses intact.</p>
        <button id='unchecked-chat-btn' onClick={() => uncheckedChatMessage('echo').then((value) => show('unchecked-chat-result', value))}>Call uncheckedChatMessage()</button>
        <p id='unchecked-chat-result'>{results['unchecked-chat-result'] ?? ''}</p>
      </section>

      <section>
        <h2>Result-shaped contrast</h2>
        <p>saveBuggy's outcome, carried in a type the boundary keeps intact.</p>
        <button id='result-ok-btn' onClick={() => saveResult('valid text').then((value) => show('result-ok-result', value))}>Call saveResult('valid text')</button>
        <p id='result-ok-result'>{results['result-ok-result'] ?? ''}</p>
        <button id='result-fail-btn' onClick={() => saveResult('').then((value) => show('result-fail-result', value))}>Call saveResult('')</button>
        <p id='result-fail-result'>{results['result-fail-result'] ?? ''}</p>
      </section>
    </div>
  )
}
