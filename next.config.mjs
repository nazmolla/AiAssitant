/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverComponentsExternalPackages: ['better-sqlite3'],
    serverActions: {
      bodySizeLimit: '50mb',
    },
  },
};

export default nextConfig;
