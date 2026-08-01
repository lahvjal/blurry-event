import { useRouter } from 'expo-router';
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Chevron } from '@/components/ui';
import { colors, fonts } from '@/constants/theme';
import { eventPath } from '@/lib/routes';
import { useEvent } from '@/state/event';
import {
  AccessibleEvent,
  EVENT_LIFECYCLE_LABELS,
} from '@/state/types';

function eventDateLabel(eventDate: string): string {
  return new Date(`${eventDate}T12:00:00`).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function EventOption({
  event,
  selected,
  onPress,
}: {
  event: AccessibleEvent;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Open ${event.name}`}
      accessibilityState={{ selected }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.option,
        selected && styles.optionSelected,
        pressed && styles.pressed,
      ]}>
      <View style={styles.optionCopy}>
        <Text numberOfLines={1} style={styles.optionName}>
          {event.name}
        </Text>
        <Text numberOfLines={1} style={styles.optionMeta}>
          {event.courseName} · {eventDateLabel(event.eventDate)}
        </Text>
      </View>
      <View style={styles.optionStatus}>
        <Text style={styles.lifecycle}>
          {EVENT_LIFECYCLE_LABELS[event.lifecycleStatus]}
        </Text>
        {selected ? <Text style={styles.current}>CURRENT</Text> : null}
      </View>
    </Pressable>
  );
}

/**
 * Keeps event selection next to the event card it controls. The route remains
 * the source of truth: choosing an option changes the explicit event ID, then
 * EventProvider loads that event's complete scoped bundle.
 */
export function HomeEventSelector() {
  const router = useRouter();
  const { accountAccess, activeEventId, event } = useEvent();
  const [open, setOpen] = React.useState(false);
  const events = accountAccess?.events ?? [];
  const canSwitch = events.length > 1;
  const focusedEvent =
    events.find((candidate) => candidate.id === activeEventId) ??
    events.find((candidate) => candidate.id === event.id);

  React.useEffect(() => {
    setOpen(false);
  }, [activeEventId]);

  if (!focusedEvent) return null;

  const selectEvent = (eventId: string) => {
    setOpen(false);
    if (eventId === activeEventId) return;
    router.replace(eventPath(eventId, 'event') as never);
  };

  return (
    <View style={styles.root}>
      <Text style={styles.label}>VIEWING EVENT</Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={
          canSwitch
            ? `Choose event. Currently ${focusedEvent.name}`
            : `Current event: ${focusedEvent.name}`
        }
        accessibilityState={{ expanded: open, disabled: !canSwitch }}
        disabled={!canSwitch}
        onPress={() => setOpen((current) => !current)}
        style={({ pressed }) => [
          styles.trigger,
          !canSwitch && styles.triggerSingle,
          pressed && styles.pressed,
        ]}>
        <View style={styles.triggerCopy}>
          <Text numberOfLines={1} style={styles.triggerName}>
            {focusedEvent.name}
          </Text>
          <Text numberOfLines={1} style={styles.triggerMeta}>
            {focusedEvent.courseName}
          </Text>
        </View>
        {canSwitch ? (
          <View
            style={[
              styles.chevron,
              { transform: [{ rotate: open ? '-90deg' : '90deg' }] },
            ]}>
            <Chevron color={colors.highlight} width={6} height={12} />
          </View>
        ) : (
          <Text style={styles.singleLabel}>1 EVENT</Text>
        )}
      </Pressable>

      {open ? (
        <View accessibilityRole="menu" style={styles.menu}>
          {events.map((candidate) => (
            <EventOption
              key={candidate.id}
              event={candidate}
              selected={candidate.id === activeEventId}
              onPress={() => selectEvent(candidate.id)}
            />
          ))}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    gap: 7,
  },
  label: {
    paddingHorizontal: 2,
    fontFamily: fonts.bold,
    fontSize: 9,
    letterSpacing: 1.35,
    color: 'rgba(255,255,255,0.46)',
  },
  trigger: {
    minHeight: 62,
    paddingVertical: 12,
    paddingHorizontal: 15,
    borderWidth: 1,
    borderColor: 'rgba(123,255,178,0.28)',
    backgroundColor: 'rgba(20,29,24,0.92)',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  triggerSingle: {
    borderColor: '#2d3832',
  },
  triggerCopy: {
    flex: 1,
    gap: 5,
  },
  triggerName: {
    fontFamily: fonts.bold,
    fontSize: 14,
    color: '#ffffff',
  },
  triggerMeta: {
    fontFamily: fonts.regular,
    fontSize: 11,
    color: 'rgba(255,255,255,0.48)',
  },
  chevron: {
    width: 28,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  singleLabel: {
    fontFamily: fonts.bold,
    fontSize: 9,
    letterSpacing: 0.9,
    color: 'rgba(255,255,255,0.34)',
  },
  menu: {
    borderWidth: 1,
    borderColor: 'rgba(123,255,178,0.2)',
    backgroundColor: '#141d18',
  },
  option: {
    minHeight: 68,
    paddingVertical: 13,
    paddingHorizontal: 15,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#2d3832',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  optionSelected: {
    backgroundColor: 'rgba(123,255,178,0.08)',
  },
  optionCopy: {
    flex: 1,
    gap: 5,
  },
  optionName: {
    fontFamily: fonts.bold,
    fontSize: 13,
    color: '#ffffff',
  },
  optionMeta: {
    fontFamily: fonts.regular,
    fontSize: 10,
    color: 'rgba(255,255,255,0.46)',
  },
  optionStatus: {
    alignItems: 'flex-end',
    gap: 5,
  },
  lifecycle: {
    fontFamily: fonts.bold,
    fontSize: 8,
    letterSpacing: 0.75,
    color: colors.link,
  },
  current: {
    fontFamily: fonts.bold,
    fontSize: 8,
    letterSpacing: 0.75,
    color: colors.highlight,
  },
  pressed: {
    opacity: 0.72,
  },
});
