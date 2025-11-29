import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    externalDir: true,
  },
  turbopack: {
    // Evita que o Turbopack escolha o package-lock da raiz do monorepo como root.
    root: __dirname,
  },
  async rewrites() {
    const apiHost = process.env.NEXT_PUBLIC_API_HOST || "http://localhost:4002";
    return [
      {
        source: "/api/:path*",
        destination: `${apiHost}/:path*`,
      },
    ];
  },
};

export default nextConfig;
