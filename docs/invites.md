# Invites

Every player on the roster gets an unguessable code (`BI-XXXXXXXX`) generated
server-side when they're added. Redeeming it at `/invite?code=…` is how they set
a password and claim their spot.

Getting that code to them is the part this covers.

## Getting an invite to someone

Four routes, all from **Admin → Roster**, expanding a player's row:

| | What it does |
|---|---|
| Email invite | Sends the templated email via Resend. Only appears when there's a real address on file. |
| Copy invite | Puts the message on the clipboard, to paste wherever. |
| Share | The OS share sheet — good for a text message. |
| Export all invites | CSV of the whole roster, for mail-merging elsewhere. |

Bulk sending lives under **Bulk**: *Email N unsent invites* goes to everyone with
a real address who has never been sent one. It filters on `invite_sent_at`, so
running it twice doesn't spam the field, and the button reads
*Everyone invited* once there's nobody left.

Players added without an email get a synthetic `…@invite.blurrygolf.app`
address, which exists only so Supabase Auth has something unique to key on. It's
not an inbox. Those rows show *No email on file — invite by code* and are skipped
by every send, because mailing placeholder addresses would bounce and, at
volume, damage the domain's sending reputation.

## Links

`inviteLink()` builds `https://<site>/invite?code=…`, resolving the host from
`EXPO_PUBLIC_SITE_URL`, falling back to the running origin so a preview deploy
links to itself.

> This was `blurryclub://invite?code=…` until the web build — a native deep-link
> scheme left over from the app's earlier life, which opens nothing in a
> browser. Every copied, shared, exported and emailed link was dead.

## Setup

Once. Until `RESEND_API_KEY` is set, the email buttons return an error and the
other three routes carry on working.

### 1. Verify the domain in Resend

resend.com → Domains → Add `blurryinvitational.com`, then add the DNS records it
gives you at your registrar. Takes a few minutes to propagate.

**You do not need a mailbox at the domain to send from it.** Verification proves
you control the domain; that's all sending requires. What a mailbox would add is
somewhere for *replies* to land — which is what `INVITE_REPLY_TO` handles
instead, by pointing replies at an address you already read.

Skipping this and using Resend's `onboarding@resend.dev` works, but only
delivers to your own Resend account address. Fine for one test, useless for a
roster.

### 2. Function secrets

```bash
supabase secrets set \
  RESEND_API_KEY=re_xxxxxxxx \
  INVITE_FROM='Blurry Invitational <hello@blurryinvitational.com>' \
  INVITE_REPLY_TO=you@youremail.com \
  SITE_URL=https://blurryinvitational.com
```

### 3. Deploy and migrate

```bash
supabase functions deploy send-invite
```

Then run `supabase/migrations/0014_invite_emails.sql` in the SQL editor. It adds
`invite_sent_at` and the two admin-only functions the sender uses.

### 4. Client

Set `EXPO_PUBLIC_SITE_URL=https://blurryinvitational.com` in Vercel and redeploy,
so copied and exported links use the real domain rather than whatever origin the
admin happened to be on.

## What the email says

Event name, course and date; a **Set up your login** button; the code in plain
text underneath for anyone who'd rather type it; and Add to Home Screen
instructions for both iPhone and Android.

The home screen instructions are not decoration — installing is what makes the
app work without signal on the course, and it's a hard requirement for
notifications on iOS. See [push.md](push.md).

## Authorization

`send-invite` keeps JWT verification on (unlike `send-push`, whose caller is
Postgres) and proves the caller is an admin via `invite_payloads`, which raises
unless `is_admin()`. The lookup runs with the caller's own token rather than the
service role — doing otherwise would hand any signed-in player the whole
roster's email addresses.

`invite_sent_at` is stamped only for messages Resend accepted, so a failure
stays visibly un-invited and the next bulk run picks it up again.
