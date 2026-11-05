import type { NextConfig } from 'next';
const config: NextConfig = {
  devIndicators: false,
  experimental: {
    serverActions: {
      bodySizeLimit: '50mb',
    },
  },
};
export default config;
