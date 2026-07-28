import { LinearGradient } from 'expo-linear-gradient';
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { AvatarStack, Chevron } from '@/components/ui';
import { colors, fonts } from '@/constants/theme';

export type EventCardProps = {
  month: string;
  day: string;
  title?: string;
  course: string;
  time: string;
  badge?: string;
  avatars?: (number | { uri: string })[];
  active?: boolean;
  /** 'neutral' = gradient with white date; 'past' = flat, muted */
  tone?: 'neutral' | 'past';
  onPress?: () => void;
};

/** Card / Event Member — tee time & event row with date rail, avatars, badge. */
export function EventCard({
  month,
  day,
  title,
  course,
  time,
  badge,
  avatars,
  active,
  tone,
  onPress,
}: EventCardProps) {
  const dateColor =
    tone === 'past' ? '#4b6054' : tone === 'neutral' ? '#e4e4e4' : colors.highlight;
  const titleColor = tone === 'past' ? '#4b6054' : '#ffffff';
  const timeColor =
    tone === 'past' ? '#929292' : tone === 'neutral' ? '#e8e8e8' : colors.link;
  return (
    <Pressable onPress={onPress} style={styles.card}>
      {tone === 'past' ? (
        <View style={[StyleSheet.absoluteFill, { backgroundColor: '#141c17' }]} />
      ) : (
        <LinearGradient
          colors={
            active || tone === 'neutral'
              ? [...colors.gradCardActive]
              : [...colors.gradCardDark]
          }
          style={StyleSheet.absoluteFill}
        />
      )}
      <View style={styles.dateRail}>
        <Text style={[styles.dateMonth, { color: dateColor }]}>{month}</Text>
        <Text style={[styles.dateDay, { color: dateColor }]}>{day}</Text>
      </View>
      <View style={styles.divider} />
      <View style={styles.body}>
        {title ? (
          <Text numberOfLines={1} style={[styles.title, { color: titleColor }]}>
            {title}
          </Text>
        ) : null}
        <Text
          style={[
            title ? styles.courseMuted : styles.course,
            tone === 'past' && { color: 'rgba(75,96,84,0.8)' },
          ]}>
          {course}
        </Text>
        <Text style={[styles.time, { color: timeColor }]}>{time}</Text>
      </View>
      <View style={styles.right}>
        <View style={styles.rightStack}>
          {avatars ? <AvatarStack sources={avatars} /> : null}
          {badge ? (
            <View style={styles.badgePill}>
              <Text style={styles.badgeText}>{badge}</Text>
            </View>
          ) : null}
        </View>
        <Chevron />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    minHeight: 87,
    flexDirection: 'row',
    alignItems: 'stretch',
    overflow: 'hidden',
  },
  dateRail: {
    width: 60,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  dateMonth: {
    fontFamily: fonts.bold,
    fontSize: 10,
    color: colors.highlight,
    textTransform: 'uppercase',
  },
  dateDay: {
    fontFamily: fonts.serif,
    fontSize: 30,
    color: colors.highlight,
  },
  divider: {
    width: StyleSheet.hairlineWidth,
    backgroundColor: colors.border,
  },
  body: {
    flex: 1,
    justifyContent: 'center',
    gap: 8,
    paddingHorizontal: 20,
    paddingVertical: 16,
  },
  title: {
    fontFamily: fonts.bold,
    fontSize: 15,
    color: '#ffffff',
  },
  course: {
    fontFamily: fonts.bold,
    fontSize: 10,
    color: '#ffffff',
  },
  courseMuted: {
    fontFamily: fonts.bold,
    fontSize: 10,
    color: 'rgba(255,255,255,0.5)',
  },
  time: {
    fontFamily: fonts.bold,
    fontSize: 10,
    color: colors.link,
    textTransform: 'uppercase',
  },
  right: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 20,
    paddingRight: 20,
    paddingLeft: 0,
  },
  rightStack: {
    alignItems: 'flex-end',
    gap: 8,
  },
  badgePill: {
    backgroundColor: colors.badgeGlass,
    borderRadius: 20,
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  badgeText: {
    fontFamily: fonts.bold,
    fontSize: 8,
    color: '#ffffff',
    textTransform: 'uppercase',
  },
});
