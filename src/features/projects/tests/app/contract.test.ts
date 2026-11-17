import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { app } from '../../../../app/server';
import { signUp } from '../../../../app/tests/personas';
import { webCsrf } from '../../../../app/tests/web-csrf';
import { installBrowser, type TestBrowser } from '../../../../shared/security/tests/browser';
import { projectsResponseSchemas } from '../../contract';
import { createProjectsClient } from '../../web';

const schemas = projectsResponseSchemas();

describe('projects web client contract', () => {
  let browser: TestBrowser;
  const client = createProjectsClient({ csrf: webCsrf });

  beforeEach(() => {
    browser = installBrowser(app);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('answers every method in the declared success shape', async () => {
    await browser.signUp();
    const teammate = await signUp('Contract Teammate');

    const id = schemas.projectSaved.parse(await client.create({ name: 'Contract Project', description: 'About' })).data.project.id;
    schemas.projects.parse(await client.list());
    schemas.projects.parse(await client.list({ workspace_id: randomUUID() }));
    expect(schemas.projectSaved.parse(await client.update(id, { revision: 1, name: 'Renamed' })).data.project.revision).toBe(2);
    schemas.memberAdded.parse(await client.addMember(id, { email: teammate.email }));

    const batch = schemas.batchSaved.parse(await client.createBatch(id, { label: 'First', activate: true })).data.batch;
    const second = schemas.batchSaved.parse(await client.createBatch(id, { bump_major: true })).data.batch;
    schemas.batchSaved.parse(await client.activateBatch(id, second.id));
    schemas.batches.parse(await client.batches(id));

    const task = schemas.taskSaved.parse(
      await client.createTask(id, { title: 'Contract task', priority: 'high', assignee_id: teammate.id, batch_id: batch.id }),
    ).data.task;
    schemas.taskMoved.parse(await client.moveTask(task.id, { column_id: 'revisi', note: 'Again' }));
    schemas.taskSaved.parse(await client.updateTask(task.id, { revision: 1, description: 'More' }));
    schemas.tasks.parse(await client.tasks(id));
    schemas.tasks.parse(await client.tasks(id, { batch_id: batch.id }));
    expect(schemas.taskDetailFound.parse(await client.task(task.id)).data.task.revisi_count).toBe(1);
    schemas.taskLogs.parse(await client.taskLogs(task.id));
    schemas.projectDetail.parse(await client.get(id));
    schemas.activity.parse(await client.activity(id));

    schemas.done.parse(await client.removeTask(task.id));
    schemas.done.parse(await client.removeMember(id, teammate.id));
    schemas.done.parse(await client.remove(id));
  });

  it('answers refusals in the declared error shapes', async () => {
    expect(schemas.error.parse(await client.list())).toMatchObject({ code: 'UNAUTHORIZED' });
    await browser.signUp();
    expect(schemas.error.parse(await client.get(randomUUID()))).toMatchObject({ code: 'PROJECT_NOT_FOUND' });
    expect(schemas.error.parse(await client.task(randomUUID()))).toMatchObject({ code: 'TASK_NOT_FOUND' });
    const id = schemas.projectSaved.parse(await client.create({ name: 'Refusals' })).data.project.id;
    await client.update(id, { revision: 1, name: 'Moved on' });
    expect(schemas.staleProject.parse(await client.update(id, { revision: 1, name: 'Stale' })).current.revision).toBe(2);
    expect(schemas.error.parse(await client.addMember(id, { email: `${randomUUID()}@example.com` }))).toMatchObject({
      code: 'ACCOUNT_NOT_FOUND',
    });
    expect(schemas.error.parse(await client.activateBatch(id, randomUUID()))).toMatchObject({ code: 'BATCH_NOT_FOUND' });
    expect(schemas.error.parse(await client.tasks(id, { batch_id: randomUUID() }))).toMatchObject({ code: 'BATCH_NOT_FOUND' });

    const task = schemas.taskSaved.parse(await client.createTask(id, { title: 'Refused' })).data.task;
    expect(schemas.error.parse(await client.moveTask(task.id, { column_id: 'backlog' }))).toMatchObject({ code: 'TASK_ALREADY_IN_COLUMN' });
    expect(schemas.error.parse(await client.moveTask(task.id, { column_id: 'revisi' }))).toMatchObject({ code: 'VALIDATION_ERROR' });
    await client.updateTask(task.id, { revision: 1, title: 'Moved on' });
    expect(schemas.staleTask.parse(await client.updateTask(task.id, { revision: 1, title: 'Stale' })).current.revision).toBe(2);
  });
});
