/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: false,
  typescript: {
    ignoreBuildErrors: true,
  },
  // eslint config moved here from root key (Next.js 16 compatibility)
  // output: 'export' REMOVED — static export mode is incompatible with
  // dynamic routes like /watch/[id]. Only add this for production builds.
};

module.exports = nextConfig;
