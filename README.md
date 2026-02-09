# FlowTask

A comprehensive task management platform with GitHub/Slack integrations, AI agent capabilities via MCP, and public shareable views. Built with Bun for blazing-fast performance.

## Features

- **Kanban Board** - Drag-and-drop task management with customizable states
- **Smart Views** - Create filtered views with complex query conditions
- **Public Sharing** - Share views publicly with optional password protection
- **GitHub Integration** - One-way sync from GitHub issues/PRs to FlowTask tasks
- **Slack Integration** - Notifications sent to Slack channels on task updates
- **AI Agents** - MCP server with tools for AI-powered task management
- **Real-time Updates** - Native Bun WebSocket + Redis pub/sub for instant synchronization
- **Multi-workspace** - Organize projects across multiple workspaces with RBAC

## Tech Stack

| Layer | Technology |
|-------|------------|
| Runtime | **Bun** |
| Frontend | React + TypeScript + Vite + Tailwind CSS |
| Backend | Hono (running on Bun) |
| Database | PostgreSQL + Drizzle ORM |
| Cache/Queue | Redis |
| Authentication | Better Auth |
| Real-time | Bun WebSockets + Redis Pub/Sub |

## Prerequisites

- **Bun** 1.1+ (https://bun.sh)
- **Docker** and **Docker Compose** (for databases)
- **Git**

---

## Development Setup

### macOS / Linux

1. **Install Bun** (if not installed)
   ```bash
   curl -fsSL https://bun.sh/install | bash
   ```

2. **Clone the repository**
   ```bash
   git clone https://github.com/your-org/flowtask.git
   cd flowtask
   ```

3. **Install dependencies**
   ```bash
   bun install
   ```

4. **Set up environment variables**
   ```bash
   cp .env.example .env
   ```

   Edit `.env` and configure:
   ```env
   # Database
   DATABASE_URL=postgresql://flowtask:flowtask@localhost:5432/flowtask

   # Redis
   REDIS_URL=redis://localhost:6379

   # Auth
   BETTER_AUTH_SECRET=your-secret-key-min-32-chars
   BETTER_AUTH_URL=http://localhost:3001

   # Optional: OAuth providers
   GITHUB_CLIENT_ID=
   GITHUB_CLIENT_SECRET=
   GOOGLE_CLIENT_ID=
   GOOGLE_CLIENT_SECRET=

   # Optional: Integrations
   GITHUB_APP_ID=
   GITHUB_APP_PRIVATE_KEY=
   GITHUB_WEBHOOK_SECRET=
   SLACK_BOT_TOKEN=
   SLACK_SIGNING_SECRET=

   # Optional: AI
   OPENROUTER_API_KEY=
   ENCRYPTION_KEY=your-32-byte-encryption-key
   ```

5. **Start infrastructure services**
   ```bash
   docker-compose up -d
   ```

   This starts PostgreSQL, Redis, and MinIO (S3-compatible storage).

6. **Run database migrations**
   ```bash
   bun run db:generate
   bun run db:migrate
   ```

7. **Start development servers**
   ```bash
   bun run dev
   ```

   - API server: http://localhost:3001
   - WebSocket server: ws://localhost:3002/ws
   - Web app: http://localhost:5173

### Windows

1. **Install Bun**
   ```powershell
   powershell -c "irm bun.sh/install.ps1 | iex"
   ```

   Or use WSL2 (recommended for best compatibility):
   ```bash
   # In WSL2
   curl -fsSL https://bun.sh/install | bash
   ```

2. **Install Docker Desktop**
   - Download from https://www.docker.com/products/docker-desktop/
   - Enable WSL2 backend in Docker Desktop settings

3. **Clone and setup**
   ```powershell
   git clone https://github.com/your-org/flowtask.git
   cd flowtask
   bun install
   ```

4. **Set up environment variables**
   ```powershell
   copy .env.example .env
   ```

   Edit `.env` with your preferred text editor (same variables as macOS/Linux).

5. **Start infrastructure services**
   ```powershell
   docker-compose up -d
   ```

6. **Run database migrations**
   ```powershell
   bun run db:generate
   bun run db:migrate
   ```

7. **Start development servers**
   ```powershell
   bun run dev
   ```

### Useful Development Commands

```bash
# Start all services in dev mode
bun run dev

# Start only the API
bun run --filter @flowtask/api dev

# Start only the web app
bun run --filter @flowtask/web dev

# Build all packages
bun run build

# Run type checking
bun run typecheck

# Run linting
bun run lint

# Generate new migration after schema changes
bun run db:generate

# Apply migrations
bun run db:migrate

# Open Drizzle Studio (database GUI)
bun run db:studio

# View logs from Docker services
docker-compose logs -f
```

### Direct Database Access

For debugging or running ad-hoc queries, you can execute SQL directly against the PostgreSQL container:

```bash
# Run a single SQL query
docker exec -i flowtask-postgres psql -U flowtask -d flowtask -c "SELECT * FROM users;"

# Run multiple queries
docker exec -i flowtask-postgres psql -U flowtask -d flowtask -c "
SELECT u.email,
       CASE WHEN a.id IS NOT NULL THEN 'Yes' ELSE 'No' END as has_account
FROM users u
LEFT JOIN accounts a ON u.id = a.user_id;
"

# Open an interactive PostgreSQL shell
docker exec -it flowtask-postgres psql -U flowtask -d flowtask

# Execute SQL from a file
docker exec -i flowtask-postgres psql -U flowtask -d flowtask < script.sql
```

Common debugging queries:

```bash
# List all tables
docker exec -i flowtask-postgres psql -U flowtask -d flowtask -c "\dt"

# Describe a table structure
docker exec -i flowtask-postgres psql -U flowtask -d flowtask -c "\d users"

# Check users and their accounts
docker exec -i flowtask-postgres psql -U flowtask -d flowtask -c "
SELECT u.id, u.email, u.name, a.provider_id
FROM users u
LEFT JOIN accounts a ON u.id = a.user_id;
"
```

For Redis access:

```bash
# Open Redis CLI
docker exec -it flowtask-redis redis-cli

# Check Redis keys
docker exec -i flowtask-redis redis-cli KEYS "*"

# Monitor Redis in real-time
docker exec -it flowtask-redis redis-cli MONITOR
```

---

## Production Deployment

### Using Docker Compose

1. **Clone and configure**
   ```bash
   git clone https://github.com/your-org/flowtask.git
   cd flowtask
   cp .env.example .env
   ```

2. **Edit `.env` for production**
   ```env
   NODE_ENV=production

   # Use strong secrets
   DATABASE_URL=postgresql://flowtask:STRONG_PASSWORD@db:5432/flowtask
   REDIS_URL=redis://redis:6379
   BETTER_AUTH_SECRET=generate-a-strong-64-char-secret
   BETTER_AUTH_URL=https://your-domain.com

   # Configure your domain
   CORS_ORIGIN=https://your-domain.com
   ```

3. **Build and start**
   ```bash
   docker-compose -f docker-compose.prod.yml up -d --build
   ```

4. **Run migrations**
   ```bash
   docker-compose -f docker-compose.prod.yml exec api bun run db:migrate
   ```

5. **Access the application**
   - Web app: http://localhost:3000
   - API: http://localhost:3001
   - WebSocket: ws://localhost:3002/ws

### Manual Deployment

1. **Build all packages**
   ```bash
   bun install --frozen-lockfile
   bun run build
   ```

2. **Deploy the API**
   ```bash
   cd apps/api
   bun run dist/index.js
   ```

3. **Deploy the Web App**

   The web app builds to static files in `apps/web/dist/`. Deploy to any static hosting:

   - **Nginx**: Copy `dist/` to `/usr/share/nginx/html/`
   - **Vercel/Netlify**: Point to `apps/web` directory
   - **S3 + CloudFront**: Upload `dist/` to S3 bucket

4. **Configure reverse proxy**

   Example Nginx configuration:
   ```nginx
   server {
       listen 80;
       server_name your-domain.com;

       # Frontend
       location / {
           root /var/www/flowtask;
           try_files $uri $uri/ /index.html;
       }

       # API proxy
       location /api {
           proxy_pass http://localhost:3001;
           proxy_http_version 1.1;
           proxy_set_header Upgrade $http_upgrade;
           proxy_set_header Connection 'upgrade';
           proxy_set_header Host $host;
           proxy_cache_bypass $http_upgrade;
       }

       # WebSocket proxy
       location /ws {
           proxy_pass http://localhost:3002;
           proxy_http_version 1.1;
           proxy_set_header Upgrade $http_upgrade;
           proxy_set_header Connection "Upgrade";
           proxy_set_header Host $host;
       }
   }
   ```

### Environment Variables Reference

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | Yes | PostgreSQL connection string |
| `REDIS_URL` | Yes | Redis connection string |
| `BETTER_AUTH_SECRET` | Yes | Secret for signing auth tokens (min 32 chars) |
| `BETTER_AUTH_URL` | Yes | Base URL for auth callbacks |
| `API_PORT` | No | API server port (default: 3001) |
| `WS_PORT` | No | WebSocket server port (default: 3002) |
| `CORS_ORIGIN` | No | Allowed CORS origin (default: localhost:5173) |
| `GITHUB_CLIENT_ID` | No | GitHub OAuth app client ID |
| `GITHUB_CLIENT_SECRET` | No | GitHub OAuth app client secret |
| `GOOGLE_CLIENT_ID` | No | Google OAuth client ID |
| `GOOGLE_CLIENT_SECRET` | No | Google OAuth client secret |
| `GITHUB_APP_ID` | No | GitHub App ID for integration |
| `GITHUB_APP_PRIVATE_KEY` | No | GitHub App private key (base64 encoded) |
| `GITHUB_WEBHOOK_SECRET` | No | Secret for verifying GitHub webhooks |
| `SLACK_BOT_TOKEN` | No | Slack bot OAuth token |
| `SLACK_SIGNING_SECRET` | No | Secret for verifying Slack requests |
| `OPENROUTER_API_KEY` | No | OpenRouter API key for AI features |
| `ENCRYPTION_KEY` | No | 32-byte key for encrypting stored API keys |
| `MINIO_ENDPOINT` | No | S3/MinIO endpoint for file storage |
| `MINIO_ACCESS_KEY` | No | S3/MinIO access key |
| `MINIO_SECRET_KEY` | No | S3/MinIO secret key |

---

## Project Structure

```
flowtask/
├── apps/
│   ├── api/                    # Hono API server (Bun runtime)
│   │   ├── src/
│   │   │   ├── index.ts        # Server entry point
│   │   │   ├── routes/         # API route handlers
│   │   │   └── websocket/      # Bun WebSocket handler
│   │   └── Dockerfile
│   │
│   └── web/                    # React frontend
│       ├── src/
│       │   ├── components/     # UI components
│       │   ├── routes/         # Page components
│       │   ├── stores/         # Zustand state stores
│       │   └── api/            # API client
│       ├── nginx.conf
│       └── Dockerfile
│
├── packages/
│   ├── shared/                 # Shared types and utilities
│   ├── database/               # Drizzle schema and client
│   ├── auth/                   # Better Auth configuration
│   ├── domain/                 # Business logic services
│   └── integrations/           # External service clients
│
├── docker-compose.yml          # Development infrastructure
├── docker-compose.prod.yml     # Production deployment
├── turbo.json                  # Turborepo configuration
└── package.json                # Root package (Bun workspaces)
```

---

## Why Bun?

FlowTask uses Bun as its primary runtime for several reasons:

- **Speed**: Bun is significantly faster than Node.js for starting servers and running TypeScript
- **Native TypeScript**: No transpilation step needed - Bun runs TypeScript directly
- **Built-in WebSockets**: Native WebSocket support without additional packages
- **All-in-one**: Package manager, bundler, test runner, and runtime in one tool
- **Node.js Compatible**: Most npm packages work out of the box

---

## Integrations Setup

### GitHub Integration

1. Create a GitHub App at https://github.com/settings/apps/new
2. Configure permissions:
   - Issues: Read & Write
   - Pull requests: Read
   - Webhooks: Receive events
3. Set webhook URL to `https://your-domain.com/api/webhooks/github`
4. Generate and download private key
5. Add credentials to `.env`

### Slack Integration

1. Create a Slack App at https://api.slack.com/apps
2. Enable Socket Mode
3. Add Bot Token Scopes: `chat:write`, `channels:read`
4. Install to workspace
5. Add bot token and signing secret to `.env`

### AI Agents (MCP)

FlowTask MCP now uses OAuth 2.1 (Authorization Code + PKCE) with dynamic client registration.

1. Add the MCP server in ChatGPT or Claude using `https://your-domain.com/api/mcp/sse`.
2. The client discovers OAuth metadata from:
   - `https://your-domain.com/.well-known/oauth-protected-resource/api/mcp/sse`
   - `https://your-domain.com/api/mcp/.well-known/oauth-authorization-server`
3. Sign in and approve consent for one workspace scope (`mcp:workspace:<workspaceId>`) plus tool scopes (`mcp:tool:create_task`, `mcp:tool:add_comment`, etc.).
4. Only workspace `owner` and `admin` roles can approve MCP OAuth access.

---

## Contributing

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/my-feature`
3. Make your changes
4. Run tests: `bun test`
5. Commit: `git commit -m "Add my feature"`
6. Push: `git push origin feature/my-feature`
7. Open a Pull Request

---

## License

MIT License - see [LICENSE](LICENSE) for details.
