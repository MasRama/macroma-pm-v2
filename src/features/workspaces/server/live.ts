import { liveTopic, publish, type Topic } from '../../../shared/realtime';
import { WORKSPACES_CHANGED_EVENT, WORKSPACES_CHAT_EVENT } from '../contract';

/** Reaches the members of the workspace that changed, and an invitee it concerns. */
export function workspacesChangedTopic(): Topic {
  return liveTopic(WORKSPACES_CHANGED_EVENT, { affected: true });
}

/** Reaches the members of the workspace a message was posted in. */
export function workspacesChatTopic(): Topic {
  return liveTopic(WORKSPACES_CHAT_EVENT, { affected: true });
}

export function announceWorkspaceChange(userIds: Iterable<string>): void {
  const recipients = [...new Set(userIds)];
  if (recipients.length > 0) publish(workspacesChangedTopic(), recipients);
}

export function announceChatMessage(userIds: Iterable<string>): void {
  const recipients = [...new Set(userIds)];
  if (recipients.length > 0) publish(workspacesChatTopic(), recipients);
}
