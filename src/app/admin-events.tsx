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
import { PageHeader } from '@/components/page-header';
import { Noise, SectionLabel } from '@/components/ui';
import { colors, fonts } from '@/constants/theme';
import { apiCreateClubEvent } from '@/lib/api';
import { eventPath } from '@/lib/routes';
import { useEvent } from '@/state/event';
import { EVENT_LIFECYCLE_LABELS } from '@/state/types';

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

export default function AdminEvents() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { accountAccess, accessLoading, refresh } = useEvent();
  const [formOpen, setFormOpen] = React.useState(false);
  const [name, setName] = React.useState('');
  const [courseName, setCourseName] = React.useState('');
  const [eventDate, setEventDate] = React.useState(localIsoDate());
  const [datePickerOpen, setDatePickerOpen] = React.useState(false);
  const [creating, setCreating] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  if (accessLoading) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color={colors.highlight} />
      </View>
    );
  }

  if (!accountAccess?.profile?.isClubAdmin) {
    return (
      <View style={styles.root}>
        <LinearGradient colors={['#203329', '#1b2a22']} style={StyleSheet.absoluteFill} />
        <Noise />
        <PageHeader title="manage events" showMore={false} />
        <View style={[styles.deniedWrap, { paddingTop: insets.top + 120 }]}>
          <Text style={styles.denied}>
            Club admin access is required to create or manage all events.
          </Text>
        </View>
      </View>
    );
  }

  const createEvent = async () => {
    if (creating) return;
    setError(null);
    if (!name.trim() || !courseName.trim()) {
      setError('Add an event name and course before creating the Draft.');
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
      router.replace(eventPath(eventId, 'admin-event') as never);
    } catch (caught) {
      setError(
        (caught as { message?: string })?.message ??
          'The event could not be created. Check your connection and try again.',
      );
      setCreating(false);
    }
  };

  const events = [...accountAccess.events].sort((a, b) =>
    b.eventDate.localeCompare(a.eventDate),
  );

  return (
    <View style={styles.root}>
      <LinearGradient colors={['#203329', '#1b2a22']} style={StyleSheet.absoluteFill} />
      <Noise />
      <PageHeader title="manage events" subtitle="CLUB ADMIN" showMore={false} />
      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingTop: insets.top + 86, paddingBottom: insets.bottom + 60 },
        ]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}>
        <View style={styles.intro}>
          <Text style={styles.title}>Club Events</Text>
          <Text style={styles.subtitle}>
            Create events as private Drafts, then configure their details,
            scorecard, roster, and teams before publishing.
          </Text>
        </View>

        <Pressable
          accessibilityRole="button"
          accessibilityState={{ expanded: formOpen }}
          style={styles.createToggle}
          onPress={() => {
            setError(null);
            setFormOpen((current) => !current);
          }}>
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
              value={name}
              onChangeText={setName}
              style={styles.input}
              placeholder="Blurry Fall Classic"
              placeholderTextColor="rgba(255,255,255,0.3)"
              selectionColor={colors.highlight}
            />
            <Text style={styles.fieldLabel}>COURSE</Text>
            <TextInput
              value={courseName}
              onChangeText={setCourseName}
              style={styles.input}
              placeholder="Course name"
              placeholderTextColor="rgba(255,255,255,0.3)"
              selectionColor={colors.highlight}
            />
            <Text style={styles.fieldLabel}>EVENT DATE</Text>
            <Pressable
              style={styles.dateRow}
              onPress={() => setDatePickerOpen((current) => !current)}>
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
                    setEventDate(localIsoDate(selected));
                    setDatePickerOpen(false);
                  }}
                />
              </View>
            ) : null}
            <Text style={styles.formHint}>
              The Draft starts with 18 editable placeholder holes and an event
              conversation. Only club admins can see it until people are added.
            </Text>
            {error ? <Text style={styles.error}>{error}</Text> : null}
            <Pressable
              disabled={creating}
              style={[styles.createButton, creating && styles.buttonDisabled]}
              onPress={() => void createEvent()}>
              <Text style={styles.createButtonText}>
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
              accessibilityLabel={`Manage ${event.name}`}
              style={styles.eventRow}
              onPress={() => router.push(eventPath(event.id, 'admin') as never)}>
              <View style={styles.eventCopy}>
                <Text numberOfLines={1} style={styles.eventName}>
                  {event.name}
                </Text>
                <Text numberOfLines={1} style={styles.eventMeta}>
                  {event.courseName} · {prettyDate(event.eventDate)}
                </Text>
              </View>
              <View style={styles.eventStatus}>
                <Text style={styles.lifecycle}>
                  {EVENT_LIFECYCLE_LABELS[event.lifecycleStatus]}
                </Text>
                <Text style={styles.arrow}>›</Text>
              </View>
            </Pressable>
          ))}
        </View>
      </ScrollView>
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
    maxWidth: 520,
    fontFamily: fonts.regular,
    fontSize: 13,
    lineHeight: 19,
    color: colors.textMuted,
  },
  createToggle: {
    minHeight: 54,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(123,255,178,0.32)',
    backgroundColor: 'rgba(123,255,178,0.08)',
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
    color: 'rgba(255,255,255,0.45)',
  },
  input: {
    height: 48,
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
  createButton: {
    minHeight: 54,
    marginTop: 4,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#203329',
  },
  createButtonText: {
    fontFamily: fonts.bold,
    fontSize: 11,
    color: '#ffffff',
  },
  buttonDisabled: { opacity: 0.5 },
  listHeader: {
    marginTop: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  count: { fontFamily: fonts.bold, fontSize: 11, color: colors.textMuted },
  list: { borderTopWidth: 1, borderTopColor: '#2d3832' },
  eventRow: {
    minHeight: 76,
    paddingVertical: 14,
    paddingHorizontal: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#2d3832',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: 'rgba(15,17,16,0.36)',
  },
  eventCopy: { flex: 1, gap: 7 },
  eventName: { fontFamily: fonts.bold, fontSize: 14, color: '#ffffff' },
  eventMeta: { fontFamily: fonts.regular, fontSize: 10, color: colors.textMuted },
  eventStatus: { alignItems: 'flex-end', gap: 6 },
  lifecycle: {
    fontFamily: fonts.bold,
    fontSize: 8,
    letterSpacing: 0.7,
    color: colors.link,
  },
  arrow: { fontSize: 20, lineHeight: 20, color: 'rgba(255,255,255,0.5)' },
});
