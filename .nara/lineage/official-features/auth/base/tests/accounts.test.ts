import { randomUUID } from 'node:crypto';
import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { getDatabase } from '../../../shared/database';
import { closeEventStreams, createEventStream, STREAM_READY_EVENT } from '../../../shared/realtime';
import { readEvents } from '../../../shared/realtime/tests/helpers';
import { AUTH_SESSIONS_CHANGED_EVENT, AUTH_TOKENS_CHANGED_EVENT } from '../contract';
import {
  createAccount,
  createAccountWithRoles,
  deleteAccounts,
  findAccountByEmail,
  findAccountById,
  findAccountsByIds,
  importAccounts,
  listAccounts,
  onAccountsDeleted,
  resetAccountPassword,
  updateAccount,
  updateAccountWithRoles,
} from '../server/accounts';
import { createRole } from '../server/access';
import { checkPassword, hashPassword, startSession } from '../server/service';
import { createApiToken, findUserById } from '../server/repository';

/**
 * A page of the account that stays open through a reset: the reset signs out
 * every real session, so a stream resolved by session would end before the
 * reset's events.
 */
async function watch(userId: string) {
  const listener = { userId, sessionId: randomUUID() };
  const events = new Hono().get('/events', createEventStream({ resolve: () => listener, allows: () => true }));
  const reader = readEvents(await events.request('/events'));
  expect(await reader.next()).toBe(STREAM_READY_EVENT);
  return async () => {
    const seen: string[] = [];
    for (let event = await reader.next(100); event !== 'timeout' && event !== 'closed'; event = await reader.next(100)) seen.push(event);
    return seen;
  };
}

function uniqueEmail(): string {
  return `${randomUUID()}@example.com`;
}

describe('auth account directory', () => {
  it('creates and reads accounts without exposing password hashes', () => {
    const account = createAccount({ id: randomUUID(), name: 'Ada', email: uniqueEmail(), passwordHash: 'hash' });

    expect(account).toMatchObject({ id: account.id, name: 'Ada', avatar: null });
    expect(account).not.toHaveProperty('password');
    expect(findAccountById(account.id)).toEqual(account);
    expect(findAccountById(randomUUID())).toBeUndefined();
  });

  it('finds accounts in bulk by id and one by email, ignoring case', () => {
    const first = createAccount({ id: randomUUID(), name: 'Bulk One', email: uniqueEmail(), passwordHash: 'hash' });
    const second = createAccount({ id: randomUUID(), name: 'Bulk Two', email: uniqueEmail(), passwordHash: 'hash' });

    expect(findAccountsByIds([]).length).toBe(0);
    const found = findAccountsByIds([first.id, second.id, first.id, randomUUID()]);
    expect(found.map((account) => account.id).sort()).toEqual([first.id, second.id].sort());
    expect(found[0]).not.toHaveProperty('password');

    expect(findAccountByEmail(first.email.toUpperCase())?.id).toBe(first.id);
    expect(findAccountByEmail(uniqueEmail())).toBeUndefined();
  });

  it('lists accounts with search and bounded pagination', () => {
    const marker = randomUUID();
    createAccount({ id: randomUUID(), name: `List ${marker}`, email: uniqueEmail(), passwordHash: 'hash' });
    createAccount({ id: randomUUID(), name: `List ${marker}`, email: uniqueEmail(), passwordHash: 'hash' });

    const page = listAccounts(1, 10, marker);
    expect(page.total).toBe(2);
    expect(page.data).toHaveLength(2);

    const clamped = listAccounts(0, 500, marker);
    expect(clamped.data).toHaveLength(2);
  });


  it('treats SQL LIKE wildcards literally and bounds extreme pages', () => {
    const marker = randomUUID().slice(0, 8);
    const percent = createAccount({ id: randomUUID(), name: `Literal % ${marker}`, email: uniqueEmail(), passwordHash: 'hash' });
    const underscore = createAccount({ id: randomUUID(), name: `Literal _ ${marker}`, email: uniqueEmail(), passwordHash: 'hash' });
    createAccount({ id: randomUUID(), name: `Literal plain ${marker}`, email: uniqueEmail(), passwordHash: 'hash' });

    expect(listAccounts(1, 10, `% ${marker}`).data.map((row) => row.id)).toEqual([percent.id]);
    expect(listAccounts(1, 10, `_ ${marker}`).data.map((row) => row.id)).toEqual([underscore.id]);
    expect(() => listAccounts(Number.MAX_VALUE, Number.MAX_VALUE, marker)).not.toThrow();
  });

  it('rolls back managed account mutations when role persistence fails', () => {
    const createEmail = uniqueEmail();
    expect(() =>
      createAccountWithRoles(
        { id: randomUUID(), name: 'Atomic Create', email: createEmail, passwordHash: 'hash' },
        ['missing-role'],
      ),
    ).toThrow();
    expect(getDatabase().prepare('SELECT id FROM users WHERE email = ?').get(createEmail)).toBeUndefined();

    const account = createAccount({ id: randomUUID(), name: 'Atomic Before', email: uniqueEmail(), passwordHash: 'hash' });
    expect(() => updateAccountWithRoles(account.id, { name: 'Atomic After' }, { roleIds: ['missing-role'] })).toThrow();
    expect(findAccountById(account.id)?.name).toBe('Atomic Before');

    // A stale update stops before role assignment: the unknown role is never written.
    expect(updateAccountWithRoles(account.id, { name: 'Stale After' }, { roleIds: ['missing-role'], revision: 99 })).toMatchObject({
      status: 'stale',
      account: { name: 'Atomic Before' },
    });
  });

  it('updates accounts and rejects duplicate emails', () => {
    const first = createAccount({ id: randomUUID(), name: 'First', email: uniqueEmail(), passwordHash: 'hash' });
    const second = createAccount({ id: randomUUID(), name: 'Second', email: uniqueEmail(), passwordHash: 'hash' });

    expect(first.revision).toBe(1);
    const updated = updateAccount(first.id, { name: 'First Updated', avatar: '/avatar.webp' }, 1);
    expect(updated).toMatchObject({
      status: 'updated',
      account: { id: first.id, name: 'First Updated', avatar: '/avatar.webp', revision: 2 },
    });
    expect(updateAccount(first.id, { name: 'First Stale' }, 1)).toMatchObject({
      status: 'stale',
      account: { name: 'First Updated', revision: 2 },
    });
    expect(updateAccount(first.id, { avatar: null })).toMatchObject({ status: 'updated', account: { revision: 3 } });
    expect(updateAccount(randomUUID(), { name: 'Nobody' })).toEqual({ status: 'missing' });

    for (const write of [
      () => updateAccount(first.id, { email: second.email }),
      () => createAccount({ id: randomUUID(), name: 'Clash', email: second.email, passwordHash: 'hash' }),
    ]) {
      let failed: unknown;
      try {
        write();
      } catch (error) {
        failed = error;
      }
      expect(failed).toMatchObject({ code: 'SQLITE_CONSTRAINT_UNIQUE' });
    }
  });
  it('revokes target sessions when a managed password reset commits', () => {
    const account = createAccount({ id: randomUUID(), name: 'Reset Target', email: uniqueEmail(), passwordHash: 'old-hash' });
    startSession({ ...account, verified: 0, password: 'old-hash', must_change_password: 0, password_usable: 1, created_at: 1, updated_at: 1 }, undefined);
    expect(getDatabase().prepare('SELECT COUNT(*) AS count FROM sessions WHERE user_id = ?').get(account.id)).toEqual({ count: 1 });

    const updated = resetAccountPassword(account.id, 'new-hash');
    expect(updated?.id).toBe(account.id);
    expect(getDatabase().prepare('SELECT password, must_change_password FROM users WHERE id = ?').get(account.id)).toEqual({
      password: 'new-hash',
      must_change_password: 1,
    });
    expect(getDatabase().prepare('SELECT COUNT(*) AS count FROM sessions WHERE user_id = ?').get(account.id)).toEqual({ count: 0 });
  });

  it('tells the account its API tokens changed when a managed password reset revoked some', async () => {
    const withToken = createAccount({ id: randomUUID(), name: 'Token Holder', email: uniqueEmail(), passwordHash: 'old-hash' });
    createApiToken(
      { id: randomUUID(), userId: withToken.id, name: 'cli', tokenHash: randomUUID(), prefix: 'mcr_test', scope: 'write', expiresAt: null },
      10,
    );
    const withoutToken = createAccount({ id: randomUUID(), name: 'No Tokens', email: uniqueEmail(), passwordHash: 'old-hash' });
    const [heardWithToken, heardWithoutToken] = [await watch(withToken.id), await watch(withoutToken.id)];

    resetAccountPassword(withToken.id, 'new-hash');
    // Nothing revoked, nothing to tell.
    resetAccountPassword(withoutToken.id, 'new-hash');

    expect(getDatabase().prepare('SELECT revoked_at FROM api_tokens WHERE user_id = ?').get(withToken.id)).toEqual({
      revoked_at: expect.any(Number),
    });
    expect(await heardWithToken()).toEqual([AUTH_SESSIONS_CHANGED_EVENT, AUTH_TOKENS_CHANGED_EVENT]);
    expect(await heardWithoutToken()).toEqual([AUTH_SESSIONS_CHANGED_EVENT]);
    closeEventStreams();
  });

  it('tells deletion listeners inside the deleting transaction, and rolls back when one throws', () => {
    const seen: string[][] = [];
    let failing = false;
    onAccountsDeleted((userIds) => {
      seen.push([...userIds]);
      if (failing) throw new Error('listener failed');
    });
    const kept = createAccount({ id: randomUUID(), name: 'Kept', email: uniqueEmail(), passwordHash: 'hash' });
    failing = true;
    expect(() => deleteAccounts([kept.id])).toThrow('listener failed');
    expect(findAccountById(kept.id)).toBeDefined();
    failing = false;
    expect(deleteAccounts([kept.id])).toBe(1);
    expect(seen.at(-1)).toEqual([kept.id]);
    expect(deleteAccounts([randomUUID()])).toBe(0);
    expect(seen).toHaveLength(2);
  });

  it('deletes accounts and cascades their sessions and role assignments', () => {
    const stored = createAccount({ id: randomUUID(), name: 'Temp', email: uniqueEmail(), passwordHash: 'stored-test-hash' });
    const account = findAccountById(stored.id)!;
    const role = createRole({ id: randomUUID(), name: `Temp ${randomUUID()}`, slug: `temp-${randomUUID()}`, description: null });
    getDatabase()
      .prepare('INSERT INTO user_roles (id, user_id, role_id, created_at) VALUES (?, ?, ?, ?)')
      .run(randomUUID(), account.id, role.id, Date.now());
    startSession(
      { ...account, verified: 0, password: 'hash', must_change_password: 0, password_usable: 1, created_at: 1, updated_at: 1 },
      undefined,
    );
    expect(deleteAccounts([account.id])).toBe(1);
    expect(deleteAccounts([])).toBe(0);
    expect(findAccountById(account.id)).toBeUndefined();
    expect(getDatabase().prepare('SELECT * FROM user_roles WHERE user_id = ?').all(account.id)).toEqual([]);
    expect(getDatabase().prepare('SELECT * FROM sessions WHERE user_id = ?').all(account.id)).toEqual([]);
  });

  it('imports accounts with their ids, password hashes, timestamps and roles', async () => {
    const role = createRole({ id: randomUUID(), name: `Imported ${randomUUID()}`, slug: `imported-${randomUUID()}`, description: null });
    const id = randomUUID();
    const email = uniqueEmail();
    importAccounts([
      {
        id,
        name: 'Imported',
        email,
        passwordHash: await hashPassword('kept-password'),
        avatar: 'https://example.com/avatar.png',
        phone: '+620000',
        verified: true,
        createdAt: 1000,
        updatedAt: 2000,
        roleIds: [role.id, role.id],
      },
    ]);

    expect(findAccountByEmail(email)).toMatchObject({ id, name: 'Imported', avatar: 'https://example.com/avatar.png', phone: '+620000', verified: true });
    expect(await checkPassword('kept-password', findUserById(id))).toBe(true);
    expect(getDatabase().prepare('SELECT created_at, updated_at FROM users WHERE id = ?').get(id)).toEqual({ created_at: 1000, updated_at: 2000 });
    expect(getDatabase().prepare('SELECT role_id FROM user_roles WHERE user_id = ?').all(id)).toEqual([{ role_id: role.id }]);
  });
});
