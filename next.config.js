/** @type {import('next').NextConfig} */
const nextConfig = {
  webpack: (config) => {
    config.externals.push('encoding', 'bufferutil', 'utf-8-validate');
    return config;
  },
  transpilePackages: ['@jup-ag/core']
}

module.exports = nextConfig 