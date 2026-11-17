import { liveTopic, publish, type Topic } from '../../../shared/realtime';
import { NOTIFICATIONS_CHANGED_EVENT } from '../contract';

/** Reaches only the accounts whose notifications changed. */
export function notificationsChangedTopic(): Topic {
  return liveTopic(NOTIFICATIONS_CHANGED_EVENT, { affected: true });
}

export function announceNotifications(userIds: Iterable<string>): void {
  const recipients = [...new Set(userIds)];
  if (recipients.length > 0) publish(notificationsChangedTopic(), recipients);
}
