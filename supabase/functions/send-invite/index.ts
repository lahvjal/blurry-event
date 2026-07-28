/**
 * Emails invites via Resend.
 *
 * Called from the admin roster screen with a list of participant ids. Unlike
 * send-push (whose caller is Postgres), this one's caller is a signed-in admin,
 * so it keeps the default JWT verification and additionally proves the caller
 * really is an admin — via `invite_payloads`, which raises unless `is_admin()`.
 * Authorization lives in the database, not out here.
 *
 * Secrets (`supabase secrets set`):
 *   RESEND_API_KEY   from resend.com/api-keys
 *   INVITE_FROM      e.g. "Blurry Invitational <hello@blurryinvitational.com>"
 *   INVITE_REPLY_TO  a real inbox — the From domain needs no mailbox to send,
 *                    but replies have to land somewhere
 *   SITE_URL         e.g. https://blurryinvitational.com
 */

import { createClient } from 'npm:@supabase/supabase-js@2';

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY') ?? '';
const INVITE_FROM =
  Deno.env.get('INVITE_FROM') ?? 'Blurry Invitational <hello@blurryinvitational.com>';
const INVITE_REPLY_TO = Deno.env.get('INVITE_REPLY_TO') ?? '';
const SITE_URL = (Deno.env.get('SITE_URL') ?? 'https://blurryinvitational.com')
  .replace(/\/+$/, '');

/** Placeholder addresses for players with no real inbox on file. */
const SYNTHETIC_DOMAIN = '@invite.blurrygolf.app';

type Participant = {
  id: string;
  full_name: string;
  auth_email: string;
  invite_code: string;
};

const escapeHtml = (value: string) =>
  value.replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );

function renderHtml(p: Participant, event: { name: string; where: string; when: string }) {
  const link = `${SITE_URL}/invite?code=${encodeURIComponent(p.invite_code)}`;
  const name = escapeHtml(p.full_name.split(' ')[0] || 'there');

  // Table layout and inline styles throughout: email clients have no flexbox,
  // strip <style> blocks, and are generally a decade behind.
  return `<!doctype html>
<html>
<body style="margin:0;padding:0;background:#f4f5f4;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f5f4;padding:24px 12px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:12px;overflow:hidden;">

        <tr><td style="background:#1b2a22;padding:32px 28px;">
          <div style="color:#7bffb2;font-size:11px;letter-spacing:2px;font-weight:700;">YOU'RE IN</div>
          <div style="color:#ffffff;font-size:26px;font-weight:700;padding-top:8px;">${escapeHtml(event.name)}</div>
          <div style="color:rgba(255,255,255,0.65);font-size:14px;padding-top:6px;">${escapeHtml(event.where)}${event.when ? ` &middot; ${escapeHtml(event.when)}` : ''}</div>
        </td></tr>

        <tr><td style="padding:28px;">
          <p style="margin:0 0 20px;font-size:15px;line-height:1.55;color:#1b2a22;">
            ${name}, you're on the roster. Set up your login and you'll have your
            scorecard, the live leaderboard, and the group chat in one place.
          </p>

          <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 22px;">
            <tr><td style="background:#1b2a22;border-radius:8px;">
              <a href="${link}" style="display:inline-block;padding:15px 30px;color:#ffffff;font-size:15px;font-weight:700;text-decoration:none;">Set up your login</a>
            </td></tr>
          </table>

          <p style="margin:0 0 6px;font-size:11px;font-weight:700;letter-spacing:1px;color:#6b736e;">YOUR INVITE CODE</p>
          <p style="margin:0 0 24px;font-size:21px;font-weight:700;letter-spacing:2px;color:#1b2a22;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;">${escapeHtml(p.invite_code)}</p>

          <div style="border-top:1px solid #e4e7e5;padding-top:22px;">
            <p style="margin:0 0 10px;font-size:14px;font-weight:700;color:#1b2a22;">Add it to your home screen</p>
            <p style="margin:0 0 14px;font-size:14px;line-height:1.55;color:#4a534d;">
              Worth doing before the round. It's what lets the app keep working
              with no signal out on the course, and it's the only way notifications
              can reach you.
            </p>
            <p style="margin:0 0 8px;font-size:14px;line-height:1.55;color:#4a534d;">
              <strong style="color:#1b2a22;">iPhone:</strong> open the link in Safari, tap
              Share <span style="color:#6b736e;">(the square with the arrow)</span>, then
              <strong>Add to Home Screen</strong>. Open it from that icon from then on.
            </p>
            <p style="margin:0;font-size:14px;line-height:1.55;color:#4a534d;">
              <strong style="color:#1b2a22;">Android:</strong> open the link in Chrome, tap the
              three-dot menu, then <strong>Install app</strong>.
            </p>
          </div>
        </td></tr>

        <tr><td style="padding:0 28px 26px;">
          <p style="margin:0;font-size:12px;line-height:1.5;color:#8a918c;">
            If the button doesn't work, paste this into your browser:<br>
            <span style="color:#4a534d;word-break:break-all;">${escapeHtml(link)}</span>
          </p>
        </td></tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

function renderText(p: Participant, event: { name: string; where: string; when: string }) {
  const link = `${SITE_URL}/invite?code=${encodeURIComponent(p.invite_code)}`;
  return [
    `You're in for the ${event.name}.`,
    `${event.where}${event.when ? ` · ${event.when}` : ''}`,
    '',
    'Set up your login:',
    link,
    '',
    `Your invite code: ${p.invite_code}`,
    '',
    'ADD IT TO YOUR HOME SCREEN',
    "Worth doing before the round — it's what lets the app work with no signal",
    'on the course, and the only way notifications can reach you.',
    '',
    'iPhone: open the link in Safari, tap Share, then "Add to Home Screen".',
    'Android: open the link in Chrome, tap the three-dot menu, then "Install app".',
  ].join('\n');
}

Deno.serve(async (request) => {
  if (request.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }
  if (!RESEND_API_KEY) {
    return new Response('RESEND_API_KEY not configured', { status: 500 });
  }

  const authHeader = request.headers.get('Authorization') ?? '';
  if (!authHeader) return new Response('Unauthorized', { status: 401 });

  let participantIds: string[];
  try {
    const body = await request.json();
    participantIds = Array.isArray(body.participantIds) ? body.participantIds : [];
  } catch {
    return new Response('Bad request', { status: 400 });
  }
  if (participantIds.length === 0) {
    return Response.json({ sent: 0, skipped: 0, failed: 0, errors: [] });
  }

  // The caller's own token, so invite_payloads sees their identity and can
  // refuse a non-admin. Doing the lookup as service_role would hand any
  // signed-in player the whole roster's email addresses.
  const caller = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authHeader } }, auth: { persistSession: false } },
  );

  const { data: participants, error } = await caller.rpc('invite_payloads', {
    participant_ids: participantIds,
  });

  if (error) {
    // The function raises for non-admins, which is the expected refusal path.
    const forbidden = /admin/i.test(error.message);
    return new Response(forbidden ? 'Forbidden' : 'Lookup failed', {
      status: forbidden ? 403 : 500,
    });
  }

  const rows = (participants ?? []) as Participant[];

  const { data: event } = await caller
    .from('events')
    .select('name, course_name, city, state, event_date')
    .limit(1)
    .maybeSingle();

  const eventInfo = {
    name: event?.name ?? 'Blurry Invitational',
    where: [event?.course_name, [event?.city, event?.state].filter(Boolean).join(', ')]
      .filter(Boolean)
      .join(' · '),
    when: event?.event_date
      ? new Date(`${event.event_date}T12:00:00`).toLocaleDateString('en-US', {
          weekday: 'long',
          month: 'long',
          day: 'numeric',
        })
      : '',
  };

  const sentIds: string[] = [];
  const errors: string[] = [];
  let skipped = 0;

  for (const p of rows) {
    // A synthetic address is a placeholder, not an inbox. Sending to one would
    // bounce and, at volume, damage the domain's sending reputation.
    if (!p.auth_email || p.auth_email.toLowerCase().endsWith(SYNTHETIC_DOMAIN)) {
      skipped += 1;
      continue;
    }

    try {
      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${RESEND_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: INVITE_FROM,
          to: [p.auth_email],
          ...(INVITE_REPLY_TO ? { reply_to: INVITE_REPLY_TO } : {}),
          subject: `You're in — ${eventInfo.name}`,
          html: renderHtml(p, eventInfo),
          text: renderText(p, eventInfo),
        }),
      });

      if (!response.ok) {
        errors.push(`${p.full_name}: ${(await response.text()).slice(0, 140)}`);
        continue;
      }
      sentIds.push(p.id);
    } catch (caught) {
      errors.push(`${p.full_name}: ${String(caught).slice(0, 140)}`);
    }
  }

  // Stamped only for messages Resend accepted, so a failure stays visibly
  // un-invited and the next bulk run picks it up again.
  if (sentIds.length) {
    await caller.rpc('mark_invites_sent', { participant_ids: sentIds });
  }

  return Response.json({
    sent: sentIds.length,
    skipped,
    failed: errors.length,
    errors: errors.slice(0, 5),
  });
});
