-- Production received the post-reset Invitational migrations outside the
-- Supabase migration ledger. Most are already present, but this column was
-- skipped. Make the compatibility step idempotent for both production and
-- fresh databases before the multi-event migrations run.

alter table conversation_members
  add column if not exists notifications_enabled boolean not null default true;

comment on column conversation_members.notifications_enabled is
  'Whether this member receives push notifications for new messages in this conversation.';
