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

# Copy source code for packages we need
COPY packages/shared ./packages/shared
COPY apps/web ./apps/web

# Build arguments for Vite env vars (must be set at build time)
ARG VITE_API_URL
ARG VITE_WS_URL
ARG VITE_GITHUB_CLIENT_ID
ARG VITE_GOOGLE_CLIENT_ID

ENV VITE_API_URL=$VITE_API_URL
ENV VITE_WS_URL=$VITE_WS_URL
ENV VITE_GITHUB_CLIENT_ID=$VITE_GITHUB_CLIENT_ID
ENV VITE_GOOGLE_CLIENT_ID=$VITE_GOOGLE_CLIENT_ID

# Build packages
RUN cd packages/shared && bun run build
RUN cd apps/web && bun run build

# Production stage
FROM nginx:alpine AS runner

# Copy built assets
COPY --from=builder /app/apps/web/dist /usr/share/nginx/html

# Copy nginx config
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 3000

CMD ["nginx", "-g", "daemon off;"]
