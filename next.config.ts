import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /** Requerido para Docker (multi-stage) — genera .next/standalone */
  output: "standalone",
  serverExternalPackages: ["@prisma/client"],
  // Menos paralelismo evita chunks rotos (p. ej. ./7627.js) en Windows + carpetas sincronizadas (OneDrive).
  experimental: {
    webpackBuildWorker: false,
    parallelServerCompiles: false,
    parallelServerBuildTraces: false,
    staticGenerationMaxConcurrency: 1,
  },
};

export default nextConfig;
