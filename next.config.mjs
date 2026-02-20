/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverComponentsExternalPackages: ['better-sqlite3', 'discord.js', '@discordjs/ws', '@discordjs/rest'],
    serverActions: {
      bodySizeLimit: '50mb',
    },
  },
};

export default nextConfig;
