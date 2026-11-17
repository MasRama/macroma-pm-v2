import { liveTopic, publish, type Topic } from '../../../shared/realtime';
import { PROJECTS_BOARD_CHANGED_EVENT, PROJECTS_CHANGED_EVENT } from '../contract';

/** Reaches the accounts that can open the project that changed, and any that just lost it. */
export function projectsChangedTopic(): Topic {
  return liveTopic(PROJECTS_CHANGED_EVENT, { affected: true });
}

/** Reaches the accounts that can open the project whose board changed. */
export function projectsBoardChangedTopic(): Topic {
  return liveTopic(PROJECTS_BOARD_CHANGED_EVENT, { affected: true });
}

function recipients(userIds: Iterable<string>): string[] {
  return [...new Set(userIds)];
}

export function announceProjectChange(userIds: Iterable<string>): void {
  const affected = recipients(userIds);
  if (affected.length > 0) publish(projectsChangedTopic(), affected);
}

export function announceBoardChange(userIds: Iterable<string>): void {
  const affected = recipients(userIds);
  if (affected.length > 0) publish(projectsBoardChangedTopic(), affected);
}
