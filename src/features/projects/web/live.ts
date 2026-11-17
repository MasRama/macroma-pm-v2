import { computed, ref, type Ref } from 'vue';
import { onServerEvent } from '../../../shared/realtime/browser';
import { PROJECTS_CHANGED_EVENT } from '../contract';
import type { ProjectsClient } from './client';
import { toProjectSummary, type ProjectSummary } from './view';

/*
 * The account's projects, kept by the app shell for the sidebar. Refetches on
 * `projects.changed` (and on the stream's resume), never by polling.
 */

export interface ProjectsList {
  readonly items: Readonly<Ref<ProjectSummary[]>>;
  readonly loaded: Readonly<Ref<boolean>>;
  readonly error: Ref<string>;
  load(): Promise<void>;
  /** Loads now and on every `projects.changed`; returns the stop function, which empties the list. */
  start(): () => void;
}

export function createProjectsList(client: ProjectsClient): ProjectsList {
  const items = ref<ProjectSummary[]>([]);
  const loaded = ref(false);
  const error = ref('');
  let latest = 0;

  async function load(): Promise<void> {
    const ticket = ++latest;
    try {
      const response = await client.list();
      if (ticket !== latest) return;
      if (!response.success) {
        error.value = response.code === 'UNAUTHORIZED' ? '' : response.message;
        return;
      }
      items.value = response.data.projects.map(toProjectSummary);
      loaded.value = true;
      error.value = '';
    } catch (cause) {
      console.error(cause);
      if (ticket === latest) error.value = 'Daftar project belum bisa dimuat.';
    }
  }

  function start(): () => void {
    const stop = onServerEvent(PROJECTS_CHANGED_EVENT, () => void load());
    void load();
    // The next account to sign in in this tab starts from an empty list.
    return () => {
      stop();
      latest++;
      items.value = [];
      loaded.value = false;
      error.value = '';
    };
  }

  return { items: computed(() => items.value), loaded: computed(() => loaded.value), error, load, start };
}
