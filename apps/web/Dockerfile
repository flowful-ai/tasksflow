# Build stage
FROM oven/bun:1.1 AS builder

WORKDIR /app

# Copy workspace files
COPY package.json bun.lock* ./
COPY packages/shared ./packages/shared
COPY apps/web ./apps/web

# Install dependencies
RUN bun install --frozen-lockfile

# Build arguments for Vite env vars (must be set at build time)
ARG VITE_API_URL
ARG VITE_WS_URL

ENV VITE_API_URL=$VITE_API_URL
ENV VITE_WS_URL=$VITE_WS_URL

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
