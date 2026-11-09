-- v2 authorization data cleanup (idempotent; safe to run repeatedly).
--
-- Before v2, project ACL lists and smart-view shares accepted any user id,
-- and removing a workspace member left their project ACL rows behind. The
-- API now only allows workspace members in both, so drop rows that point at
-- users who are not members of the owning workspace.

DELETE FROM project_members pm
USING projects p
WHERE pm.project_id = p.id
  AND NOT EXISTS (
    SELECT 1
    FROM workspace_members wm
    WHERE wm.workspace_id = p.workspace_id
      AND wm.user_id = pm.user_id
  );

DELETE FROM smart_view_shares svs
USING smart_views sv
WHERE svs.smart_view_id = sv.id
  AND NOT EXISTS (
    SELECT 1
    FROM workspace_members wm
    WHERE wm.workspace_id = sv.workspace_id
      AND wm.user_id = svs.shared_with_user_id
  );

-- Labels attached to tasks of a different project (cross-project label bug).
DELETE FROM task_labels tl
USING tasks t, labels l
WHERE tl.task_id = t.id
  AND tl.label_id = l.id
  AND l.project_id <> t.project_id;

-- Tasks pointing at a state of a different project lose that state.
UPDATE tasks t
SET state_id = NULL
FROM task_states s
WHERE t.state_id = s.id
  AND s.project_id <> t.project_id;
