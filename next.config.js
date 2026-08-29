/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  optimizeFonts: false,
  poweredByHeader: false,
  productionBrowserSourceMaps: false,
  async headers() {
    return [{
      source: '/((?!_next/static|_next/image|favicon.ico).*)',
      headers: [{ key: 'Cache-Control', value: 'no-store, private' }],
    }];
  },
};

module.exports = nextConfig;
