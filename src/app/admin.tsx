import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { PageHeader } from '@/components/page-header';
import { ActionButton, Noise, SectionLabel } from '@/components/ui';
import { colors, fonts } from '@/constants/theme';
import { useEvent } from '@/state/event';
import { GAME_STYLE_LABELS, GameStyle, teamSize } from '@/state/types';

const STYLES: GameStyle[] = ['solo', 'scramble_2', 'scramble_4'];

export default function Admin() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const {
    event,
    me,
    teams,
    participants,
    setGameStyle,
    postAnnouncement,
    teamOf,
  } = useEvent();

  const [draft, setDraft] = useState('');

  if (!me.isAdmin) {
    return (
      <View style={styles.root}>
        <LinearGradient colors={['#203329', '#1b2a22']} style={StyleSheet.absoluteFill} />
        <Noise />
        <PageHeader title="event admin" />
        <View style={{ paddingTop: insets.top + 54 + 60, paddingHorizontal: 24 }}>
          <Text style={styles.denied}>You don’t have admin access for this event.</Text>
        </View>
      </View>
    );
  }

  const post = () => {
    if (draft.trim().length === 0) return;
    postAnnouncement(draft.trim());
    setDraft('');
  };

  const unassigned = participants.filter((p) => !teamOf(p.id));
  const capacity = teamSize(event.gameStyle);

  return (
    <View style={styles.root}>
      <LinearGradient colors={['#203329', '#1b2a22']} style={StyleSheet.absoluteFill} />
      <Noise />
      <PageHeader title="event admin" subtitle={event.name} />
      <ScrollView
        contentContainerStyle={{
          paddingTop: insets.top + 54 + 22,
          paddingHorizontal: 20,
          paddingBottom: 60,
          gap: 24,
        }}
        showsVerticalScrollIndicator={false}>
        {/* Event details */}
        <View style={{ gap: 10 }}>
          <SectionLabel color={colors.link} size={10}>
            event
          </SectionLabel>
          <Pressable
            style={styles.rosterLink}
            onPress={() => router.push('/admin-event')}>
            <View style={{ flex: 1, gap: 5 }}>
              <Text style={styles.rosterLinkTitle}>EVENT DETAILS</Text>
              <Text style={styles.rosterLinkSub}>
                {event.courseName} · {event.teeTimes.length} tee times ·{' '}
                {event.courseMapUrl ? 'map added' : 'no map'}
              </Text>
            </View>
            <Text style={styles.rosterLinkArrow}>›</Text>
          </Pressable>
        </View>

        {/* Roster */}
        <View style={{ gap: 10 }}>
          <SectionLabel color={colors.link} size={10}>
            participants
          </SectionLabel>
          <Pressable
            style={styles.rosterLink}
            onPress={() => router.push('/admin-roster')}>
            <View style={{ flex: 1, gap: 5 }}>
              <Text style={styles.rosterLinkTitle}>ROSTER & INVITES</Text>
              <Text style={styles.rosterLinkSub}>
                {participants.length} on the list ·{' '}
                {participants.filter((p) => !p.claimed).length} yet to sign up
              </Text>
            </View>
            <Text style={styles.rosterLinkArrow}>›</Text>
          </Pressable>
        </View>

        {/* Game style */}
        <View style={{ gap: 10 }}>
          <SectionLabel color={colors.link} size={10}>
            game style
          </SectionLabel>
          <Text style={styles.hint}>
            Sets how the scorecard and leaderboard work for everyone in the event.
          </Text>
          {STYLES.map((style) => {
            const active = event.gameStyle === style;
            return (
              <Pressable
                key={style}
                onPress={() => setGameStyle(style)}
                style={[styles.option, active && styles.optionActive]}>
                <View style={{ flex: 1, gap: 5 }}>
                  <Text style={[styles.optionName, active && { color: colors.highlight }]}>
                    {GAME_STYLE_LABELS[style]}
                  </Text>
                  <Text style={styles.optionSub}>
                    {style === 'solo'
                      ? 'Every player keeps their own card'
                      : `One shared card per team of ${teamSize(style)}`}
                  </Text>
                </View>
                <View style={[styles.radio, active && styles.radioOn]} />
              </Pressable>
            );
          })}
        </View>

        {/* Announcement composer */}
        <View style={{ gap: 10 }}>
          <SectionLabel color={colors.link} size={10}>
            post an announcement
          </SectionLabel>
          <TextInput
            value={draft}
            onChangeText={setDraft}
            style={styles.composer}
            placeholder="Message to all participants…"
            placeholderTextColor="rgba(255,255,255,0.35)"
            multiline
            selectionColor={colors.highlight}
          />
          <ActionButton label="POST ANNOUNCEMENT" height={56} onPress={post} />
        </View>

        {/* Teams */}
        <View style={{ gap: 10 }}>
          <SectionLabel color={colors.link} size={10}>
            teams
          </SectionLabel>
          <Pressable
            style={styles.rosterLink}
            onPress={() => router.push('/admin-teams')}>
            <View style={{ flex: 1, gap: 5 }}>
              <Text style={styles.rosterLinkTitle}>MANAGE TEAMS</Text>
              <Text style={styles.rosterLinkSub}>
                {teams.length} teams · {unassigned.length} unassigned · capacity{' '}
                {capacity}
              </Text>
            </View>
            <Text style={styles.rosterLinkArrow}>›</Text>
          </Pressable>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#1b2a22',
  },
  denied: {
    fontFamily: fonts.regular,
    fontSize: 14,
    color: 'rgba(255,255,255,0.6)',
  },
  hint: {
    fontFamily: fonts.regular,
    fontSize: 12,
    color: 'rgba(255,255,255,0.45)',
  },
  rosterLink: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 16,
    backgroundColor: 'rgba(15,17,16,0.5)',
    borderWidth: 1,
    borderColor: 'rgba(123,255,178,0.2)',
  },
  rosterLinkTitle: {
    fontFamily: fonts.bold,
    fontSize: 13,
    color: colors.highlight,
  },
  rosterLinkSub: {
    fontFamily: fonts.regular,
    fontSize: 12,
    color: 'rgba(255,255,255,0.45)',
  },
  rosterLinkArrow: {
    fontSize: 22,
    color: 'rgba(255,255,255,0.5)',
  },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 16,
    backgroundColor: 'rgba(15,17,16,0.5)',
  },
  optionActive: {
    backgroundColor: 'rgba(20,28,23,0.9)',
  },
  optionName: {
    fontFamily: fonts.bold,
    fontSize: 13,
    color: '#ffffff',
  },
  optionSub: {
    fontFamily: fonts.regular,
    fontSize: 12,
    color: 'rgba(255,255,255,0.4)',
  },
  radio: {
    width: 16,
    height: 16,
    borderRadius: 8,
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.25)',
  },
  radioOn: {
    backgroundColor: colors.highlight,
    borderColor: colors.highlight,
  },
  composer: {
    backgroundColor: 'rgba(15,17,16,0.5)',
    padding: 16,
    minHeight: 96,
    fontFamily: fonts.regular,
    fontSize: 14,
    color: '#ffffff',
    textAlignVertical: 'top',
  },
});
