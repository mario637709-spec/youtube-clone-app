const isExport = process.env.NEXT_EXPORT === 'true' || process.env.CAPACITOR_BUILD === 'true';

/** @type {import('next').NextConfig} */
const nextConfig = {
  ...(isExport ? {
    output: 'export',
    images: { unoptimized: true }
  } : {}),
  reactStrictMode: false,
  typescript: {
    ignoreBuildErrors: true,
  },
};

module.exports = nextConfig;
