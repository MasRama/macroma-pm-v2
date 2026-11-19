-- The public API lists a project's tasks by (updated_at, id) and resumes
-- after the last one a page returned, so syncing changes reads an index range.
CREATE INDEX tasks_project_updated_idx ON tasks (project_id, updated_at, id);
