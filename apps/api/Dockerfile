# Build-Kontext ist das Repo-Root (siehe infra/docker-compose.yml)
# Trixie statt Bookworm: libheif 1.19 (Bookworm 1.15 scheitert an iOS-17/18-HEIC mit HDR-Gain-Map und
# Tiefenkarte: "Too many auxiliary image references") und ffmpeg 7.1, das HEIF als Rückfall selbst liest.
# In Trixie sind die libheif-Decoder Plugins – libde265 (HEVC) muss ausdrücklich mit, weil Recommends aus sind.
FROM node:22-trixie-slim AS base
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates ffmpeg libheif-examples libheif-plugin-libde265 \
  && rm -rf /var/lib/apt/lists/*
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

COPY apps/api/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh

WORKDIR /repo/apps/api
RUN chmod +x /usr/local/bin/docker-entrypoint.sh && mkdir -p /data/media && chown -R node:node /data /repo
# Start als root: Entrypoint übergibt den Medien-Mount an "node" und wechselt dann zu diesem Benutzer
ENTRYPOINT ["docker-entrypoint.sh"]
EXPOSE 3000

# Migrationen einspielen, dann starten
# (Prisma-CLI direkt aus node_modules – npx würde im Runtime-Image nachinstallieren wollen)
CMD ["sh", "-c", "/repo/node_modules/.bin/prisma migrate deploy && node dist/server.js"]
