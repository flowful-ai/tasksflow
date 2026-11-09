-- Workstream B · run AFTER the v2 schema migration (idempotent).
--
-- Backfill projects.next_task_seq = MAX(tasks.sequence_number) + 1 (never
-- lowering an existing counter). TaskService also self-heals with GREATEST()
-- at allocation time, so this is belt and braces.

ALTER TABLE projects ADD COLUMN IF NOT EXISTS next_task_seq integer NOT NULL DEFAULT 1;

UPDATE projects p
SET next_task_seq = GREATEST(p.next_task_seq, s.max_seq + 1)
FROM (
  SELECT project_id, MAX(sequence_number) AS max_seq
  FROM tasks
  GROUP BY project_id
) s
WHERE s.project_id = p.id
  AND p.next_task_seq < s.max_seq + 1;
