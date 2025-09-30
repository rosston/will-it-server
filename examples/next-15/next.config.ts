import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  typescript: {
    // TODO: Make the types actually work here
    ignoreBuildErrors: true,
  },
}

export default nextConfig
