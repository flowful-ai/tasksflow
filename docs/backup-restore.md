# Backups and restore

## How backups work

`docker-compose.prod.yml` runs a `tasksflow-backup` sidecar from [`prodrigestivill/postgres-backup-local`](https://github.com/prodrigestivill/docker-postgres-backup-local) (`16-alpine-d257e5d`, matching Postgres 16). It connects to the `postgres` service with the same `POSTGRES_*` credentials and writes gzipped `pg_dump` files to the `tasksflow_backups` volume, mounted at `/backups`.

Settings from the compose file:

| Setting               | Value                            | Effect                                                                                      |
| --------------------- | -------------------------------- | ------------------------------------------------------------------------------------------- |
| `SCHEDULE`            | `@daily`                         | One dump a day (cron syntax).                                                               |
| `BACKUP_KEEP_DAYS`    | `7`                              | Daily dumps kept for 7 days.                                                                |
| `BACKUP_KEEP_WEEKS`   | `4`                              | Weekly dumps kept for 4 weeks.                                                              |
| `BACKUP_KEEP_MONTHS`  | `6`                              | Monthly dumps kept for 6 months.                                                            |
| `POSTGRES_EXTRA_OPTS` | `--clean --if-exists --no-owner -Z 6` | Each dump drops and recreates objects when restored, does not depend on role ownership, and is gzip-compressed (the image only compresses when `-Z` is passed). |
| `HEALTHCHECK_PORT`    | `8080`                           | The image's healthcheck endpoint.                                                           |

Inside the volume the image keeps `daily/`, `weekly/`, `monthly/` and `last/` folders; `last/` holds the newest dump as `<db>-latest.sql.gz` (for the default database, `flowtask-latest.sql.gz`).

Commands below assume you are in the deployed compose project (in Dokploy, the compose directory on the host) and use `docker compose -f docker-compose.prod.yml`; replace `flowtask` with your `POSTGRES_USER` and `POSTGRES_DB` if you changed them.

```bash
# List the dumps
docker compose -f docker-compose.prod.yml exec tasksflow-backup ls -lR /backups

# Take a dump now (before an upgrade, for example)
docker compose -f docker-compose.prod.yml exec tasksflow-backup /backup.sh
```

## Off-host copy

The `tasksflow_backups` volume lives on the same host as the database, so it does not survive losing the host or its disk. Copy it elsewhere:

- **Dokploy volume backups**: schedule a backup of the `tasksflow_backups` volume to an S3-compatible destination configured in Dokploy.
- **rsync** from another machine, daily:

  ```bash
  # On the host, find the volume's path:
  docker volume inspect --format '{{ .Mountpoint }}' <project>_tasksflow_backups
  # From the backup machine (cron):
  rsync -a --delete <host>:/var/lib/docker/volumes/<project>_tasksflow_backups/_data/ ~/flowtask-backups/
  ```

- **restic** (or similar) on the host, pointed at the volume's mount point and an off-site repository.

Check the copy now and then: open the newest file with `gunzip -t`.

## Restore drill

Rehearse on a scratch database first; it proves the dumps are usable without touching production.

```bash
C="docker compose -f docker-compose.prod.yml"

# 1. Create a scratch database next to the real one
$C exec postgres createdb -U flowtask flowtask_restore_test

# 2. Load the latest dump into it
$C exec -T tasksflow-backup cat /backups/last/flowtask-latest.sql.gz \
  | gunzip \
  | $C exec -T postgres psql -U flowtask -v ON_ERROR_STOP=1 flowtask_restore_test

# 3. Sanity checks: row counts and the last migrations applied
$C exec postgres psql -U flowtask flowtask_restore_test -c \
  "SELECT (SELECT count(*) FROM users) AS users, (SELECT count(*) FROM tasks) AS tasks;"
$C exec postgres psql -U flowtask flowtask_restore_test -c \
  "SELECT id, created_at FROM drizzle.__drizzle_migrations ORDER BY id DESC LIMIT 3;"

# 4. Drop it
$C exec postgres dropdb -U flowtask flowtask_restore_test
```

`--clean --if-exists` makes the dump start with `DROP … IF EXISTS` statements; on an empty database they do nothing.

## Restoring production

1. **Stop the API** so nothing writes during the restore: `$C stop tasksflow-api` (or stop the service in Dokploy).
2. **Keep a copy of the current state**, even if it is broken: `$C exec tasksflow-backup /backup.sh`, or `$C exec -T postgres pg_dump -U flowtask flowtask | gzip > before-restore.sql.gz`.
3. **Load the dump you want** (from `daily/`, `weekly/`, `monthly/`, `last/`, or an off-host copy):

   ```bash
   gunzip -c flowtask-YYYYMMDD.sql.gz | $C exec -T postgres psql -U flowtask -v ON_ERROR_STOP=1 flowtask
   ```

   For a file inside the volume, pipe it out of the sidecar as in the drill (`$C exec -T tasksflow-backup cat /backups/daily/<file>`).

4. **Start the API**: `$C start tasksflow-api`. It applies any migration newer than the dump on boot. Check `/health`.

Restoring an older dump loses everything written after it, including GitHub sync state; run a manual GitHub sync from the project settings afterwards if needed.
