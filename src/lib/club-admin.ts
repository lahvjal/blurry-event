import type { AccessibleEvent, ClubMember } from '@/state/types';

export function clubMemberMatchesSearch(member: ClubMember, query: string): boolean {
  const normalized = query.trim().toLocaleLowerCase();
  if (!normalized) return true;

  return [
    member.displayName,
    member.username ?? '',
    ...member.attendances.flatMap((attendance) => [
      attendance.eventName,
      attendance.courseName,
    ]),
  ].some((value) => value.toLocaleLowerCase().includes(normalized));
}

/** The announcement author must be a participant in its destination event. */
export function announcementAuthorForEvent(event: AccessibleEvent): string | null {
  return event.registration?.participantId ?? null;
}

export function canSubmitEventAnnouncement({
  body,
  eventId,
  offline,
  posting,
}: {
  body: string;
  eventId: string;
  offline: boolean;
  posting: boolean;
}): boolean {
  return body.trim().length > 0 && eventId.length > 0 && !offline && !posting;
}
