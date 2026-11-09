-- Workstream B · run BEFORE the v2 schema migration (idempotent).
--
-- The v2 schema adds CHECK constraints on tasks.priority and
-- task_states.category. Normalise legacy values first so adding them cannot
-- fail on existing rows.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'tasks' AND column_name = 'priority') THEN
    UPDATE tasks
    SET priority = CASE lower(trim(priority))
      WHEN 'urgent' THEN 'urgent'
      WHEN 'high' THEN 'high'
      WHEN 'medium' THEN 'medium'
      WHEN 'low' THEN 'low'
      WHEN 'none' THEN 'none'
      ELSE NULL
    END
    WHERE priority IS NOT NULL
      AND priority NOT IN ('urgent', 'high', 'medium', 'low', 'none');
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'task_states' AND column_name = 'category') THEN
    UPDATE task_states
    SET category = CASE
      WHEN lower(category) IN ('done', 'completed', 'complete', 'cancelled', 'canceled', 'closed') THEN 'done'
      WHEN lower(category) IN ('in_progress', 'in progress', 'inprogress', 'started', 'active', 'review', 'in_review') THEN 'in_progress'
      ELSE 'backlog'
    END
    WHERE category NOT IN ('backlog', 'in_progress', 'done');
  END IF;
END $$;
