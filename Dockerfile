# syntax=docker/dockerfile:1.7
FROM node:24-bookworm-slim AS base
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*

# Full dependency tree (dev deps included: prisma CLI + tsx are needed by migrate-seed).
FROM base AS deps
COPY package.json package-lock.json ./
COPY prisma ./prisma
COPY prisma.config.ts ./
RUN npm config set fetch-retries 5 && npm config set fetch-retry-mintimeout 20000 && npm ci

FROM deps AS build
COPY . .
RUN npm run build

# One-shot setup image: applies committed migrations, then the idempotent seed.
FROM deps AS migrate-seed
COPY . .
RUN npx prisma generate
CMD ["sh", "-c", "npx prisma migrate deploy && npx prisma db seed"]

# Slim runtime: Next standalone output only.
FROM base AS app
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0
RUN groupadd -r app && useradd -r -g app app && mkdir -p /data/uploads && chown -R app:app /data
COPY --from=build --chown=app:app /app/.next/standalone ./
COPY --from=build --chown=app:app /app/.next/static ./.next/static
COPY --from=build --chown=app:app /app/public ./public
USER app
EXPOSE 3000
CMD ["node", "server.js"]
