/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  eslint: {
    ignoreDuringBuilds: true,
  },
  // Proxy /api/* to the FastAPI backend so browser requests stay same-origin
  // (no CORS preflight needed). Backend URL defaults to localhost:8000 for
  // local dev; production overrides via BACKEND_URL env var.
  async rewrites() {
    return [
      {
        source: '/api/:path*',
        destination: `${process.env.BACKEND_URL || 'http://localhost:8000'}/api/:path*`,
      },
    ];
  },
}

module.exports = nextConfig
