import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // Dev-only: the Claude preview browser reaches the dev server via 127.0.0.1,
  // which Next 16 treats as cross-origin from localhost and blocks.
  allowedDevOrigins: ['127.0.0.1'],
}

export default nextConfig
