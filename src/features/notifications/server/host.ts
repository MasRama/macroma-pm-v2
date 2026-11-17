export interface NotificationsServerHost {
  readonly sessionCookieName: string;
  resolveActor(sessionToken: string | undefined): { id: string } | undefined;
}
