import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import React from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { EventDateTimePicker } from '@/components/event-date-time-picker';
import { OfflineNotice } from '@/components/offline-state';
import { PageHeader } from '@/components/page-header';
import { ParticipantAvatar } from '@/components/participant-avatar';
import { Noise, SectionLabel } from '@/components/ui';
import { colors, fonts } from '@/constants/theme';
import {
  apiClubMemberDirectory,
  apiCreateClubEvent,
  apiPostAnnouncement,
} from '@/lib/api';
import {
  announcementAuthorForEvent,
  canSubmitEventAnnouncement,
  clubMemberMatchesSearch,
} from '@/lib/club-admin';
import { useBrowserDefinitelyOffline } from '@/lib/offline/network';
import { eventPath } from '@/lib/routes';
import { useEvent } from '@/state/event';
import {
  AccessibleEvent,
  ClubMember,
  EVENT_LIFECYCLE_LABELS,
} from '@/state/types';

type ClubAdminSection = 'events' | 'members' | 'post';

const SECTIONS: { id: ClubAdminSection; label: string }[] = [
  { id: 'events', label: 'EVENTS' },
  { id: 'members', label: 'MEMBERS' },
  { id: 'post', label: 'POST TO EVENT' },
];

function localIsoDate(date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function dateFromIso(value: string): Date {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(year, month - 1, day, 12);
}

function prettyDate(value: string): string {
  return dateFromIso(value).toLocaleDateString(undefined, {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
}

function initialsOf(value: string): string {
  return value
    .trim()
    .split(/\s+/)
    .map((part) => part[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
}

function errorMessage(caught: unknown, fallback: string): string {
  return (caught as { message?: string })?.message ?? fallback;
}

export default function AdminEvents() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { accountAccess, accessLoading, refresh } = useEvent();
  const offline = useBrowserDefinitelyOffline();
  const [section, setSection] = React.useState<ClubAdminSection>('events');

  const [formOpen, setFormOpen] = React.useState(false);
  const [name, setName] = React.useState('');
  const [courseName, setCourseName] = React.useState('');
  const [eventDate, setEventDate] = React.useState(localIsoDate());
  const [datePickerOpen, setDatePickerOpen] = React.useState(false);
  const [creating, setCreating] = React.useState(false);
  const [createError, setCreateError] = React.useState<string | null>(null);

  const [members, setMembers] = React.useState<ClubMember[] | null>(null);
  const [membersLoading, setMembersLoading] = React.useState(false);
  const [membersError, setMembersError] = React.useState<string | null>(null);
  const [memberQuery, setMemberQuery] = React.useState('');

  const [selectedEventId, setSelectedEventId] = React.useState('');
  const [eventPickerOpen, setEventPickerOpen] = React.useState(false);
  const [announcementBody, setAnnouncementBody] = React.useState('');
  const [confirmingPost, setConfirmingPost] = React.useState(false);
  const [posting, setPosting] = React.useState(false);
  const [postError, setPostError] = React.useState<string | null>(null);
  const [postSuccess, setPostSuccess] = React.useState<string | null>(null);

  const isClubAdmin = accountAccess?.profile?.isClubAdmin === true;
  const events = React.useMemo(
    () =>
      [...(accountAccess?.events ?? [])].sort((a, b) =>
        b.eventDate.localeCompare(a.eventDate),
      ),
    [accountAccess?.events],
  );
  const selectedEvent = events.find((event) => event.id === selectedEventId) ?? null;

  const loadMembers = React.useCallback(async () => {
    if (!isClubAdmin || offline || membersLoading) return;
    setMembersLoading(true);
    setMembersError(null);
    try {
      setMembers(await apiClubMemberDirectory());
    } catch (caught) {
      setMembersError(
        errorMessage(
          caught,
          'The club member directory could not be loaded. Check your connection and try again.',
        ),
      );
    } finally {
      setMembersLoading(false);
    }
  }, [isClubAdmin, membersLoading, offline]);

  React.useEffect(() => {
    if (
      section === 'members' &&
      members === null &&
      !membersLoading &&
      !membersError &&
      !offline
    ) {
      void loadMembers();
    }
  }, [loadMembers, members, membersError, membersLoading, offline, section]);

  if (accessLoading) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color={colors.highlight} />
      </View>
    );
  }

  if (!isClubAdmin) {
    return (
      <View style={styles.root}>
        <LinearGradient colors={['#203329', '#1b2a22']} style={StyleSheet.absoluteFill} />
        <Noise />
        <PageHeader title="club admin" showMore={false} />
        <View style={[styles.deniedWrap, { paddingTop: insets.top + 120 }]}>
          <Text style={styles.denied}>
            Club admin access is required to manage club events and members.
          </Text>
        </View>
      </View>
    );
  }

  const createEvent = async () => {
    if (creating || offline) return;
    setCreateError(null);
    if (!name.trim() || !courseName.trim()) {
      setCreateError('Add an event name and course before creating the Draft.');
      return;
    }

    setCreating(true);
    try {
      const eventId = await apiCreateClubEvent({
        name: name.trim(),
        courseName: courseName.trim(),
        eventDate,
      });
      await refresh();
      setName('');
      setCourseName('');
      setEventDate(localIsoDate());
      setFormOpen(false);
      router.push(eventPath(eventId, 'admin') as never);
    } catch (caught) {
      setCreateError(
        errorMessage(
          caught,
          'The event could not be created. Check your connection and try again.',
        ),
      );
    } finally {
      setCreating(false);
    }
  };

  const submitAnnouncement = async () => {
    if (
      !selectedEvent ||
      !canSubmitEventAnnouncement({
        body: announcementBody,
        eventId: selectedEventId,
        offline,
        posting,
      })
    ) {
      return;
    }

    setPosting(true);
    setPostError(null);
    setPostSuccess(null);
    try {
      await apiPostAnnouncement(
        selectedEvent.id,
        announcementBody.trim(),
        announcementAuthorForEvent(selectedEvent),
      );
      setAnnouncementBody('');
      setConfirmingPost(false);
      setPostSuccess(`Posted to ${selectedEvent.name}.`);
    } catch (caught) {
      setPostError(
        errorMessage(
          caught,
          'The announcement could not be posted. Check your connection and try again.',
        ),
      );
    } finally {
      setPosting(false);
    }
  };

  const filteredMembers = (members ?? []).filter((member) =>
    clubMemberMatchesSearch(member, memberQuery),
  );

  return (
    <View style={styles.root}>
      <LinearGradient colors={['#203329', '#1b2a22']} style={StyleSheet.absoluteFill} />
      <Noise />
      <PageHeader title="club admin" subtitle="CLUB-WIDE" showMore={false} />
      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingTop: insets.top + 86, paddingBottom: insets.bottom + 60 },
        ]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}>
        {offline ? (
          <OfflineNotice
            compact
            message="Saved event information remains available. Creating events, loading the member directory, and posting announcements require a connection."
          />
        ) : null}

        <View style={styles.intro}>
          <Text style={styles.title}>Run the club</Text>
          <Text style={styles.subtitle}>
            Choose an event before editing event details. Club members and cross-event
            posting stay here at the club level.
          </Text>
        </View>

        <View accessibilityRole="tablist" style={styles.tabs}>
          {SECTIONS.map((item) => {
            const active = item.id === section;
            return (
              <Pressable
                key={item.id}
                accessibilityRole="tab"
                accessibilityState={{ selected: active }}
                style={[styles.tab, active && styles.tabActive]}
                onPress={() => setSection(item.id)}>
                <Text style={[styles.tabText, active && styles.tabTextActive]}>
                  {item.label}
                </Text>
              </Pressable>
            );
          })}
        </View>

        {section === 'events' ? (
          <EventsSection
            courseName={courseName}
            createError={createError}
            creating={creating}
            datePickerOpen={datePickerOpen}
            eventDate={eventDate}
            events={events}
            formOpen={formOpen}
            name={name}
            offline={offline}
            onChangeCourseName={setCourseName}
            onChangeEventDate={setEventDate}
            onChangeName={setName}
            onCreate={() => void createEvent()}
            onManage={(event) => router.push(eventPath(event.id, 'admin') as never)}
            onToggleDatePicker={() => setDatePickerOpen((current) => !current)}
            onToggleForm={() => {
              setCreateError(null);
              setFormOpen((current) => !current);
            }}
          />
        ) : null}

        {section === 'members' ? (
          <MembersSection
            filteredMembers={filteredMembers}
            members={members}
            loading={membersLoading}
            error={membersError}
            offline={offline}
            query={memberQuery}
            onChangeQuery={setMemberQuery}
            onRetry={() => void loadMembers()}
          />
        ) : null}

        {section === 'post' ? (
          <PostSection
            body={announcementBody}
            confirming={confirmingPost}
            error={postError}
            eventPickerOpen={eventPickerOpen}
            events={events}
            offline={offline}
            posting={posting}
            selectedEvent={selectedEvent}
            success={postSuccess}
            onCancelConfirmation={() => setConfirmingPost(false)}
            onChangeBody={(value) => {
              setAnnouncementBody(value);
              setConfirmingPost(false);
              setPostError(null);
              setPostSuccess(null);
            }}
            onConfirm={() => void submitAnnouncement()}
            onReview={() => {
              setPostError(null);
              setPostSuccess(null);
              setConfirmingPost(true);
            }}
            onSelectEvent={(eventId) => {
              setSelectedEventId(eventId);
              setEventPickerOpen(false);
              setConfirmingPost(false);
              setPostError(null);
              setPostSuccess(null);
            }}
            onToggleEventPicker={() => setEventPickerOpen((current) => !current)}
          />
        ) : null}
      </ScrollView>
    </View>
  );
}

function EventsSection({
  courseName,
  createError,
  creating,
  datePickerOpen,
  eventDate,
  events,
  formOpen,
  name,
  offline,
  onChangeCourseName,
  onChangeEventDate,
  onChangeName,
  onCreate,
  onManage,
  onToggleDatePicker,
  onToggleForm,
}: {
  courseName: string;
  createError: string | null;
  creating: boolean;
  datePickerOpen: boolean;
  eventDate: string;
  events: AccessibleEvent[];
  formOpen: boolean;
  name: string;
  offline: boolean;
  onChangeCourseName: (value: string) => void;
  onChangeEventDate: (value: string) => void;
  onChangeName: (value: string) => void;
  onCreate: () => void;
  onManage: (event: AccessibleEvent) => void;
  onToggleDatePicker: () => void;
  onToggleForm: () => void;
}) {
  return (
    <View style={styles.section}>
      <View style={styles.sectionIntro}>
        <Text style={styles.sectionTitle}>Club Events</Text>
        <Text style={styles.sectionBody}>
          Create private Drafts, or choose an event to open its Event Admin workspace.
        </Text>
      </View>

      <Pressable
        accessibilityRole="button"
        accessibilityState={{ disabled: offline, expanded: formOpen }}
        accessibilityHint={offline ? 'Creating an event requires a connection.' : undefined}
        disabled={offline}
        style={[styles.createToggle, offline && styles.disabledControl]}
        onPress={onToggleForm}>
        <Text style={styles.createToggleText}>
          {formOpen ? 'CANCEL NEW EVENT' : '+ CREATE EVENT'}
        </Text>
      </Pressable>

      {formOpen ? (
        <View style={styles.form}>
          <SectionLabel color={colors.link} size={10}>
            new draft event
          </SectionLabel>
          <Text style={styles.fieldLabel}>EVENT NAME</Text>
          <TextInput
            accessibilityLabel="Event name"
            value={name}
            onChangeText={onChangeName}
            style={styles.input}
            placeholder="Blurry Fall Classic"
            placeholderTextColor="rgba(255,255,255,0.3)"
            selectionColor={colors.highlight}
          />
          <Text style={styles.fieldLabel}>COURSE</Text>
          <TextInput
            accessibilityLabel="Course name"
            value={courseName}
            onChangeText={onChangeCourseName}
            style={styles.input}
            placeholder="Course name"
            placeholderTextColor="rgba(255,255,255,0.3)"
            selectionColor={colors.highlight}
          />
          <Text style={styles.fieldLabel}>EVENT DATE</Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Event date, ${prettyDate(eventDate)}`}
            accessibilityState={{ expanded: datePickerOpen }}
            style={styles.dateRow}
            onPress={onToggleDatePicker}>
            <Text style={styles.dateLabel}>{prettyDate(eventDate)}</Text>
            <Text style={styles.dateAction}>CHANGE</Text>
          </Pressable>
          {datePickerOpen ? (
            <View style={styles.datePicker}>
              <EventDateTimePicker
                value={dateFromIso(eventDate)}
                mode="date"
                onChange={(selected) => {
                  if (!selected) return;
                  onChangeEventDate(localIsoDate(selected));
                  onToggleDatePicker();
                }}
              />
            </View>
          ) : null}
          <Text style={styles.formHint}>
            The Draft starts with 18 editable placeholder holes and an event
            conversation. Only club admins can see it until people are added.
          </Text>
          {createError ? (
            <Text accessibilityRole="alert" style={styles.error}>
              {createError}
            </Text>
          ) : null}
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ disabled: creating }}
            disabled={creating}
            style={[styles.primaryButton, creating && styles.disabledControl]}
            onPress={onCreate}>
            <Text style={styles.primaryButtonText}>
              {creating ? 'CREATING…' : 'CREATE DRAFT EVENT'}
            </Text>
          </Pressable>
        </View>
      ) : null}

      <View style={styles.listHeader}>
        <SectionLabel color={colors.link} size={10}>
          all events
        </SectionLabel>
        <Text style={styles.count}>{events.length}</Text>
      </View>

      <View style={styles.list}>
        {events.map((event) => (
          <Pressable
            key={event.id}
            accessibilityRole="button"
            accessibilityLabel={`Manage ${event.name}, ${event.courseName}, ${prettyDate(event.eventDate)}, ${EVENT_LIFECYCLE_LABELS[event.lifecycleStatus]}`}
            accessibilityHint="Opens this event's Event Admin workspace."
            style={({ pressed }) => [styles.eventRow, pressed && styles.rowPressed]}
            onPress={() => onManage(event)}>
            <View style={styles.eventCopy}>
              <Text numberOfLines={1} style={styles.eventName}>
                {event.name}
              </Text>
              <Text numberOfLines={1} style={styles.eventMeta}>
                {event.courseName} · {prettyDate(event.eventDate)}
              </Text>
              <Text style={styles.lifecycle}>
                {EVENT_LIFECYCLE_LABELS[event.lifecycleStatus]}
              </Text>
            </View>
            <View style={styles.manageAction}>
              <Text style={styles.manageText}>MANAGE</Text>
              <Text style={styles.arrow}>›</Text>
            </View>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

function MembersSection({
  error,
  filteredMembers,
  loading,
  members,
  offline,
  onChangeQuery,
  onRetry,
  query,
}: {
  error: string | null;
  filteredMembers: ClubMember[];
  loading: boolean;
  members: ClubMember[] | null;
  offline: boolean;
  onChangeQuery: (value: string) => void;
  onRetry: () => void;
  query: string;
}) {
  return (
    <View style={styles.section}>
      <View style={styles.sectionIntro}>
        <Text style={styles.sectionTitle}>Club Members</Text>
        <Text style={styles.sectionBody}>
          App users and invited people are combined across events. Contact details are
          not shown.
        </Text>
      </View>

      <TextInput
        accessibilityLabel="Search club members"
        value={query}
        onChangeText={onChangeQuery}
        style={styles.searchInput}
        placeholder="Search name, username, event, or course"
        placeholderTextColor="rgba(255,255,255,0.3)"
        selectionColor={colors.highlight}
        returnKeyType="search"
      />

      {loading ? (
        <View accessibilityRole="progressbar" style={styles.centerState}>
          <ActivityIndicator color={colors.highlight} />
          <Text style={styles.stateText}>Loading club members…</Text>
        </View>
      ) : null}

      {!loading && offline && members === null ? (
        <View style={styles.centerState}>
          <Text style={styles.stateTitle}>Reconnect to load members</Text>
          <Text style={styles.stateText}>
            The secure club-wide directory is not stored for offline use.
          </Text>
        </View>
      ) : null}

      {!loading && error ? (
        <View accessibilityRole="alert" style={styles.centerState}>
          <Text style={styles.stateTitle}>Members unavailable</Text>
          <Text style={styles.stateText}>{error}</Text>
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ disabled: offline }}
            disabled={offline}
            style={[styles.retryButton, offline && styles.disabledControl]}
            onPress={onRetry}>
            <Text style={styles.retryText}>TRY AGAIN</Text>
          </Pressable>
        </View>
      ) : null}

      {!loading && !error && members !== null ? (
        <>
          <View style={styles.listHeader}>
            <SectionLabel color={colors.link} size={10}>
              people
            </SectionLabel>
            <Text style={styles.count}>
              {filteredMembers.length === members.length
                ? members.length
                : `${filteredMembers.length} OF ${members.length}`}
            </Text>
          </View>
          {filteredMembers.length === 0 ? (
            <View style={styles.centerState}>
              <Text style={styles.stateTitle}>No matches</Text>
              <Text style={styles.stateText}>Try a different name, event, or course.</Text>
            </View>
          ) : (
            <View style={styles.memberList}>
              {filteredMembers.map((member) => (
                <MemberCard key={member.personKey} member={member} />
              ))}
            </View>
          )}
        </>
      ) : null}
    </View>
  );
}

function MemberCard({ member }: { member: ClubMember }) {
  const avatarParticipant = {
    id: member.personKey,
    fullName: member.displayName,
    initials: initialsOf(member.displayName),
    avatarUrl: member.avatarUrl,
  };

  return (
    <View
      accessible
      accessibilityLabel={`${member.displayName}, ${member.status === 'app_user' ? 'app user' : 'invited and unclaimed'}, attending ${member.eventCount} event${member.eventCount === 1 ? '' : 's'}`}
      style={styles.memberCard}>
      <View style={styles.memberHeader}>
        <ParticipantAvatar participant={avatarParticipant} size={44} />
        <View style={styles.memberIdentity}>
          <Text style={styles.memberName}>{member.displayName}</Text>
          {member.username ? <Text style={styles.username}>@{member.username}</Text> : null}
        </View>
        <View style={styles.memberBadges}>
          {member.isClubAdmin ? <Text style={styles.clubAdminBadge}>CLUB ADMIN</Text> : null}
          <Text
            style={[
              styles.memberStatus,
              member.status === 'invited' && styles.memberStatusInvited,
            ]}>
            {member.status === 'app_user' ? 'APP USER' : 'INVITED · UNCLAIMED'}
          </Text>
        </View>
      </View>

      {member.nameConflict ? (
        <Text style={styles.identityNote}>
          Registration names differ across events; account identity is used here.
        </Text>
      ) : null}

      {member.attendances.length === 0 ? (
        <Text style={styles.noAttendance}>No event registrations</Text>
      ) : (
        <View style={styles.attendanceList}>
          {member.attendances.map((attendance) => (
            <View key={attendance.participantId} style={styles.attendanceRow}>
              <View style={styles.attendanceCopy}>
                <Text numberOfLines={1} style={styles.attendanceName}>
                  {attendance.eventName}
                </Text>
                <Text numberOfLines={1} style={styles.attendanceMeta}>
                  {prettyDate(attendance.eventDate)} · {attendance.courseName}
                </Text>
              </View>
              <View style={styles.attendanceStatus}>
                <Text style={styles.lifecycle}>
                  {EVENT_LIFECYCLE_LABELS[attendance.lifecycleStatus]}
                </Text>
                <Text style={styles.inviteStatus}>
                  {attendance.claimed
                    ? attendance.isEventAdmin
                      ? 'EVENT ADMIN'
                      : 'REGISTERED'
                    : attendance.inviteSentAt
                      ? 'INVITE SENT'
                      : 'INVITE NOT SENT'}
                </Text>
              </View>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

function PostSection({
  body,
  confirming,
  error,
  eventPickerOpen,
  events,
  offline,
  onCancelConfirmation,
  onChangeBody,
  onConfirm,
  onReview,
  onSelectEvent,
  onToggleEventPicker,
  posting,
  selectedEvent,
  success,
}: {
  body: string;
  confirming: boolean;
  error: string | null;
  eventPickerOpen: boolean;
  events: AccessibleEvent[];
  offline: boolean;
  onCancelConfirmation: () => void;
  onChangeBody: (value: string) => void;
  onConfirm: () => void;
  onReview: () => void;
  onSelectEvent: (eventId: string) => void;
  onToggleEventPicker: () => void;
  posting: boolean;
  selectedEvent: AccessibleEvent | null;
  success: string | null;
}) {
  const ready = canSubmitEventAnnouncement({
    body,
    eventId: selectedEvent?.id ?? '',
    offline,
    posting,
  });

  return (
    <View style={styles.section}>
      <View style={styles.sectionIntro}>
        <Text style={styles.sectionTitle}>Post to Event</Text>
        <Text style={styles.sectionBody}>
          Choose one destination. This posts to that event’s existing announcement feed
          and notification audience—there is no club-wide feed.
        </Text>
      </View>

      <Text style={styles.fieldLabel}>DESTINATION EVENT · REQUIRED</Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={
          selectedEvent ? `Destination event, ${selectedEvent.name}` : 'Choose destination event'
        }
        accessibilityState={{ expanded: eventPickerOpen }}
        style={styles.eventPickerButton}
        onPress={onToggleEventPicker}>
        <View style={styles.eventPickerCopy}>
          <Text style={selectedEvent ? styles.eventPickerValue : styles.eventPickerPlaceholder}>
            {selectedEvent?.name ?? 'Choose an event'}
          </Text>
          {selectedEvent ? (
            <Text style={styles.eventPickerMeta}>
              {EVENT_LIFECYCLE_LABELS[selectedEvent.lifecycleStatus]} ·{' '}
              {prettyDate(selectedEvent.eventDate)} · {selectedEvent.courseName}
            </Text>
          ) : null}
        </View>
        <Text style={styles.pickerArrow}>{eventPickerOpen ? '⌃' : '⌄'}</Text>
      </Pressable>

      {eventPickerOpen ? (
        <View style={styles.eventPickerList}>
          {events.map((event) => (
            <Pressable
              key={event.id}
              accessibilityRole="button"
              accessibilityLabel={`Post to ${event.name}, ${EVENT_LIFECYCLE_LABELS[event.lifecycleStatus]}`}
              style={({ pressed }) => [
                styles.eventPickerOption,
                event.id === selectedEvent?.id && styles.eventPickerOptionSelected,
                pressed && styles.rowPressed,
              ]}
              onPress={() => onSelectEvent(event.id)}>
              <View style={styles.eventCopy}>
                <Text style={styles.eventName}>{event.name}</Text>
                <Text style={styles.eventMeta}>
                  {prettyDate(event.eventDate)} · {event.courseName}
                </Text>
              </View>
              <Text style={styles.lifecycle}>
                {EVENT_LIFECYCLE_LABELS[event.lifecycleStatus]}
              </Text>
            </Pressable>
          ))}
        </View>
      ) : null}

      <Text style={styles.fieldLabel}>ANNOUNCEMENT</Text>
      <TextInput
        accessibilityLabel="Announcement text"
        value={body}
        onChangeText={onChangeBody}
        editable={!posting && !offline}
        style={[styles.composer, offline && styles.disabledControl]}
        placeholder="Message to this event’s participants…"
        placeholderTextColor="rgba(255,255,255,0.35)"
        multiline
        maxLength={2000}
        selectionColor={colors.highlight}
      />
      <Text style={styles.characterCount}>{body.length} / 2000</Text>

      {error ? (
        <Text accessibilityRole="alert" style={styles.error}>
          {error}
        </Text>
      ) : null}
      {success ? (
        <Text accessibilityRole="alert" accessibilityLiveRegion="polite" style={styles.success}>
          {success}
        </Text>
      ) : null}

      {confirming && selectedEvent ? (
        <View style={styles.confirmation}>
          <Text style={styles.confirmationTitle}>POST TO {selectedEvent.name.toUpperCase()}?</Text>
          <Text style={styles.confirmationBody}>
            This will appear in {selectedEvent.name} and notify its registered app users
            according to their notification settings.
          </Text>
          <View style={styles.confirmationActions}>
            <Pressable
              accessibilityRole="button"
              disabled={posting}
              style={styles.cancelButton}
              onPress={onCancelConfirmation}>
              <Text style={styles.cancelButtonText}>CANCEL</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ disabled: !ready }}
              disabled={!ready}
              style={[styles.primaryButton, styles.confirmButton, !ready && styles.disabledControl]}
              onPress={onConfirm}>
              <Text style={styles.primaryButtonText}>
                {posting ? 'POSTING…' : 'POST ANNOUNCEMENT'}
              </Text>
            </Pressable>
          </View>
        </View>
      ) : (
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ disabled: !ready }}
          accessibilityHint={
            offline
              ? 'Posting requires a connection.'
              : !selectedEvent
                ? 'Choose a destination event first.'
                : undefined
          }
          disabled={!ready}
          style={[styles.primaryButton, !ready && styles.disabledControl]}
          onPress={onReview}>
          <Text style={styles.primaryButtonText}>REVIEW ANNOUNCEMENT</Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#1b2a22' },
  loading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.bg,
  },
  deniedWrap: { paddingHorizontal: 24 },
  denied: { fontFamily: fonts.regular, fontSize: 14, color: colors.textMuted },
  content: { paddingHorizontal: 20, gap: 18 },
  intro: { gap: 9, marginBottom: 4 },
  title: { fontFamily: fonts.serif, fontSize: 38, color: '#ffffff' },
  subtitle: {
    maxWidth: 560,
    fontFamily: fonts.regular,
    fontSize: 13,
    lineHeight: 19,
    color: colors.textMuted,
  },
  tabs: {
    flexDirection: 'row',
    borderWidth: 1,
    borderColor: '#2d3832',
    backgroundColor: 'rgba(15,17,16,0.42)',
  },
  tab: {
    flex: 1,
    minHeight: 48,
    paddingHorizontal: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabActive: { backgroundColor: 'rgba(123,255,178,0.12)' },
  tabText: {
    textAlign: 'center',
    fontFamily: fonts.bold,
    fontSize: 9,
    letterSpacing: 0.4,
    color: 'rgba(255,255,255,0.42)',
  },
  tabTextActive: { color: colors.highlight },
  section: { gap: 16 },
  sectionIntro: { gap: 7 },
  sectionTitle: { fontFamily: fonts.serif, fontSize: 30, color: '#ffffff' },
  sectionBody: {
    maxWidth: 560,
    fontFamily: fonts.regular,
    fontSize: 12,
    lineHeight: 18,
    color: colors.textMuted,
  },
  createToggle: {
    minHeight: 56,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(123,255,178,0.38)',
    backgroundColor: 'rgba(123,255,178,0.1)',
  },
  createToggleText: {
    fontFamily: fonts.bold,
    fontSize: 11,
    letterSpacing: 0.7,
    color: colors.highlight,
  },
  form: {
    padding: 17,
    gap: 10,
    borderWidth: 1,
    borderColor: '#2d3832',
    backgroundColor: 'rgba(15,17,16,0.55)',
  },
  fieldLabel: {
    marginTop: 4,
    fontFamily: fonts.bold,
    fontSize: 9,
    letterSpacing: 0.5,
    color: 'rgba(255,255,255,0.48)',
  },
  input: {
    minHeight: 48,
    paddingHorizontal: 14,
    backgroundColor: 'rgba(0,0,0,0.3)',
    fontFamily: fonts.regular,
    fontSize: 15,
    color: '#ffffff',
  },
  dateRow: {
    minHeight: 48,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: 'rgba(0,0,0,0.3)',
  },
  dateLabel: { fontFamily: fonts.bold, fontSize: 13, color: '#ffffff' },
  dateAction: { fontFamily: fonts.bold, fontSize: 9, color: colors.highlight },
  datePicker: { backgroundColor: 'rgba(0,0,0,0.3)' },
  formHint: {
    fontFamily: fonts.regular,
    fontSize: 11,
    lineHeight: 16,
    color: 'rgba(255,255,255,0.42)',
  },
  error: { fontFamily: fonts.bold, fontSize: 11, lineHeight: 16, color: '#ff9c93' },
  success: {
    fontFamily: fonts.bold,
    fontSize: 11,
    lineHeight: 16,
    color: colors.highlight,
  },
  primaryButton: {
    minHeight: 54,
    marginTop: 4,
    paddingHorizontal: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#203329',
  },
  primaryButtonText: {
    textAlign: 'center',
    fontFamily: fonts.bold,
    fontSize: 11,
    color: '#ffffff',
  },
  disabledControl: { opacity: 0.42 },
  listHeader: {
    marginTop: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  count: { fontFamily: fonts.bold, fontSize: 11, color: colors.textMuted },
  list: { borderTopWidth: 1, borderTopColor: '#2d3832' },
  eventRow: {
    minHeight: 88,
    paddingVertical: 14,
    paddingHorizontal: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#2d3832',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: 'rgba(15,17,16,0.36)',
  },
  rowPressed: { backgroundColor: 'rgba(123,255,178,0.08)' },
  eventCopy: { flex: 1, gap: 6 },
  eventName: { fontFamily: fonts.bold, fontSize: 14, color: '#ffffff' },
  eventMeta: { fontFamily: fonts.regular, fontSize: 10, color: colors.textMuted },
  lifecycle: {
    fontFamily: fonts.bold,
    fontSize: 8,
    letterSpacing: 0.7,
    color: colors.link,
  },
  manageAction: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  manageText: {
    fontFamily: fonts.bold,
    fontSize: 9,
    letterSpacing: 0.6,
    color: colors.highlight,
  },
  arrow: { fontSize: 20, lineHeight: 20, color: 'rgba(255,255,255,0.5)' },
  searchInput: {
    minHeight: 50,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: '#2d3832',
    backgroundColor: 'rgba(0,0,0,0.25)',
    fontFamily: fonts.regular,
    fontSize: 14,
    color: '#ffffff',
  },
  centerState: {
    minHeight: 150,
    padding: 24,
    gap: 9,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#2d3832',
    backgroundColor: 'rgba(15,17,16,0.36)',
  },
  stateTitle: { fontFamily: fonts.bold, fontSize: 14, color: '#ffffff' },
  stateText: {
    maxWidth: 420,
    textAlign: 'center',
    fontFamily: fonts.regular,
    fontSize: 12,
    lineHeight: 18,
    color: colors.textMuted,
  },
  retryButton: {
    minHeight: 44,
    minWidth: 130,
    marginTop: 4,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(123,255,178,0.35)',
  },
  retryText: { fontFamily: fonts.bold, fontSize: 10, color: colors.highlight },
  memberList: { gap: 12 },
  memberCard: {
    padding: 15,
    gap: 13,
    borderWidth: 1,
    borderColor: '#2d3832',
    backgroundColor: 'rgba(15,17,16,0.45)',
  },
  memberHeader: { flexDirection: 'row', alignItems: 'center', gap: 11 },
  memberIdentity: { flex: 1, gap: 4 },
  memberName: { fontFamily: fonts.bold, fontSize: 14, color: '#ffffff' },
  username: { fontFamily: fonts.regular, fontSize: 10, color: colors.textMuted },
  memberBadges: { alignItems: 'flex-end', gap: 5 },
  clubAdminBadge: {
    fontFamily: fonts.bold,
    fontSize: 7,
    letterSpacing: 0.6,
    color: colors.highlight,
  },
  memberStatus: {
    paddingHorizontal: 7,
    paddingVertical: 4,
    backgroundColor: 'rgba(123,255,178,0.1)',
    fontFamily: fonts.bold,
    fontSize: 7,
    letterSpacing: 0.4,
    color: colors.highlight,
  },
  memberStatusInvited: {
    backgroundColor: 'rgba(255,207,139,0.08)',
    color: '#ffcf8b',
  },
  identityNote: {
    fontFamily: fonts.regular,
    fontSize: 10,
    lineHeight: 15,
    color: '#ffcf8b',
  },
  noAttendance: {
    paddingTop: 4,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.06)',
    fontFamily: fonts.regular,
    fontSize: 11,
    color: colors.textMuted,
  },
  attendanceList: { gap: 1, backgroundColor: 'rgba(255,255,255,0.06)' },
  attendanceRow: {
    minHeight: 58,
    paddingVertical: 10,
    paddingHorizontal: 11,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#17201b',
  },
  attendanceCopy: { flex: 1, gap: 5 },
  attendanceName: { fontFamily: fonts.bold, fontSize: 11, color: '#ffffff' },
  attendanceMeta: { fontFamily: fonts.regular, fontSize: 9, color: colors.textMuted },
  attendanceStatus: { alignItems: 'flex-end', gap: 5 },
  inviteStatus: {
    fontFamily: fonts.bold,
    fontSize: 7,
    letterSpacing: 0.35,
    color: 'rgba(255,255,255,0.48)',
  },
  eventPickerButton: {
    minHeight: 66,
    paddingHorizontal: 14,
    paddingVertical: 11,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderWidth: 1,
    borderColor: 'rgba(123,255,178,0.25)',
    backgroundColor: 'rgba(0,0,0,0.26)',
  },
  eventPickerCopy: { flex: 1, gap: 6 },
  eventPickerValue: { fontFamily: fonts.bold, fontSize: 14, color: '#ffffff' },
  eventPickerPlaceholder: {
    fontFamily: fonts.regular,
    fontSize: 14,
    color: 'rgba(255,255,255,0.38)',
  },
  eventPickerMeta: { fontFamily: fonts.regular, fontSize: 9, color: colors.textMuted },
  pickerArrow: { fontFamily: fonts.bold, fontSize: 17, color: colors.highlight },
  eventPickerList: {
    marginTop: -16,
    borderWidth: 1,
    borderTopWidth: 0,
    borderColor: '#2d3832',
  },
  eventPickerOption: {
    minHeight: 64,
    paddingHorizontal: 14,
    paddingVertical: 11,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderTopWidth: 1,
    borderTopColor: '#2d3832',
    backgroundColor: '#17201b',
  },
  eventPickerOptionSelected: { backgroundColor: 'rgba(123,255,178,0.1)' },
  composer: {
    minHeight: 120,
    padding: 16,
    backgroundColor: 'rgba(15,17,16,0.5)',
    fontFamily: fonts.regular,
    fontSize: 14,
    lineHeight: 20,
    color: '#ffffff',
    textAlignVertical: 'top',
  },
  characterCount: {
    marginTop: -10,
    textAlign: 'right',
    fontFamily: fonts.regular,
    fontSize: 9,
    color: 'rgba(255,255,255,0.32)',
  },
  confirmation: {
    padding: 16,
    gap: 10,
    borderWidth: 1,
    borderColor: 'rgba(123,255,178,0.25)',
    backgroundColor: 'rgba(123,255,178,0.06)',
  },
  confirmationTitle: {
    fontFamily: fonts.bold,
    fontSize: 11,
    letterSpacing: 0.5,
    color: colors.highlight,
  },
  confirmationBody: {
    fontFamily: fonts.regular,
    fontSize: 12,
    lineHeight: 18,
    color: colors.textMuted,
  },
  confirmationActions: { flexDirection: 'row', gap: 10 },
  cancelButton: {
    minHeight: 54,
    paddingHorizontal: 18,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.18)',
  },
  cancelButtonText: {
    fontFamily: fonts.bold,
    fontSize: 10,
    color: 'rgba(255,255,255,0.62)',
  },
  confirmButton: { flex: 1, marginTop: 0 },
});
