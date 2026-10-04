import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Standalone server bundle for the Docker runtime image.
  output: "standalone",
  poweredByHeader: false,
  serverExternalPackages: ["@prisma/client", "@prisma/adapter-pg", "pg"],
};

export default nextConfig;
