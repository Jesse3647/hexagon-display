import type { NextConfig } from 'next';

const publicBasePath = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

/** Emit a browser-only build; Pages supplies the optional repository asset prefix. */
const nextConfig: NextConfig = {
  output: 'export',
  assetPrefix: publicBasePath || undefined,
  trailingSlash: true,
};

export default nextConfig;
