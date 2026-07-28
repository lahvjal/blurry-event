import { Participant } from '@/state/types';

/**
 * Where invite links point. Falls back to the running origin on web so a
 * preview deploy links to itself rather than to production.
 *
 * This used to be the `blurryclub://` scheme from app.json, which is a native
 * deep link — it opens nothing in a browser, so every emailed, copied, shared
 * and CSV-exported invite link was dead on the web build.
 */
const SITE_URL =
  process.env.EXPO_PUBLIC_SITE_URL ||
  (typeof window !== 'undefined' && window.location?.origin) ||
  'https://blurryinvitational.com';

/** Random, unguessable — anonymous callers can probe the lookup endpoint. */
export function makeInviteCode(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no I/O/0/1
  let code = '';
  for (let i = 0; i < 8; i++) {
    code += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return `BI-${code}`;
}

const SYNTHETIC_DOMAIN = '@invite.blurrygolf.app';

/** Synthetic address for participants with no real email on file. */
export function syntheticEmail(code: string): string {
  return `${code.toLowerCase()}${SYNTHETIC_DOMAIN}`;
}

/** True when the address is a placeholder rather than a real inbox. */
export function isSyntheticEmail(email: string): boolean {
  return email.toLowerCase().endsWith(SYNTHETIC_DOMAIN);
}

export function inviteLink(code: string): string {
  return `${SITE_URL}/invite?code=${encodeURIComponent(code)}`;
}

/** Ready-to-send text the admin can paste into a message or email. */
export function inviteMessage(participant: Participant, eventName: string): string {
  return [
    `You're in for the ${eventName}.`,
    '',
    `Set up your login here:`,
    `  ${inviteLink(participant.inviteCode)}`,
    '',
    `Your invite code: ${participant.inviteCode}`,
    '',
    `Once you're in, add it to your home screen — on iPhone tap Share then`,
    `"Add to Home Screen". That's what lets it work without signal on the`,
    `course, and what turns on notifications.`,
  ].join('\n');
}

/** All invites as CSV, for mail-merging outside the app. */
export function invitesAsCsv(participants: Participant[]): string {
  const escape = (value: string) =>
    /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;

  const header = 'name,invite_code,invite_link,email,claimed';
  const lines = participants.map((p) =>
    [
      escape(p.fullName),
      p.inviteCode,
      inviteLink(p.inviteCode),
      escape(p.authEmail),
      p.claimed ? 'yes' : 'no',
    ].join(','),
  );
  return [header, ...lines].join('\n');
}
