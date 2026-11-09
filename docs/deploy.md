# Deploying FlowTask

Production runs from [`docker-compose.prod.yml`](../docker-compose.prod.yml), which has three services:

| Service            | Image                                                     | Role                                                                                                  |
| ------------------ | --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `postgres`         | `postgres:16.15-alpine`                                   | The database (512 MB memory limit, `max_connections=30`). Volume `tasksflow_postgres_data`.           |
| `tasksflow-api`    | built from `apps/api/Dockerfile`                          | The whole app: JSON API, SSE, MCP, OAuth, the built SPA. Applies migrations on boot. Listens on 3001. |
| `tasksflow-backup` | `prodrigestivill/postgres-backup-local:16-alpine-d257e5d` | Daily `pg_dump` to the `tasksflow_backups` volume. See [backup-restore.md](backup-restore.md).        |

There is no separate web container, reverse proxy, Redis or migration job.

## Dokploy

1. **Create the service.** In a Dokploy project, add a **Compose** service from this repository (branch to deploy), with compose path `docker-compose.prod.yml`. Dokploy builds `tasksflow-api` from the repo root with `apps/api/Dockerfile`.
2. **Set the environment** (Environment tab). Minimum:

   ```env
   POSTGRES_PASSWORD=<openssl rand -hex 24>
   BETTER_AUTH_SECRET=<openssl rand -hex 32>
   BETTER_AUTH_URL=https://tasks.example.com
   API_KEY_ENCRYPTION_KEY=<openssl rand -hex 32>
   APP_MANAGER_EMAILS=you@example.com
   TRUSTED_PROXY_HOPS=1
   GITHUB_CLIENT_ID=...          # and/or GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET
   GITHUB_CLIENT_SECRET=...
   ```

   The compose file refuses to start without `POSTGRES_PASSWORD`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL` and `API_KEY_ENCRYPTION_KEY`. Add the GitHub App variables (`GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY`, `GITHUB_WEBHOOK_SECRET`, `GITHUB_APP_CLIENT_ID`, `GITHUB_APP_CLIENT_SECRET`, `GITHUB_APP_SLUG`) and the Slack variables (`SLACK_CLIENT_ID`, `SLACK_CLIENT_SECRET`, `SLACK_SIGNING_SECRET`) when you use those integrations. Every variable is described in the [README](../README.md#configuration) and [`.env.example`](../.env.example).

   Notes:
   - `WEB_URL` defaults to `BETTER_AUTH_URL`; the SPA and the API share the origin.
   - `VITE_GITHUB_CLIENT_ID` and `VITE_GOOGLE_CLIENT_ID` are build arguments that default to the server client ids; `VITE_GITHUB_APP_SLUG` must be set for the GitHub App install link to appear. Changing a `VITE_*` value needs a rebuild, not just a restart.
   - `TRUSTED_PROXY_HOPS=1` matches Dokploy's Traefik. It decides which `X-Forwarded-For` entry is the client IP for rate limits; set it to the number of proxies in front of the API.

3. **Map the domain** (Domains tab): host `tasks.example.com`, service **`tasksflow-api`**, container port **`3001`**, HTTPS on (Let's Encrypt). This one route serves the SPA, `/api/*`, `/.well-known/*`, `/health` and `/ready`.
4. **Deploy.** Watch the `tasksflow-api` logs for `Applying database migrations from /app/drizzle` and then `FlowTask API running at http://0.0.0.0:3001 (serving SPA from /app/public)`.
5. **Point the integrations at the domain**: OAuth callbacks `https://tasks.example.com/api/auth/callback/github` and `/api/auth/callback/google`; GitHub App callback `https://tasks.example.com/api/github/callback` and webhook `https://tasks.example.com/api/webhooks/github`; Slack redirect `https://tasks.example.com/api/webhooks/slack/oauth`. See the README for the GitHub and Slack app settings.

## Migrations on boot

On start, before it listens, the API applies pending Drizzle migrations from `MIGRATIONS_DIR` (`/app/drizzle` in the image). It holds a session-level `pg_advisory_lock`, so replicas starting together wait for each other and the later ones find nothing to do. If a migration fails the process logs `Database migration failed:` and exits with status 1; Docker restarts it (`restart: always`) and the error repeats until it is fixed. Set `RUN_MIGRATIONS=false` to skip this (then run `bun run db:migrate` yourself).

After migrations, the API scans task columns for invalid position keys and re-keys them in the background (a read-only scan when everything is healthy).

## Health and readiness

| Endpoint      | 200 when                                                                                  | 503 when                                                              |
| ------------- | ----------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| `GET /health` | the process is up and `SELECT 1` succeeds within 2 s: `{"status":"ok","database":"ok",…}` | the database is unreachable                                           |
| `GET /ready`  | as `/health`, and the process is not shutting down: `{"status":"ready"}`                  | shutting down (`shutting_down`) or database unreachable (`not_ready`) |

The image and the compose file use `/health` as the Docker healthcheck (every 15 s, 60 s start period, 3 retries). Use `/ready` for load balancer checks that should stop routing to a draining instance.

## Graceful shutdown

On SIGTERM or SIGINT the API:

1. marks itself as shutting down (`/ready` returns 503) and stops accepting new connections;
2. runs the shutdown hooks: closes every SSE stream and the `LISTEN` connection, stops the domain-event bridges and the job runner (in-flight jobs get up to 30 s);
3. waits for in-flight requests;
4. closes the database pool and exits 0.

Phases 2 and 3 each wait at most `SHUTDOWN_TIMEOUT_MS` (default 10000). The compose file gives the container `stop_grace_period: 30s` before SIGKILL. SSE clients reconnect on their own (the stream advertises `retry: 5000`).

## Scaling

The API is stateless apart from open SSE streams, and the shared pieces are in Postgres:

- migrations take an advisory lock;
- jobs are claimed with `FOR UPDATE SKIP LOCKED`, and recurring jobs are unique per key, so every replica can run the job runner (`JOBS_DISABLED=true` turns it off in a process);
- auth and MCP rate limits are Postgres tables shared by all replicas.

To run more instances, add `replicas` under `tasksflow-api.deploy` (the compose file already sets `deploy.resources` there) and redeploy; Traefik balances across them. Mind the connection budget: Postgres is configured for 30 connections, and each API instance uses `DB_POOL_MAX` (10) plus one `LISTEN` connection, plus one during migrations. Two instances fit; for more, lower `DB_POOL_MAX` or raise `max_connections` and the Postgres memory limit together.

Cross-instance realtime uses Postgres `LISTEN/NOTIFY` on the same connection settings as the pool (`DATABASE_URL`, or the URL built from `POSTGRES_*`), so a change made through one replica reaches SSE clients on every replica.

## Logs and operations

- Logs: Dokploy's log view, or `docker compose -f docker-compose.prod.yml logs -f tasksflow-api`. Requests are logged with share/invitation tokens and OAuth parameters redacted.
- Database shell: `docker compose -f docker-compose.prod.yml exec postgres psql -U flowtask flowtask`.
- Pending jobs: `SELECT type, attempts, last_error, run_at FROM jobs WHERE done_at IS NULL AND failed_at IS NULL ORDER BY run_at;`
- Backups and restores: [backup-restore.md](backup-restore.md).
- Upgrading from v1: [v2-upgrade.md](v2-upgrade.md).

## Without Dokploy

The same compose file works with plain Docker Compose behind any TLS-terminating proxy that forwards to `tasksflow-api:3001` (the service only `expose`s the port, so attach your proxy to `flowtask-network` or add a `ports` mapping). Or build and run the image yourself:

```bash
docker build -f apps/api/Dockerfile -t flowtask \
  --build-arg VITE_GITHUB_CLIENT_ID=... --build-arg VITE_GITHUB_APP_SLUG=... .
docker run -p 3001:3001 -e DATABASE_URL=postgresql://... -e BETTER_AUTH_SECRET=... \
  -e BETTER_AUTH_URL=https://tasks.example.com -e API_KEY_ENCRYPTION_KEY=... flowtask
```
