import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import React, { useMemo, useState } from 'react';
import {
  Alert,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { PageHeader } from '@/components/page-header';
import { OfflineMutationScreen } from '@/components/offline-state';
import { EventDateTimePicker } from '@/components/event-date-time-picker';
import { ActionButton, Noise, SectionLabel } from '@/components/ui';
import { colors, fonts } from '@/constants/theme';
import { useBrowserDefinitelyOffline } from '@/lib/offline/network';
import { eventPath } from '@/lib/routes';
import { useEvent } from '@/state/event';
import {
  EVENT_LIFECYCLE_LABELS,
  EventConfig,
  EventLifecycleStatus,
  formatTimeOfDay,
  fullAddress,
  generateTeeTimes,
  mapsUrl,
  parseTimeOfDay,
  TEE_PRESETS,
} from '@/state/types';

/**
 * The subset of the event this screen edits. Held as a local draft and written
 * in one go on save: committing per keystroke would fire a request per
 * character once this is backed by Supabase, and would briefly show players
 * half-typed values on their event page.
 */
type EventDraft = Pick<
  EventConfig,
  | 'lifecycleStatus'
  | 'name'
  | 'courseName'
  | 'addressLine'
  | 'city'
  | 'state'
  | 'postalCode'
  | 'eventDate'
  | 'checkInTime'
  | 'startTime'
  | 'teeTimes'
  | 'courseMapUrl'
  | 'teeColor'
>;

function draftFrom(event: EventConfig): EventDraft {
  return {
    lifecycleStatus: event.lifecycleStatus,
    name: event.name,
    courseName: event.courseName,
    addressLine: event.addressLine,
    city: event.city,
    state: event.state,
    postalCode: event.postalCode,
    eventDate: event.eventDate,
    checkInTime: event.checkInTime,
    startTime: event.startTime,
    teeTimes: event.teeTimes,
    courseMapUrl: event.courseMapUrl,
    teeColor: event.teeColor,
  };
}

/** "2026-08-24" → "Monday, Aug 24, 2026" */
function prettyDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  if (!y || !m || !d) return iso;
  return new Date(y, m - 1, d).toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function toIsoDate(date: Date): string {
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${m}-${d}`;
}

function dateFromTime(value: string): Date {
  const minutes = parseTimeOfDay(value) ?? 8 * 60;
  const date = new Date();
  date.setHours(Math.floor(minutes / 60), minutes % 60, 0, 0);
  return date;
}

function showMessage(title: string, message: string) {
  if (Platform.OS === 'web' && typeof window !== 'undefined') {
    window.alert(`${title}\n\n${message}`);
    return;
  }
  Alert.alert(title, message);
}

function confirmAction({
  title,
  message,
  confirmLabel,
  destructive = false,
  onConfirm,
}: {
  title: string;
  message: string;
  confirmLabel: string;
  destructive?: boolean;
  onConfirm: () => void;
}) {
  if (Platform.OS === 'web' && typeof window !== 'undefined') {
    if (window.confirm(`${title}\n\n${message}`)) onConfirm();
    return;
  }

  Alert.alert(title, message, [
    { text: 'Cancel', style: 'cancel' },
    {
      text: confirmLabel,
      style: destructive ? 'destructive' : 'default',
      onPress: onConfirm,
    },
  ]);
}

type Picker = 'date' | 'checkIn' | 'start' | 'firstTee' | null;

const LIFECYCLE_OPTIONS: {
  value: EventLifecycleStatus;
  description: string;
}[] = [
  { value: 'draft', description: 'Private setup before participants are invited.' },
  { value: 'published', description: 'Visible and ready for participants.' },
  { value: 'live', description: 'The event is actively being played.' },
  { value: 'completed', description: 'Shows the Event Ended state and keeps results.' },
  { value: 'archived', description: 'Ended and retained for club history.' },
];

export default function AdminEvent() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { event, me, teams, updateEvent, updateTeam } = useEvent();
  const offline = useBrowserDefinitelyOffline();

  const [draft, setDraft] = useState<EventDraft>(() => draftFrom(event));
  const [picker, setPicker] = useState<Picker>(null);
  const [saving, setSaving] = useState(false);

  // Tee time generator inputs (not part of the draft — they're just controls).
  const [firstTee, setFirstTee] = useState(event.teeTimes[0] ?? '8:00 AM');
  const [interval, setInterval] = useState('10');
  const [slotCount, setSlotCount] = useState(String(Math.max(4, teams.length)));

  const dirty = useMemo(
    () => JSON.stringify(draft) !== JSON.stringify(draftFrom(event)),
    [draft, event],
  );

  /** Teams whose tee time wouldn't exist under the draft's slot list. */
  const orphanedTeams = useMemo(
    () => teams.filter((t) => t.teeTime && !draft.teeTimes.includes(t.teeTime)),
    [teams, draft.teeTimes],
  );

  if (!me.isAdmin) {
    return (
      <View style={styles.root}>
        <LinearGradient colors={['#203329', '#1b2a22']} style={StyleSheet.absoluteFill} />
        <Noise />
        <PageHeader title="event details" />
        <View style={{ paddingTop: insets.top + 114, paddingHorizontal: 24 }}>
          <Text style={styles.muted}>You don’t have admin access for this event.</Text>
        </View>
      </View>
    );
  }

  if (offline) {
    return (
      <OfflineMutationScreen
        title="event details"
        description="Event details and course-map uploads require a connection. Reconnect to make or save changes."
      />
    );
  }

  const patch = (next: Partial<EventDraft>) => setDraft((prev) => ({ ...prev, ...next }));

  const save = () => {
    if (saving) return;
    if (draft.name.trim() === '') {
      showMessage('Name required', 'The event needs a name.');
      return;
    }

    const commit = async () => {
      setSaving(true);
      const saved = await updateEvent({
        ...draft,
        name: draft.name.trim(),
        courseName: draft.courseName.trim(),
      });
      if (!saved) {
        setSaving(false);
        showMessage(
          "Couldn't save event details",
          'Check your connection and admin access, then try again.',
        );
        return;
      }

      // Clearing happens here, not while editing, so discarding leaves teams alone.
      orphanedTeams.forEach((t) => updateTeam(t.id, { teeTime: null }));
      router.back();
    };

    if (orphanedTeams.length > 0) {
      confirmAction({
        title: 'Some tee times will be cleared',
        message: `${orphanedTeams.map((t) => t.name).join(', ')} ${orphanedTeams.length === 1 ? 'is' : 'are'} on a slot that's no longer in the list. Their tee time will be cleared so you can reassign it.`,
        confirmLabel: 'Save',
        destructive: true,
        onConfirm: () => void commit(),
      });
    } else {
      void commit();
    }
  };

  const discard = () => {
    Alert.alert('Discard changes?', 'Your edits to this event will be lost.', [
      { text: 'Keep editing', style: 'cancel' },
      {
        text: 'Discard',
        style: 'destructive',
        onPress: () => setDraft(draftFrom(event)),
      },
    ]);
  };

  const handleBack = () => {
    if (!dirty) {
      router.back();
      return;
    }
    Alert.alert('Unsaved changes', 'Save your changes to this event before leaving?', [
      { text: 'Keep editing', style: 'cancel' },
      { text: 'Discard', style: 'destructive', onPress: () => router.back() },
      { text: 'Save', onPress: save },
    ]);
  };

  const pickCourseMap = async () => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert(
        'Photo access needed',
        'Allow photo access in Settings to upload a course map.',
      );
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.9,
    });
    if (!result.canceled && result.assets[0]) {
      // The local uri previews immediately; saving uploads it to event-media.
      patch({ courseMapUrl: result.assets[0].uri });
    }
  };

  const regenerateSlots = () => {
    const mins = parseTimeOfDay(firstTee);
    if (mins === null) {
      Alert.alert('Check the first tee time', 'Use a format like 8:00 AM.');
      return;
    }
    const step = Number(interval);
    const count = Number(slotCount);
    if (!Number.isFinite(step) || step <= 0) {
      Alert.alert('Check the interval', 'Enter minutes between tee times, e.g. 10.');
      return;
    }
    if (!Number.isFinite(count) || count <= 0 || count > 60) {
      Alert.alert('Check the slot count', 'Enter how many tee times you need (1–60).');
      return;
    }
    const slots = generateTeeTimes(formatTimeOfDay(mins), step, count);
    patch({ teeTimes: slots, startTime: slots[0] });
  };

  const removeSlot = (slot: string) =>
    patch({ teeTimes: draft.teeTimes.filter((s) => s !== slot) });

  const addSlot = () => {
    const last = draft.teeTimes[draft.teeTimes.length - 1];
    const base = last ? parseTimeOfDay(last) : parseTimeOfDay(firstTee);
    const step = Number(interval) || 10;
    const next = formatTimeOfDay((base ?? 8 * 60) + step);
    if (draft.teeTimes.includes(next)) return;
    patch({ teeTimes: [...draft.teeTimes, next] });
  };

  const onPickerChange = (selected?: Date) => {
    if (Platform.OS === 'android') setPicker(null);
    if (!selected) return;
    const asTime = formatTimeOfDay(selected.getHours() * 60 + selected.getMinutes());

    switch (picker) {
      case 'date':
        patch({ eventDate: toIsoDate(selected) });
        break;
      case 'checkIn':
        patch({ checkInTime: asTime });
        break;
      case 'start':
        patch({ startTime: asTime });
        break;
      case 'firstTee':
        setFirstTee(asTime);
        break;
    }
  };

  const pickerValue =
    picker === 'date'
      ? (() => {
          const [y, m, d] = draft.eventDate.split('-').map(Number);
          return new Date(y, (m ?? 1) - 1, d ?? 1);
        })()
      : picker === 'checkIn'
        ? dateFromTime(draft.checkInTime)
        : picker === 'start'
          ? dateFromTime(draft.startTime)
          : dateFromTime(firstTee);

  // Address helpers need a full EventConfig shape; splice the draft over it.
  const previewEvent = { ...event, ...draft };

  return (
    <View style={styles.root}>
      <LinearGradient colors={['#203329', '#1b2a22']} style={StyleSheet.absoluteFill} />
      <Noise />
      <PageHeader
        title="event details"
        subtitle={dirty ? 'UNSAVED CHANGES' : event.name}
        onBack={handleBack}
      />
      <ScrollView
        contentContainerStyle={{
          paddingTop: insets.top + 54 + 22,
          paddingHorizontal: 20,
          paddingBottom: dirty ? 140 : 60,
          gap: 24,
        }}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled">
        <View style={{ gap: 10 }}>
          <SectionLabel color={colors.link} size={10}>
            lifecycle
          </SectionLabel>
          <Text style={styles.hint}>
            Completed and Archived events show EVENT ENDED on their Home card.
          </Text>
          {LIFECYCLE_OPTIONS.map((option) => {
            const active = draft.lifecycleStatus === option.value;
            return (
              <Pressable
                key={option.value}
                accessibilityRole="radio"
                accessibilityState={{ checked: active }}
                style={[styles.lifecycleOption, active && styles.lifecycleOptionActive]}
                onPress={() => patch({ lifecycleStatus: option.value })}>
                <View style={styles.lifecycleCopy}>
                  <Text style={[styles.lifecycleName, active && styles.lifecycleNameActive]}>
                    {EVENT_LIFECYCLE_LABELS[option.value]}
                  </Text>
                  <Text style={styles.lifecycleDescription}>{option.description}</Text>
                </View>
                <View style={[styles.lifecycleRadio, active && styles.lifecycleRadioActive]} />
              </Pressable>
            );
          })}
        </View>

        {/* Identity */}
        <View style={{ gap: 10 }}>
          <SectionLabel color={colors.link} size={10}>
            event
          </SectionLabel>
          <Text style={styles.fieldLabel}>NAME</Text>
          <TextInput
            value={draft.name}
            onChangeText={(text) => patch({ name: text })}
            style={styles.input}
            placeholder="Blurry Invitational"
            placeholderTextColor="rgba(255,255,255,0.3)"
            selectionColor={colors.highlight}
          />
          <Text style={styles.fieldLabel}>COURSE</Text>
          <TextInput
            value={draft.courseName}
            onChangeText={(text) => patch({ courseName: text })}
            style={styles.input}
            placeholder="Arrowhead Golf Club"
            placeholderTextColor="rgba(255,255,255,0.3)"
            selectionColor={colors.highlight}
          />
        </View>

        {/* Address */}
        <View style={{ gap: 10 }}>
          <SectionLabel color={colors.link} size={10}>
            address
          </SectionLabel>
          <Text style={styles.hint}>
            Players get a Directions link on the event page. Leave the street
            blank and Maps will search for the course by name instead.
          </Text>

          <Text style={styles.fieldLabel}>STREET</Text>
          <TextInput
            value={draft.addressLine}
            onChangeText={(text) => patch({ addressLine: text })}
            style={styles.input}
            placeholder="10850 W Sundown Trail"
            placeholderTextColor="rgba(255,255,255,0.3)"
            selectionColor={colors.highlight}
          />

          <View style={styles.addressRow}>
            <View style={styles.addressCity}>
              <Text style={styles.fieldLabel}>CITY</Text>
              <TextInput
                value={draft.city}
                onChangeText={(text) => patch({ city: text })}
                style={styles.input}
                placeholder="Littleton"
                placeholderTextColor="rgba(255,255,255,0.3)"
                selectionColor={colors.highlight}
              />
            </View>
            <View style={styles.addressState}>
              <Text style={styles.fieldLabel}>STATE</Text>
              <TextInput
                value={draft.state}
                onChangeText={(text) => patch({ state: text.toUpperCase().slice(0, 2) })}
                style={styles.input}
                placeholder="CO"
                placeholderTextColor="rgba(255,255,255,0.3)"
                autoCapitalize="characters"
                autoCorrect={false}
                maxLength={2}
                selectionColor={colors.highlight}
              />
            </View>
            <View style={styles.addressZip}>
              <Text style={styles.fieldLabel}>ZIP</Text>
              <TextInput
                value={draft.postalCode}
                onChangeText={(text) =>
                  patch({ postalCode: text.replace(/[^\d-]/g, '').slice(0, 10) })
                }
                style={styles.input}
                placeholder="80125"
                placeholderTextColor="rgba(255,255,255,0.3)"
                keyboardType="number-pad"
                selectionColor={colors.highlight}
              />
            </View>
          </View>

          <Pressable
            style={styles.mapsPreview}
            onPress={() => Linking.openURL(mapsUrl(previewEvent))}>
            <View style={{ flex: 1, gap: 4 }}>
              <Text style={styles.mapsLabel}>PREVIEW IN MAPS</Text>
              <Text style={styles.mapsValue}>
                {fullAddress(previewEvent) ||
                  `${draft.courseName} (search by name)`}
              </Text>
            </View>
            <Text style={styles.linkArrow}>›</Text>
          </Pressable>
        </View>

        {/* When */}
        <View style={{ gap: 10 }}>
          <SectionLabel color={colors.link} size={10}>
            when
          </SectionLabel>
          <Pressable style={styles.pickerRow} onPress={() => setPicker('date')}>
            <Text style={styles.pickerLabel}>DATE</Text>
            <Text style={styles.pickerValue}>{prettyDate(draft.eventDate)}</Text>
          </Pressable>
          <Pressable style={styles.pickerRow} onPress={() => setPicker('checkIn')}>
            <Text style={styles.pickerLabel}>CHECK-IN</Text>
            <Text style={styles.pickerValue}>{draft.checkInTime}</Text>
          </Pressable>
          <Pressable style={styles.pickerRow} onPress={() => setPicker('start')}>
            <Text style={styles.pickerLabel}>FIRST TEE</Text>
            <Text style={styles.pickerValue}>{draft.startTime}</Text>
          </Pressable>

          {picker ? (
            <View style={styles.pickerHost}>
              <EventDateTimePicker
                value={pickerValue}
                mode={picker === 'date' ? 'date' : 'time'}
                onChange={onPickerChange}
                minuteInterval={5}
              />
              <Pressable style={styles.pickerDone} onPress={() => setPicker(null)}>
                <Text style={styles.pickerDoneText}>DONE</Text>
              </Pressable>
            </View>
          ) : null}
        </View>

        {/* Tee times */}
        <View style={{ gap: 10 }}>
          <SectionLabel color={colors.link} size={10}>
            tee times available
          </SectionLabel>
          <Text style={styles.hint}>
            Teams are assigned to these slots on the Teams page.
          </Text>

          <View style={styles.generatorRow}>
            <View style={styles.generatorField}>
              <Text style={styles.fieldLabel}>FIRST</Text>
              <Pressable
                style={styles.generatorInput}
                onPress={() => setPicker('firstTee')}>
                <Text style={styles.generatorInputText}>{firstTee}</Text>
              </Pressable>
            </View>
            <View style={styles.generatorField}>
              <Text style={styles.fieldLabel}>EVERY</Text>
              <TextInput
                value={interval}
                onChangeText={setInterval}
                style={styles.generatorInput}
                keyboardType="number-pad"
                placeholder="10"
                placeholderTextColor="rgba(255,255,255,0.3)"
                selectionColor={colors.highlight}
              />
            </View>
            <View style={styles.generatorField}>
              <Text style={styles.fieldLabel}>SLOTS</Text>
              <TextInput
                value={slotCount}
                onChangeText={setSlotCount}
                style={styles.generatorInput}
                keyboardType="number-pad"
                placeholder="6"
                placeholderTextColor="rgba(255,255,255,0.3)"
                selectionColor={colors.highlight}
              />
            </View>
          </View>
          <ActionButton label="GENERATE TEE TIMES" height={50} onPress={regenerateSlots} />

          {draft.teeTimes.length === 0 ? (
            <Text style={styles.muted}>No tee times yet.</Text>
          ) : (
            <View style={styles.slotList}>
              {draft.teeTimes.map((slot) => {
                const team = teams.find((t) => t.teeTime === slot);
                return (
                  <View key={slot} style={styles.slotRow}>
                    <Text style={styles.slotTime}>{slot}</Text>
                    <Text style={styles.slotTeam}>{team ? team.name : 'open'}</Text>
                    <Pressable onPress={() => removeSlot(slot)} hitSlop={10}>
                      <Text style={styles.slotRemove}>REMOVE</Text>
                    </Pressable>
                  </View>
                );
              })}
            </View>
          )}
          {orphanedTeams.length > 0 ? (
            <Text style={styles.warn}>
              {orphanedTeams.map((t) => t.name).join(', ')} will lose their tee time
              when you save.
            </Text>
          ) : null}
          <Pressable style={styles.secondaryButton} onPress={addSlot}>
            <Text style={styles.secondaryButtonText}>ADD ONE SLOT</Text>
          </Pressable>
        </View>

        {/* Course map */}
        <View style={{ gap: 10 }}>
          <SectionLabel color={colors.link} size={10}>
            course map
          </SectionLabel>
          {draft.courseMapUrl ? (
            <>
              <Image
                source={{ uri: draft.courseMapUrl }}
                style={styles.mapPreview}
                contentFit="cover"
              />
              <View style={styles.actionsRow}>
                <Pressable style={styles.secondaryButton} onPress={pickCourseMap}>
                  <Text style={styles.secondaryButtonText}>REPLACE</Text>
                </Pressable>
                <Pressable
                  style={styles.secondaryButton}
                  onPress={() => patch({ courseMapUrl: null })}>
                  <Text style={styles.secondaryButtonText}>REMOVE</Text>
                </Pressable>
              </View>
            </>
          ) : (
            <Pressable style={styles.mapEmpty} onPress={pickCourseMap}>
              <Text style={styles.mapEmptyText}>UPLOAD COURSE MAP</Text>
              <Text style={styles.hint}>
                A photo or scan of the scorecard layout. Players can pinch to zoom.
              </Text>
            </Pressable>
          )}
        </View>

        {/* Scorecard — saves on its own screen, so it's a plain link. */}
        <View style={{ gap: 10 }}>
          <SectionLabel color={colors.link} size={10}>
            scorecard
          </SectionLabel>
          <Pressable
            style={styles.linkCard}
            onPress={() => router.push(eventPath(event.id, 'admin-holes') as never)}>
            <View style={{ flex: 1, gap: 5 }}>
              <Text style={styles.linkTitle}>HOLES, PAR & YARDAGE</Text>
              <Text style={styles.linkSub}>
                18 holes · par {event.holes.reduce((t, h) => t + h.par, 0)} ·{' '}
                {event.holes.reduce((t, h) => t + h.yards, 0).toLocaleString()} yds
              </Text>
            </View>
            <Text style={styles.linkArrow}>›</Text>
          </Pressable>

          {/* Which tees the yardages above belong to. */}
          <Text style={styles.fieldLabel}>TEES</Text>
          <View style={styles.teeColorRow}>
            {TEE_PRESETS.map((tee) => {
              const active =
                draft.teeColor.trim().toLowerCase() === tee.name.toLowerCase();
              return (
                <Pressable
                  key={tee.name}
                  onPress={() => patch({ teeColor: tee.name })}
                  style={[styles.teeChip, active && styles.teeChipActive]}>
                  <View style={[styles.teeSwatch, { backgroundColor: tee.swatch }]} />
                  <Text style={[styles.teeChipText, active && styles.teeChipTextActive]}>
                    {tee.name}
                  </Text>
                </Pressable>
              );
            })}
          </View>
          <TextInput
            value={draft.teeColor}
            onChangeText={(teeColor) => patch({ teeColor })}
            style={styles.input}
            placeholder="Or type the name your course uses"
            placeholderTextColor="rgba(255,255,255,0.3)"
            selectionColor={colors.highlight}
          />
          <Text style={styles.hint}>
            Shown on the score entry screen, under the yardage.
          </Text>
        </View>
      </ScrollView>

      {/* Save bar — only present when there's something to save. */}
      {dirty ? (
        <View style={[styles.saveBar, { paddingBottom: insets.bottom + 12 }]}>
          <Pressable
            style={[styles.discardButton, saving && styles.buttonDisabled]}
            disabled={saving}
            onPress={discard}>
            <Text style={styles.discardText}>DISCARD</Text>
          </Pressable>
          <Pressable
            style={[styles.saveButton, saving && styles.buttonDisabled]}
            disabled={saving}
            onPress={save}>
            <Text style={styles.saveText}>
              {saving ? 'SAVING…' : 'SAVE CHANGES'}
            </Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#1b2a22',
  },
  muted: {
    fontFamily: fonts.regular,
    fontSize: 13,
    color: 'rgba(255,255,255,0.45)',
  },
  hint: {
    fontFamily: fonts.regular,
    fontSize: 11,
    lineHeight: 16,
    color: 'rgba(255,255,255,0.4)',
  },
  warn: {
    fontFamily: fonts.regular,
    fontSize: 11,
    lineHeight: 16,
    color: '#ffcf8b',
  },
  fieldLabel: {
    fontFamily: fonts.bold,
    fontSize: 9,
    color: 'rgba(255,255,255,0.45)',
  },
  lifecycleOption: {
    minHeight: 62,
    paddingVertical: 12,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderWidth: 1,
    borderColor: 'transparent',
    backgroundColor: 'rgba(15,17,16,0.5)',
  },
  lifecycleOptionActive: {
    borderColor: 'rgba(123,255,178,0.4)',
    backgroundColor: 'rgba(123,255,178,0.07)',
  },
  lifecycleCopy: { flex: 1, gap: 5 },
  lifecycleName: {
    fontFamily: fonts.bold,
    fontSize: 11,
    color: '#ffffff',
  },
  lifecycleNameActive: { color: colors.highlight },
  lifecycleDescription: {
    fontFamily: fonts.regular,
    fontSize: 10,
    lineHeight: 14,
    color: 'rgba(255,255,255,0.42)',
  },
  lifecycleRadio: {
    width: 16,
    height: 16,
    borderRadius: 8,
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.25)',
  },
  lifecycleRadioActive: {
    borderColor: colors.highlight,
    backgroundColor: colors.highlight,
  },
  teeColorRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  teeChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 9,
    paddingHorizontal: 12,
    borderRadius: 999,
    backgroundColor: 'rgba(0,0,0,0.3)',
    borderWidth: 1,
    borderColor: 'transparent',
  },
  teeChipActive: {
    borderColor: colors.highlight,
  },
  /** A ring, so the white and black swatches both stay visible on this bg. */
  teeSwatch: {
    width: 13,
    height: 13,
    borderRadius: 7,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.35)',
  },
  teeChipText: {
    fontFamily: fonts.bold,
    fontSize: 11,
    color: 'rgba(255,255,255,0.6)',
  },
  teeChipTextActive: {
    color: '#ffffff',
  },
  input: {
    backgroundColor: 'rgba(0,0,0,0.3)',
    height: 48,
    paddingHorizontal: 14,
    fontFamily: fonts.regular,
    fontSize: 15,
    color: '#ffffff',
  },
  addressRow: {
    flexDirection: 'row',
    gap: 10,
  },
  addressCity: {
    flex: 1,
    gap: 6,
  },
  addressState: {
    width: 74,
    gap: 6,
  },
  addressZip: {
    width: 104,
    gap: 6,
  },
  mapsPreview: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 16,
    backgroundColor: 'rgba(15,17,16,0.5)',
  },
  mapsLabel: {
    fontFamily: fonts.bold,
    fontSize: 9,
    color: colors.link,
  },
  mapsValue: {
    fontFamily: fonts.bold,
    fontSize: 13,
    color: '#ffffff',
  },
  pickerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
    backgroundColor: 'rgba(15,17,16,0.5)',
  },
  pickerLabel: {
    fontFamily: fonts.bold,
    fontSize: 10,
    color: 'rgba(255,255,255,0.45)',
  },
  pickerValue: {
    fontFamily: fonts.bold,
    fontSize: 14,
    color: '#ffffff',
  },
  pickerHost: {
    backgroundColor: 'rgba(0,0,0,0.35)',
    alignItems: 'center',
    paddingBottom: 8,
  },
  pickerDone: {
    paddingHorizontal: 24,
    paddingVertical: 10,
  },
  pickerDoneText: {
    fontFamily: fonts.bold,
    fontSize: 11,
    color: colors.highlight,
  },
  generatorRow: {
    flexDirection: 'row',
    gap: 10,
  },
  generatorField: {
    flex: 1,
    gap: 6,
  },
  generatorInput: {
    backgroundColor: 'rgba(0,0,0,0.3)',
    height: 46,
    paddingHorizontal: 12,
    fontFamily: fonts.bold,
    fontSize: 13,
    color: '#ffffff',
    justifyContent: 'center',
  },
  generatorInputText: {
    fontFamily: fonts.bold,
    fontSize: 13,
    color: '#ffffff',
  },
  slotList: {
    backgroundColor: 'rgba(15,17,16,0.4)',
  },
  slotRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.05)',
  },
  slotTime: {
    width: 80,
    fontFamily: fonts.bold,
    fontSize: 13,
    color: '#ffffff',
  },
  slotTeam: {
    flex: 1,
    fontFamily: fonts.regular,
    fontSize: 12,
    color: 'rgba(255,255,255,0.4)',
  },
  slotRemove: {
    fontFamily: fonts.bold,
    fontSize: 9,
    color: '#ff9b9b',
  },
  actionsRow: {
    flexDirection: 'row',
    gap: 10,
  },
  secondaryButton: {
    flex: 1,
    height: 46,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(15,17,16,0.55)',
  },
  secondaryButtonText: {
    fontFamily: fonts.bold,
    fontSize: 11,
    color: 'rgba(255,255,255,0.75)',
  },
  mapPreview: {
    width: '100%',
    height: 180,
    backgroundColor: 'rgba(0,0,0,0.3)',
  },
  mapEmpty: {
    padding: 24,
    gap: 8,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(123,255,178,0.25)',
    borderStyle: 'dashed',
  },
  mapEmptyText: {
    fontFamily: fonts.bold,
    fontSize: 12,
    color: colors.highlight,
  },
  linkCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 16,
    backgroundColor: 'rgba(15,17,16,0.5)',
    borderWidth: 1,
    borderColor: 'rgba(123,255,178,0.2)',
  },
  linkTitle: {
    fontFamily: fonts.bold,
    fontSize: 13,
    color: colors.highlight,
  },
  linkSub: {
    fontFamily: fonts.regular,
    fontSize: 12,
    color: 'rgba(255,255,255,0.45)',
  },
  linkArrow: {
    fontSize: 22,
    color: 'rgba(255,255,255,0.5)',
  },
  saveBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: 'row',
    gap: 10,
    paddingHorizontal: 20,
    paddingTop: 12,
    backgroundColor: 'rgba(9,12,10,0.96)',
    borderTopWidth: 1,
    borderTopColor: 'rgba(123,255,178,0.2)',
  },
  discardButton: {
    width: 110,
    height: 52,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.07)',
  },
  discardText: {
    fontFamily: fonts.bold,
    fontSize: 11,
    color: 'rgba(255,255,255,0.7)',
  },
  saveButton: {
    flex: 1,
    height: 52,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#34a468',
  },
  saveText: {
    fontFamily: fonts.bold,
    fontSize: 12,
    color: '#0d1a12',
  },
  buttonDisabled: {
    opacity: 0.55,
  },
});
