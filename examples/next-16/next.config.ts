import path from 'node:path'
import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  turbopack: {
    // The repo root holds its own lockfile; pin the root so Turbopack
    // doesn't have to guess (and won't warn about it).
    root: path.join(__dirname, '..', '..'),
  },
}

export default nextConfig
