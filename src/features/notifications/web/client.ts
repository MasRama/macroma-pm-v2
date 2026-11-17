import { hc } from 'hono/client';
import type { NotificationsListResponse, NotificationsMarkResponse } from '../contract';
import type { createNotificationRoutes } from '..';

/** CSRF provider for state-changing requests; the application binds it to its identity provider. */
export interface NotificationsWebCsrf {
  headers(extra?: HeadersInit): Record<string, string>;
  ensureToken(): Promise<unknown>;
}

export interface NotificationsClient {
  /** The latest notifications, newest first, with the unread count. */
  list(): Promise<NotificationsListResponse>;
  markRead(id: string): Promise<NotificationsMarkResponse>;
  markAllRead(): Promise<NotificationsMarkResponse>;
}

export interface NotificationsClientOptions {
  baseUrl?: string;
  /** Without it, writes reach the server without a CSRF token and fail closed there. */
  csrf?: NotificationsWebCsrf;
}

export function createNotificationsClient(options: NotificationsClientOptions = {}): NotificationsClient {
  const { baseUrl = '/api/notifications', csrf } = options;
  const apiFetch: typeof fetch = async (input, init = {}) => {
    const method = (init.method ?? 'GET').toUpperCase();
    if (method !== 'GET' && method !== 'HEAD') await csrf?.ensureToken();
    return fetch(input, { ...init, credentials: 'include', headers: csrf ? csrf.headers(init.headers) : init.headers });
  };
  const api = hc<ReturnType<typeof createNotificationRoutes>>(baseUrl.replace(/\/$/, ''), { fetch: apiFetch });

  return {
    list: async () => (await api.index.$get()).json(),
    markRead: async (id) => (await api[':id'].read.$post({ param: { id } })).json(),
    markAllRead: async () => (await api['read-all'].$post()).json(),
  };
}
