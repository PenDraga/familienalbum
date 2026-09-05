# Build-Kontext ist das Repo-Root (siehe infra/docker-compose.yml)
FROM node:22-bookworm-slim AS base
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates ffmpeg && rm -rf /var/lib/apt/lists/*
WORKDIR /repo

# --- Abhängigkeiten ---
FROM base AS deps
COPY package.json package-lock.json .npmrc ./
COPY apps/api/package.json apps/api/
RUN npm ci --no-audit --no-fund

# --- Build ---
FROM deps AS build
COPY apps/api apps/api
RUN npm run prisma:generate -w apps/api && npm run build -w apps/api
RUN npm prune --omit=dev --no-audit --no-fund

# --- Runtime ---
FROM base AS runtime
ENV NODE_ENV=production
COPY --from=build /repo/node_modules ./node_modules
COPY --from=build /repo/package.json ./
COPY --from=build /repo/apps/api/package.json apps/api/
COPY --from=build /repo/apps/api/node_modules apps/api/node_modules
COPY --from=build /repo/apps/api/dist apps/api/dist
COPY --from=build /repo/apps/api/prisma apps/api/prisma

WORKDIR /repo/apps/api
RUN mkdir -p /data/media && chown -R node:node /data /repo
USER node
EXPOSE 3000

# Migrationen einspielen, dann starten
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/server.js"]
