/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'export',
  images: {
    unoptimized: true,
  },
  reactStrictMode: false,
  typescript: {
    ignoreBuildErrors: true,
  },
};

module.exports = nextConfig;
