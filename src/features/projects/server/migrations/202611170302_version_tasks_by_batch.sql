-- A task's version follows the batch it belongs to: major.minor come from
-- the batch and each batch counts its own patches. The project counter is
-- left for tasks outside any batch, which are versioned v0.0.x.
ALTER TABLE project_batches ADD COLUMN patch_counter INTEGER NOT NULL DEFAULT 0;

-- Each batch continues after the highest patch its tasks already carry in
-- its own version line (imported or created before this change).
UPDATE project_batches
SET patch_counter = COALESCE(
  (
    SELECT MAX(t.version_patch) FROM tasks t
    WHERE t.batch_id = project_batches.id
      AND t.version_major = project_batches.major
      AND t.version_minor = project_batches.minor
  ),
  0
);

UPDATE project_version_counters
SET patch_counter = COALESCE(
  (
    SELECT MAX(t.version_patch) FROM tasks t
    WHERE t.project_id = project_version_counters.project_id
      AND t.batch_id IS NULL
      AND t.version_major = 0
      AND t.version_minor = 0
  ),
  0
);

ALTER TABLE project_version_counters DROP COLUMN major;
ALTER TABLE project_version_counters DROP COLUMN minor;
