-- ============================================================
-- Verification: what is actually applied to this database.
-- Paste into Supabase → SQL Editor → Run. Read-only, safe any time.
--
-- Failures sort to the top. Every row should read true.
-- ============================================================

with fn as (
  select p.proname
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
),
col as (
  select table_name, column_name
  from information_schema.columns
  where table_schema = 'public'
)
select * from (values

  ('0001  core tables present',
   (select count(*) from information_schema.tables
     where table_schema = 'public'
       and table_name in ('events','holes','participants','profiles','teams',
         'team_members','team_invites','rounds','scores','announcements',
         'conversations','conversation_members','messages')) = 13),

  ('0001  messages.client_id (offline send dedupe)',
   exists (select 1 from col where table_name='messages' and column_name='client_id')),

  ('0003  is_conversation_member helper (RLS recursion fix)',
   exists (select 1 from fn where proname='is_conversation_member')),

  ('0004  events.start_time / tee_times / course_map_url',
   (select count(*) from col
     where table_name='events'
       and column_name in ('start_time','tee_times','course_map_url')) = 3),

  ('0004  event-media storage bucket',
   exists (select 1 from storage.buckets where id='event-media')),

  ('0005  postal address columns',
   (select count(*) from col
     where table_name='events'
       and column_name in ('address_line','city','state','postal_code')) = 4),

  ('0005  legacy events.location dropped',
   not exists (select 1 from col where table_name='events' and column_name='location')),

  ('0006  participants.username',
   exists (select 1 from col where table_name='participants' and column_name='username')),

  ('0006  resolve_login + prepare_invite_signup',
   (select count(*) from fn
     where proname in ('resolve_login','prepare_invite_signup')) = 2),

  ('0007  messaging functions',
   (select count(*) from fn where proname in ('conversation_summaries',
     'find_direct_conversation','open_direct_conversation',
     'create_group_conversation','add_conversation_members',
     'leave_conversation')) = 6),

  ('0022  membership insert narrowed to event members',
   exists (select 1 from pg_policies where tablename='conversation_members'
     and policyname='members add unmanaged event memberships')),

  ('0007  old permissive membership policy removed',
   not exists (select 1 from pg_policies where tablename='conversation_members'
     and policyname='add conversation members')),

  ('0022  leaving an unmanaged event group allowed',
   exists (select 1 from pg_policies where tablename='conversation_members'
     and policyname='members leave unmanaged event conversations')),

  ('0008  chat functions locked to signed-in callers',
   not has_function_privilege('anon', 'public.conversation_summaries()', 'execute')),

  ('0009  guard on participant self-edits installed',
   exists (select 1 from pg_trigger
     where tgname='participants_guard_self_update' and not tgisinternal)),

  ('0010  apply_team_assignments present',
   exists (select 1 from fn where proname='apply_team_assignments')),

  ('0010  team arrangement locked to signed-in callers',
   not has_function_privilege('anon', 'public.apply_team_assignments(uuid, jsonb)', 'execute')),

  ('0017  message reactions table present',
   exists (select 1 from information_schema.tables
     where table_schema='public' and table_name='message_reactions')),

  ('0017  reactions in the realtime publication',
   exists (select 1 from pg_publication_tables
     where pubname='supabase_realtime' and tablename='message_reactions')),

  ('0018  message action columns present',
   exists (select 1 from information_schema.columns
     where table_schema='public' and table_name='messages'
       and column_name='reply_to_id')
   and exists (select 1 from information_schema.columns
     where table_schema='public' and table_name='messages'
       and column_name='edited_at')),

  ('0019  reaction notifications trigger present',
   exists (select 1 from pg_trigger
     where tgname='message_reactions_push' and not tgisinternal)),

  ('0019  reaction activity fields in conversation summaries',
   exists (
     select 1
     from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
     where n.nspname='public'
       and p.proname='conversation_summaries'
       and pg_get_function_result(p.oid) like '%last_activity_at%'
       and pg_get_function_result(p.oid) like '%last_reaction_emoji%'
       and pg_get_function_result(p.oid) like '%last_reactor_id%'
   )),

  ('0020  message media columns present',
   (select count(*) from col
     where table_name='messages'
       and column_name in ('media_url','media_mime_type','media_width','media_height')) = 4),

  ('0020  message-media storage bucket',
   exists (select 1 from storage.buckets where id='message-media')),

  ('0020  media fields in conversation summaries',
   exists (
     select 1
     from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
     where n.nspname='public'
       and p.proname='conversation_summaries'
       and pg_get_function_result(p.oid) like '%last_message_media_mime_type%'
       and pg_get_function_result(p.oid) like '%last_reaction_message_media_mime_type%'
   )),

  ('0021  official team conversations',
   exists (select 1 from col
     where table_name='conversations' and column_name='team_id')
   and exists (select 1 from fn where proname='open_team_conversation')),

  ('0021  team chat membership sync trigger',
   exists (select 1 from pg_trigger
     where tgname='team_conversation_membership' and not tgisinternal)),

  ('0022  event lifecycle + account access columns',
   exists (select 1 from col where table_name='events'
     and column_name='lifecycle_status')
   and exists (select 1 from col where table_name='profiles'
     and column_name='username')
   and exists (select 1 from col where table_name='profiles'
     and column_name='is_club_admin')),

  ('0022  realtime rows carry an event id',
   (select count(*) from col
     where table_name in ('scores','messages','message_reactions')
       and column_name='event_id') = 3),

  ('0022  account can register once per event',
   exists (
     select 1 from pg_indexes
     where schemaname='public' and tablename='participants'
       and indexname='participants_event_account_uniq'
   )),

  ('0022  event integrity guards installed',
   (select count(*) from pg_trigger
     where tgname in (
       'team_members_event_scope','team_invites_event_scope',
       'rounds_event_scope','scores_event_scope',
       'announcements_event_scope','conversations_event_scope',
       'conversation_members_event_scope','messages_event_scope',
       'message_reactions_event_scope'
     ) and not tgisinternal) = 9),

  ('0022  event ids are immutable in place',
   (select count(*) from pg_trigger
     where tgname in (
       'holes_event_id_immutable','participants_event_id_immutable',
       'teams_event_id_immutable','rounds_event_id_immutable',
       'scores_event_id_immutable','announcements_event_id_immutable',
       'conversations_event_id_immutable','messages_event_id_immutable',
       'message_reactions_event_id_immutable'
     ) and not tgisinternal) = 9),

  ('0022  profile privilege guard installed',
   exists (select 1 from pg_trigger
     where tgname='profiles_guard_privileges' and not tgisinternal)),

  ('0022  scoped RLS does not choose a current event implicitly',
   not exists (
     select 1 from pg_policies
     where schemaname='public'
       and tablename in (
         'events','holes','participants','teams','team_members','team_invites',
         'rounds','scores','announcements','conversations',
         'conversation_members','messages','message_reactions'
       )
       and (coalesce(qual, '') || coalesce(with_check, ''))
         like '%current_participant_id%'
   )),

  ('0023  accessible events + invite claim RPCs',
   exists (select 1 from fn where proname='accessible_events')
   and exists (select 1 from fn where proname='claim_event_invite')),

  ('0023  event-scoped chat RPCs',
   exists (
     select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
     where n.nspname='public' and p.proname='conversation_summaries'
       and pg_get_function_identity_arguments(p.oid)='p_event_id uuid'
   )
   and exists (
     select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
     where n.nspname='public' and p.proname='open_direct_conversation'
       and pg_get_function_identity_arguments(p.oid)
         like 'p_event_id uuid, other_participant uuid'
   )),

  ('0023  multi-event RPCs locked to signed-in callers',
   not has_function_privilege('anon', 'public.accessible_events()', 'execute')
   and not has_function_privilege(
     'anon', 'public.open_direct_conversation(uuid, uuid)', 'execute'
   )),

  ('offline scores carry idempotent revision metadata',
   exists (select 1 from col where table_name='scores'
     and column_name='client_version')
   and exists (select 1 from col where table_name='scores'
     and column_name='last_mutation_id')
   and exists (
     select 1 from pg_indexes
     where schemaname='public' and tablename='scores'
       and indexname='scores_last_mutation_id_uniq'
   )),

  ('offline score RPC is exact-event and authenticated only',
   exists (
     select 1
     from pg_proc p join pg_namespace n on n.oid=p.pronamespace
     where n.nspname='public' and p.proname='submit_offline_score'
       and pg_get_function_identity_arguments(p.oid) =
         'p_event_id uuid, p_team_id uuid, p_participant_id uuid, p_hole integer, p_strokes integer, p_entered_by uuid, p_client_updated_at timestamp with time zone, p_client_version bigint, p_mutation_id uuid'
   )
   and not has_function_privilege(
     'anon',
     'public.submit_offline_score(uuid,uuid,uuid,integer,integer,uuid,timestamptz,bigint,uuid)',
     'execute'
   )),

  ('club member directory is club-only and contact-free',
   exists (select 1 from fn where proname='club_member_directory')
   and not has_function_privilege(
     'anon', 'public.club_member_directory()', 'execute'
   )),

  ('RLS   enabled on every public table',
   not exists (select 1 from pg_tables
     where schemaname='public' and rowsecurity = false)),

  ('live  messages in the realtime publication',
   exists (select 1 from pg_publication_tables
     where pubname='supabase_realtime' and tablename='messages')),

  ('seed  the event row exists',
   exists (select 1 from events)),

  ('seed  roster populated',
   (select count(*) from participants) > 0),

  ('seed  all-hands conversation exists',
   exists (select 1 from conversations where kind='event_group')),

  -- The most common seeding casualty: a partly-populated event chat.
  ('seed  every participant is in the all-hands chat',
   (select count(*) from participants) = (
     select count(*) from conversation_members cm
     join conversations c on c.id = cm.conversation_id
     where c.kind = 'event_group'))

) as t(check_name, passed)
order by passed, check_name;

-- Contents, for a sanity read.
select
  (select count(*) from events)                                    as events,
  (select count(*) from participants)                              as participants,
  (select count(*) from participants where claimed_by is not null) as signed_up,
  (select count(*) from teams)                                     as teams,
  (select count(*) from conversations)                             as conversations,
  (select count(*) from messages)                                  as messages,
  (select count(*) from announcements)                             as announcements;
