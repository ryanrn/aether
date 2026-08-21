import type { NextConfig } from "next";

const config: NextConfig = {
  reactStrictMode: true,
  // Os pacotes do workspace sao consumidos como fonte TypeScript.
  transpilePackages: ["@aether/shared", "@aether/db", "@aether/access"],
  // Prisma nao pode ser empacotado pelo bundler do servidor.
  serverExternalPackages: ["@prisma/client"],
  experimental: {
    // Server actions so aceitam requisicoes da propria origem.
    serverActions: {
      bodySizeLimit: "2mb",
    },
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Permissions-Policy",
            // microfone e captura de tela sao necessarios a partir da fase 4/5
            value: "camera=(), microphone=(self), display-capture=(self), geolocation=()",
          },
        ],
      },
    ];
  },
};

export default config;
