/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  async rewrites() {
    // Browser uses NEXT_PUBLIC_API_URL (localhost). Next server-side rewrites
    // must reach the backend service name inside Docker.
    const api =
      process.env.API_INTERNAL_URL ||
      process.env.NEXT_PUBLIC_API_URL ||
      "http://localhost:8000";
    return [
      { source: "/api/:path*", destination: `${api}/api/:path*` },
    ];
  },
};

module.exports = nextConfig;
