# Build stage
FROM oven/bun:1.2 AS builder

WORKDIR /app

# Copy root package files
COPY package.json bun.lock* tsconfig.json ./

# Copy all workspace package.json files to maintain lockfile consistency
COPY packages/shared/package.json ./packages/shared/
COPY packages/database/package.json ./packages/database/
COPY packages/auth/package.json ./packages/auth/
COPY packages/domain/package.json ./packages/domain/
COPY packages/integrations/package.json ./packages/integrations/
COPY apps/web/package.json ./apps/web/
COPY apps/api/package.json ./apps/api/

# Install dependencies
RUN bun install --frozen-lockfile

# Copy source code
COPY packages ./packages
COPY apps/api ./apps/api

# Build packages and API
RUN cd packages/shared && bun run build
RUN cd packages/database && bun run build
RUN cd packages/auth && bun run build
RUN cd packages/domain && bun run build
RUN cd packages/integrations && bun run build
RUN cd apps/api && bun run build

# Production stage
FROM oven/bun:1.2-slim AS runner

WORKDIR /app

# Copy built artifacts
COPY --from=builder /app/package.json ./
COPY --from=builder /app/bun.lock* ./

COPY --from=builder /app/packages/shared/package.json ./packages/shared/
COPY --from=builder /app/packages/shared/dist ./packages/shared/dist

COPY --from=builder /app/packages/database/package.json ./packages/database/
COPY --from=builder /app/packages/database/dist ./packages/database/dist

COPY --from=builder /app/packages/auth/package.json ./packages/auth/
COPY --from=builder /app/packages/auth/dist ./packages/auth/dist

COPY --from=builder /app/packages/domain/package.json ./packages/domain/
COPY --from=builder /app/packages/domain/dist ./packages/domain/dist

COPY --from=builder /app/packages/integrations/package.json ./packages/integrations/
COPY --from=builder /app/packages/integrations/dist ./packages/integrations/dist

COPY --from=builder /app/apps/api/package.json ./apps/api/
COPY --from=builder /app/apps/api/dist ./apps/api/dist

# Install production dependencies only
RUN bun install --production

# Set environment
ENV NODE_ENV=production
ENV API_PORT=3001
ENV WS_PORT=3002

EXPOSE 3001 3002

# Run the API
CMD ["bun", "run", "apps/api/dist/index.js"]
