-- A batch is released when it becomes active: activated_at records the
-- latest time it did, and stays NULL for a batch that was only planned.
ALTER TABLE project_batches ADD COLUMN activated_at INTEGER;

-- Existing projects: the active batch and every batch opened before it were
-- active at some point; their activation is taken as their creation.
UPDATE project_batches
SET activated_at = created_at
WHERE EXISTS (
  SELECT 1 FROM project_batches active
  WHERE active.project_id = project_batches.project_id
    AND active.is_active = 1
    AND (project_batches.created_at, project_batches.major, project_batches.minor) <= (active.created_at, active.major, active.minor)
);
