-- Per-conversation notification preferences.
--
-- The preference belongs on the membership row: it is specific to one person
-- in one conversation, follows that account across devices, and can be applied
-- by the push fanout before any device endpoints are loaded.

alter table conversation_members
  add column notifications_enabled boolean not null default true;

comment on column conversation_members.notifications_enabled is
  'Whether this member receives push notifications for new messages in this conversation.';
