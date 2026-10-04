import "dotenv/config";
import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    // Not env(): `prisma generate` (npm install, Docker build) must work without
    // a database URL. migrate/seed fail clearly when it is missing.
    url: process.env.DATABASE_URL ?? "",
  },
});
