# One image for the whole app: the Bun API bundle serves the built SPA and
# applies database migrations on boot. Build from the repo root:
#   docker build -f apps/api/Dockerfile -t flowtask .

# ---- builder: install, build the web app and bundle the API ----
FROM oven/bun:1.3.11 AS builder
WORKDIR /app

COPY package.json bun.lock tsconfig.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/database/package.json packages/database/
COPY packages/auth/package.json packages/auth/
COPY packages/domain/package.json packages/domain/
COPY packages/integrations/package.json packages/integrations/
COPY apps/web/package.json apps/web/
COPY apps/api/package.json apps/api/
RUN bun install --frozen-lockfile

COPY packages packages
COPY apps/web apps/web
COPY apps/api apps/api

# Vite inlines these at build time. VITE_API_URL stays empty: the SPA and the
# API share an origin.
ARG VITE_API_URL=""
ARG VITE_GITHUB_CLIENT_ID=""
ARG VITE_GOOGLE_CLIENT_ID=""
ARG VITE_GITHUB_APP_SLUG=""
ENV VITE_API_URL=$VITE_API_URL \
    VITE_GITHUB_CLIENT_ID=$VITE_GITHUB_CLIENT_ID \
    VITE_GOOGLE_CLIENT_ID=$VITE_GOOGLE_CLIENT_ID \
    VITE_GITHUB_APP_SLUG=$VITE_GITHUB_APP_SLUG

# The web build reads @flowtask/shared from its dist; the API bundle reads every
# workspace package from source (the "bun" export condition) and inlines all
# dependencies, so the runner needs no node_modules.
RUN cd packages/shared && bun run build
RUN cd apps/web && bun run build
RUN cd apps/api && bun run build

# ---- runner: the bundle, the SPA and the migrations, nothing else ----
FROM oven/bun:1.3.11-slim AS runner
WORKDIR /app

ENV NODE_ENV=production \
    API_PORT=3001 \
    WEB_DIST_DIR=/app/public \
    MIGRATIONS_DIR=/app/drizzle

COPY --from=builder --chown=bun:bun /app/apps/api/dist/ ./
COPY --from=builder --chown=bun:bun /app/apps/web/dist/ ./public/
COPY --from=builder --chown=bun:bun /app/packages/database/drizzle/ ./drizzle/

USER bun
EXPOSE 3001

# slim has no curl or wget; use bun itself.
HEALTHCHECK --interval=15s --timeout=5s --start-period=60s --retries=3 \
  CMD ["bun", "-e", "fetch('http://127.0.0.1:' + (process.env.API_PORT || 3001) + '/health').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]

CMD ["bun", "index.js"]
