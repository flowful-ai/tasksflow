# Backups and restore

## Backing up

`docker-compose.prod.yml` does not back the database up. Back it up from the host, with the tooling you already use for your other Postgres instances, so one schedule and one off-host copy cover everything on the machine.

Everything FlowTask stores is in the `postgres` service. A logical dump is the backup to keep: it restores across Postgres minor versions and onto another host, where a copy of the `tasksflow_postgres_data` volume taken while Postgres runs may not be consistent.

Commands below assume you are in the deployed compose project (in Dokploy, the compose directory on the host) and use `docker compose -f docker-compose.prod.yml`; replace `flowtask` with your `POSTGRES_USER` and `POSTGRES_DB` if you changed them.

```bash
C="docker compose -f docker-compose.prod.yml"

# A dump (nightly from cron, or by hand before an upgrade)
$C exec -T postgres pg_dump -U flowtask --clean --if-exists --no-owner flowtask \
  | gzip > flowtask-$(date +%Y%m%d).sql.gz
gunzip -t flowtask-$(date +%Y%m%d).sql.gz
```

`--clean --if-exists` makes the dump start with `DROP … IF EXISTS` statements, so it restores over an existing database; `--no-owner` keeps it independent of role names. Copy the dumps off the host (restic, rsync, or your provider's object storage): a dump on the same disk as the database does not survive losing the host.

### Upgrading from a release with the backup sidecar

Earlier v2 releases ran a `tasksflow-backup` container (`prodrigestivill/postgres-backup-local`) that wrote dumps to a `tasksflow_backups` volume. Compose does not remove a service that disappears from the file, so after deploying remove it by hand, once your host backup is in place:

```bash
docker ps -a --format '{{.Names}}' | grep tasksflow-backup
docker rm -f <that container>

# The old dumps: keep a copy if you want them, then
docker volume ls | grep tasksflow_backups   # e.g. <project>_tasksflow_backups
docker volume rm <that volume>
```

## Restore drill

Rehearse on a scratch database first; it proves the dumps are usable without touching production.

```bash
C="docker compose -f docker-compose.prod.yml"

# 1. Create a scratch database next to the real one
$C exec postgres createdb -U flowtask flowtask_restore_test

# 2. Load a dump into it
gunzip -c flowtask-YYYYMMDD.sql.gz \
  | $C exec -T postgres psql -U flowtask -v ON_ERROR_STOP=1 flowtask_restore_test

# 3. Sanity checks: row counts and the last migrations applied
$C exec postgres psql -U flowtask flowtask_restore_test -c \
  "SELECT (SELECT count(*) FROM users) AS users, (SELECT count(*) FROM tasks) AS tasks;"
$C exec postgres psql -U flowtask flowtask_restore_test -c \
  "SELECT id, created_at FROM drizzle.__drizzle_migrations ORDER BY id DESC LIMIT 3;"

# 4. Drop it
$C exec postgres dropdb -U flowtask flowtask_restore_test
```

On an empty database the dump's `DROP … IF EXISTS` statements do nothing.

## Restoring production

1. **Stop the API** so nothing writes during the restore: `$C stop tasksflow-api` (or stop the service in Dokploy).
2. **Keep a copy of the current state**, even if it is broken: `$C exec -T postgres pg_dump -U flowtask --clean --if-exists --no-owner flowtask | gzip > before-restore.sql.gz`.
3. **Load the dump you want**:

   ```bash
   gunzip -c flowtask-YYYYMMDD.sql.gz | $C exec -T postgres psql -U flowtask -v ON_ERROR_STOP=1 flowtask
   ```

4. **Start the API**: `$C start tasksflow-api`. It applies any migration newer than the dump on boot. Check `/health`.

Restoring an older dump loses everything written after it, including GitHub sync state; run a manual GitHub sync from the project settings afterwards if needed.
