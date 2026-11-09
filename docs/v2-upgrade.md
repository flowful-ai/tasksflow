# Upgrading production from v1 to v2

v1 ran five services (`postgres`, `redis`, `tasksflow-migrate`, `tasksflow-api`, and `tasksflow-web` with nginx on port 3000). v2 runs `postgres`, `tasksflow-api` (which now serves the SPA and migrates on boot) and a `tasksflow-backup` sidecar. The Postgres volume keeps its name (`tasksflow_postgres_data`), so the data carries over.

Plan for a few minutes of downtime: the first v2 boot runs migration `0016_v2` before it serves requests.

## 1. Take a backup first

v1 has no backup sidecar, so dump the database by hand and copy the file off the server before changing anything.

```bash
# On the Dokploy host. Find the v1 Postgres container:
docker ps --filter name=postgres --format '{{.Names}}'

docker exec <postgres-container> pg_dump -U flowtask --clean --if-exists --no-owner flowtask \
  | gzip > flowtask-pre-v2-$(date +%Y%m%d).sql.gz
gunzip -t flowtask-pre-v2-*.sql.gz && ls -lh flowtask-pre-v2-*.sql.gz

# Copy it somewhere else, e.g. from your machine:
scp <host>:flowtask-pre-v2-*.sql.gz .
```

Use your `POSTGRES_USER`/`POSTGRES_DB` if they are not `flowtask`. Restoring this dump is covered in [backup-restore.md](backup-restore.md).

## 2. Update the environment

In the Dokploy Environment tab, compare with [`.env.example`](../.env.example) and the `tasksflow-api` environment block in [`docker-compose.prod.yml`](../docker-compose.prod.yml).

Set or check:

| Variable                                           | Value                                                                                                                                                                                    |
| -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `BETTER_AUTH_URL`                                  | The public `https://` URL. Required by the compose file; OAuth callbacks, the Slack redirect and MCP metadata are built from it.                                                         |
| `WEB_URL`                                          | Remove it or set it to the same URL: it defaults to `BETTER_AUTH_URL`, and the SPA is now served from the API's origin.                                                                  |
| `APP_MANAGER_EMAILS`                               | Comma-separated emails of the app managers (promoted on their next login).                                                                                                               |
| `GITHUB_APP_CLIENT_ID`, `GITHUB_APP_CLIENT_SECRET` | The GitHub App's own OAuth client (App settings → Client ID / Generate a new client secret). Needed to install the App on new projects.                                                  |
| `GITHUB_APP_SLUG`                                  | The App slug (defaults to `VITE_GITHUB_APP_SLUG`, which you already have).                                                                                                               |
| `SLACK_CLIENT_ID`, `SLACK_CLIENT_SECRET`           | If you use Slack: the Slack app's OAuth credentials for "Add to Slack". Keep `SLACK_SIGNING_SECRET`; `SLACK_BOT_TOKEN` still works as a fallback for projects without their own install. |
| `TRUSTED_PROXY_HOPS`                               | `1` (Dokploy's Traefik).                                                                                                                                                                 |
| `INTEGRATION_ENCRYPTION_KEY`                       | Optional. Encrypts Slack bot tokens; defaults to `API_KEY_ENCRYPTION_KEY`. Pick it now if you want a separate key: tokens stored under one key cannot be read with another.              |

Keep `POSTGRES_*`, `BETTER_AUTH_SECRET`, `API_KEY_ENCRYPTION_KEY`, the GitHub/Google sign-in pairs, `GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY`, `GITHUB_WEBHOOK_SECRET` and the `VITE_*` client ids unchanged.

Remove:

- `REDIS_PASSWORD` (no Redis)
- `VITE_WS_URL` (no websocket; realtime is SSE on the same origin)
- `SLACK_APP_TOKEN` (no Socket Mode; Slack is OAuth-installed)
- `VITE_API_URL`, or leave it empty: the SPA calls the API on its own origin

If `API_KEY_ENCRYPTION_KEY` is not 32 bytes of hex or base64, v2 logs a warning at boot and keeps working; existing keys still decrypt.

## 3. Configure the GitHub App

In the GitHub App settings:

- tick **Request user authorization (OAuth) during installation**;
- set the **Callback URL** to `<BETTER_AUTH_URL>/api/github/callback`, e.g. `https://tasks.example.com/api/github/callback`;
- keep the webhook URL `<BETTER_AUTH_URL>/api/webhooks/github` and its secret.

v2 refuses App installations that do not come back with the user's OAuth code (it checks that the installing user can access the installation). Repositories already linked keep syncing; this only affects new installs.

If you use Slack, add `<BETTER_AUTH_URL>/api/webhooks/slack/oauth` as a redirect URL in the Slack app (see the README).

## 4. Re-point the domain

In Dokploy → Domains, change the domain's service from **`tasksflow-web`, port 3000** to **`tasksflow-api`, port 3001**. Do this before deploying: v2 has no `tasksflow-web` service, and Dokploy applies the routing when the compose service deploys.

## 5. Deploy v2

Deploy the v2 branch. The first boot of `tasksflow-api`:

1. takes the migration advisory lock and applies `0016_v2`, in order:
   - normalises task priorities to `urgent`/`high`/`medium`/`low`/`none` (anything else becomes no priority) and state categories to `backlog`/`in_progress`/`done` (`completed`, `closed`, `cancelled`… become `done`; `started`, `review`… become `in_progress`; the rest `backlog`), then adds the CHECK constraints;
   - applies the v2 schema (sub-tasks, relations, notifications, jobs, outgoing webhooks, rate-limit and integration tables, the full-text search column);
   - backfills per-project task sequence counters;
   - switches `tasks.position` to `COLLATE "C"` (byte order) and makes `rate_limit_counters` UNLOGGED;
   - rewrites GitHub external ids to `owner/repo#N` (from the issue URL) and folds legacy GitHub configs into `repositories[]`;
   - seeds MCP OAuth token families for existing refresh and access tokens;
   - deletes project ACL rows and smart-view shares for users who are no longer workspace members and labels attached across projects, and moves tasks that point at another project's state to their own project's state of the same category (same name preferred); backfills `completed_at` for tasks already in a done state;
2. then, in the background, re-keys task columns whose position keys the v1 generator left invalid (logged as `Re-keyed N task column(s)`).

Watch the logs for `Applying database migrations from /app/drizzle` and `FlowTask API running at …`. Drizzle applies pending migrations in one transaction, so if `0016_v2` fails the database is left as it was; the container logs `Database migration failed:` and restarts. Fix the cause or restore the backup (step 1) and redeploy v1.

## 6. Verify

- `https://<domain>/health` returns `{"status":"ok","database":"ok",…}` and `/ready` returns `{"status":"ready"}`.
- Sign in, open a board, move a task in one tab and watch it move in another (SSE).
- If you use GitHub, edit a linked issue and check the task updates (and the reverse).
- `docker ps` shows `tasksflow-backup` running.

## 7. Remove the v1 leftovers

Only after v2 is healthy. Compose does not remove services that disappeared from the file, so remove them by hand:

```bash
docker ps -a --format '{{.Names}}' | grep -E 'tasksflow-web|tasksflow-migrate|redis'
docker rm -f <those containers>

docker volume ls | grep redis_data          # e.g. <project>_tasksflow_redis_data
docker volume rm <that volume>
```

Redis only held v1 pub/sub, rate-limit counters and caches; nothing in it is needed by v2.

## 8. Copy backups off-host

The new `tasksflow-backup` sidecar writes daily dumps to the `tasksflow_backups` volume on the same host. Set up an off-host copy now (Dokploy volume backups, rsync, restic): see [backup-restore.md](backup-restore.md).

## Notes for users

- **MCP clients keep working.** `/api/mcp/sse` is still served (as an alias of `/api/mcp`), existing OAuth tokens are carried into token families by `0016_v2`, and their resource binding accepts both paths. Only clients still configured with the old split endpoints (`/api/mcp/sse/stream`, `/api/mcp/sse/message`) or a legacy `ft_v1_*` token need to be re-added with the URL `https://<domain>/api/mcp`.
- **Password users must link a social account.** Email/password sign-up is gone; existing password accounts can still sign in. Ask those users to sign in with their password and connect GitHub under **Settings → Integrations** (`/settings/user/integrations`). Linking requires the GitHub account's verified email to match their FlowTask email. The settings page offers GitHub only; Google is linked automatically at Google sign-in only when both emails are verified and match.
- **App managers** come from `APP_MANAGER_EMAILS`, applied at the listed users' next login.
