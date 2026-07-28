import { Participant } from '@/state/types';

/** Matches app.json's `scheme`. */
const SCHEME = 'blurryclub';

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
  return `${SCHEME}://invite?code=${encodeURIComponent(code)}`;
}

/** Ready-to-send text the admin can paste into a message or email. */
export function inviteMessage(participant: Participant, eventName: string): string {
  return [
    `You're in for the ${eventName}.`,
    '',
    `Download the app, tap your invite link, and set up your login:`,
    `  ${participant.inviteCode}`,
    '',
    `Or tap: ${inviteLink(participant.inviteCode)}`,
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
