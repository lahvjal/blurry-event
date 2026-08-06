import type { PlayingGroup, StartFormat } from '@/state/types';

function parseScheduleTime(value: string): number | null {
  const match = value
    .trim()
    .toUpperCase()
    .match(/^(\d{1,2}):(\d{2})\s*(AM|PM)?$/);
  if (!match) return null;
  let hours = Number(match[1]);
  const minutes = Number(match[2]);
  const meridiem = match[3];
  if (minutes > 59) return null;
  if (meridiem) {
    if (hours < 1 || hours > 12) return null;
    if (meridiem === 'PM' && hours !== 12) hours += 12;
    if (meridiem === 'AM' && hours === 12) hours = 0;
  } else if (hours > 23) return null;
  return hours * 60 + minutes;
}

function formatScheduleTime(minutesSinceMidnight: number): string {
  const total = ((minutesSinceMidnight % 1440) + 1440) % 1440;
  const hours24 = Math.floor(total / 60);
  const minutes = total % 60;
  const hours12 = hours24 % 12 === 0 ? 12 : hours24 % 12;
  return `${hours12}:${String(minutes).padStart(2, '0')} ${hours24 < 12 ? 'AM' : 'PM'}`;
}

export const PLAYING_GROUP_CAPACITY = 4;

export type StartSlot = {
  teeTime: string;
  startingHole: number;
};

/** Canonical ordered slots offered by one start format. */
export function startSlots(
  format: StartFormat,
  startTime: string,
  teeTimes: string[],
): StartSlot[] {
  if (format === 'shotgun') {
    return Array.from({ length: 18 }, (_, index) => ({
      teeTime: startTime,
      startingHole: index + 1,
    }));
  }

  const times = teeTimes.length > 0 ? teeTimes : startTime ? [startTime] : [];
  if (format === 'split_tee') {
    return times.flatMap((teeTime) => [
      { teeTime, startingHole: 1 },
      { teeTime, startingHole: 10 },
    ]);
  }
  return times.map((teeTime) => ({ teeTime, startingHole: 1 }));
}

/**
 * Re-seats groups deterministically when the event's start format changes.
 * Membership, names and carts remain untouched; overflow groups stay unassigned.
 */
export function seatPlayingGroups(
  groups: PlayingGroup[],
  format: StartFormat,
  startTime: string,
  teeTimes: string[],
): PlayingGroup[] {
  const slots = startSlots(format, startTime, teeTimes);
  const available = [...slots];

  return groups.map((group) => {
    const existingIndex = available.findIndex(
      (slot) =>
        slot.teeTime === group.teeTime && slot.startingHole === group.startingHole,
    );
    const slot = existingIndex >= 0 ? available.splice(existingIndex, 1)[0] : available.shift();
    return {
      ...group,
      teeTime: slot?.teeTime ?? null,
      startingHole: slot?.startingHole ?? null,
    };
  });
}

export function playingGroupRemaining(group: Pick<PlayingGroup, 'memberIds'>): number {
  return Math.max(0, PLAYING_GROUP_CAPACITY - new Set(group.memberIds).size);
}

/** True when a player or complete scoring side fits in the target foursome. */
export function canMovePlayingUnit(
  groups: PlayingGroup[],
  memberIds: string[],
  targetGroupId: string,
): boolean {
  const target = groups.find((group) => group.id === targetGroupId);
  if (!target) return false;
  const uniqueMembers = [...new Set(memberIds)];
  const newSeats = uniqueMembers.filter((id) => !target.memberIds.includes(id)).length;
  return newSeats <= playingGroupRemaining(target);
}

/**
 * Moves one indivisible scheduling unit. Passing every member of a scoring team
 * guarantees that side is never split while two small sides may share a group.
 */
export function movePlayingUnit(
  groups: PlayingGroup[],
  memberIds: string[],
  targetGroupId: string,
): PlayingGroup[] | null {
  const uniqueMembers = [...new Set(memberIds)];
  if (
    uniqueMembers.length === 0 ||
    !canMovePlayingUnit(groups, uniqueMembers, targetGroupId)
  ) {
    return null;
  }
  return groups.map((group) => {
    const without = group.memberIds.filter((id) => !uniqueMembers.includes(id));
    return group.id === targetGroupId
      ? { ...group, memberIds: [...without, ...uniqueMembers] }
      : { ...group, memberIds: without };
  });
}

export function playOrder(startingHole: number | null | undefined): number[] {
  const start = Math.max(1, Math.min(18, startingHole ?? 1));
  return Array.from({ length: 18 }, (_, offset) => ((start - 1 + offset) % 18) + 1);
}

export function nextUnscoredHoleIndex(
  scores: readonly (number | null)[],
  startingHole: number | null | undefined,
): number {
  const order = playOrder(startingHole);
  const next = order.find((hole) => scores[hole - 1] === null);
  return (next ?? order[17]) - 1;
}

/** Sorts canonical time strings without relying on AM/PM lexical order. */
export function sortTimes(times: string[]): string[] {
  return [...new Set(times)].sort(
    (a, b) =>
      (parseScheduleTime(a) ?? Number.MAX_SAFE_INTEGER) -
      (parseScheduleTime(b) ?? Number.MAX_SAFE_INTEGER),
  );
}

export function canonicalTime(value: string): string | null {
  const minutes = parseScheduleTime(value);
  return minutes === null ? null : formatScheduleTime(minutes);
}
