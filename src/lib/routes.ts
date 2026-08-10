export const EVENT_SCREENS = [
  'event',
  'admin',
  'admin-event',
  'admin-holes',
  'admin-roster',
  'admin-teams',
  'announcements',
  'complete-round',
  'collect-scores',
  'conversation-settings',
  'course-map',
  'create-group',
  'direct-message',
  'directory',
  'group-conversation',
  'group-details',
  'leaderboard',
  'messages',
  'my-team',
  'new-message',
  'notifications',
  'participant-profile',
  'profile',
  'score-input',
  'scorecard',
] as const;

export type EventScreenName = (typeof EVENT_SCREENS)[number];

export function isEventScreenName(value: string): value is EventScreenName {
  return (EVENT_SCREENS as readonly string[]).includes(value);
}

export function eventPath(eventId: string, screen: EventScreenName): string {
  return `/events/${encodeURIComponent(eventId)}/${screen}`;
}

export function legacyEventScreen(pathname: string): EventScreenName | null {
  const screen = pathname.startsWith('/') ? pathname.slice(1) : pathname;
  return isEventScreenName(screen) ? screen : null;
}
