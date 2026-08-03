import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { FloatingNav } from '@/components/floating-nav';
import { PageHeader } from '@/components/page-header';
import { ScoreDial } from '@/components/score-dial';
import { Chevron, GradientPanel, Noise } from '@/components/ui';
import { colors, fonts } from '@/constants/theme';
import { useEvent } from '@/state/event';

const teeIcon = require('@/assets/figma/tee-icon.svg');

export default function ScoreInput() {
  const router = useRouter();
  const params = useLocalSearchParams<{ hole?: string | string[] }>();
  const insets = useSafeAreaInsets();
  const { event, myScores, currentHoleIndex, setScore } = useEvent();
  const rawHole = Array.isArray(params.hole) ? params.hole[0] : params.hole;
  const requestedHole = rawHole ? Number(rawHole) - 1 : Number.NaN;
  const currentHole =
    Number.isInteger(requestedHole) && requestedHole >= 0 && requestedHole < 18
      ? requestedHole
      : currentHoleIndex;
  const hole = event.holes[currentHole];
  const par = hole.par;
  const [value, setValue] = useState(myScores[currentHole] ?? par);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const toPar = value - par;
  const toParLabel = toPar === 0 ? 'E' : toPar > 0 ? `+${toPar}` : `${toPar}`;

  // The nav grows with the home indicator, so a fixed offset here would sit on
  // top of it on a notched phone. Mirrors FloatingNav's own inset, plus the bar
  // and a gap.
  const CTA_HEIGHT = 102;
  const aboveNav = Math.max(20, insets.bottom + 12) + 72 + 10;

  const save = async () => {
    if (saving) return;
    const finishesRound =
      myScores[currentHole] === null &&
      myScores.filter((score) => score === null).length === 1;
    setSaving(true);
    setSaveError(null);
    try {
      await setScore(currentHole, value);
      if (finishesRound) {
        router.replace('/complete-round');
      } else {
        router.back();
      }
    } catch (error) {
      const message =
        (error as { message?: string }).message ??
        'This score could not be saved on your device. Try again.';
      setSaveError(message);
      Alert.alert("Score wasn't saved", message);
      setSaving(false);
    }
  };

  return (
    <View style={styles.root}>
      <Noise />
      <PageHeader title="score card" subtitle={event.courseName} />
      <View
        style={[
          styles.content,
          { paddingTop: insets.top + 54 + 10, paddingBottom: aboveNav + CTA_HEIGHT },
        ]}>
        {/* Hole stats */}
        <View style={styles.statsBlock}>
          <View style={styles.statsRow}>
            <View style={styles.stat}>
              <Text style={styles.statLabel}>Hole</Text>
              <Text style={styles.statValue}>{currentHole + 1}</Text>
            </View>
            <View style={styles.stat}>
              <Text style={styles.statLabel}>par</Text>
              <Text style={styles.statValue}>{par}</Text>
            </View>
            <View style={styles.stat}>
              <Text style={styles.statLabel}>yards</Text>
              <Text style={styles.statValue}>{hole.yards}</Text>
            </View>
          </View>
          <View style={styles.teeSelector}>
            <View style={styles.teeRow}>
              <LinearGradient
                colors={['rgba(115,115,115,0)', '#898b8a']}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={styles.teeLine}
              />
              <Text style={styles.statLabel}>{event.teeColor}</Text>
              <LinearGradient
                colors={['#898b8a', 'rgba(115,115,115,0)']}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={styles.teeLine}
              />
            </View>
            <Image
              source={teeIcon}
              style={{ width: 9.4, height: 8.5 }}
              contentFit="contain"
            />
          </View>
          <View style={styles.prevChevron}>
            <Chevron width={7} height={14} color="rgba(255,255,255,0.4)" />
          </View>
          <View style={styles.nextChevron}>
            <Chevron width={7} height={14} color="rgba(255,255,255,0.4)" />
          </View>
        </View>

        {/* Score picker. The dial spans the full width so the swipe can start
            anywhere; the label and to-par float over it and stay out of the
            way of the gesture. */}
        <View style={styles.picker}>
          <ScoreDial initial={myScores[currentHole] ?? par} onChange={setValue} />
          <View style={styles.sideLabelBox} pointerEvents="none">
            <Text style={styles.sideLabel}>score</Text>
          </View>
          <Text style={styles.toPar} pointerEvents="none">
            {toParLabel}
          </Text>
        </View>

      </View>

      <FloatingNav />

      {/* After the nav on purpose. The nav's scrim fades scrolling content
          toward the bottom edge, and the one button that commits a score has
          no business being blurred — painting it later keeps it crisp. It sits
          clear of the bar, so nothing is covered. */}
      {saveError ? (
        <Text
          style={[
            styles.saveError,
            { bottom: aboveNav + CTA_HEIGHT + 8 },
          ]}>
          {saveError}
        </Text>
      ) : null}
      <Pressable
        disabled={saving}
        onPress={() => void save()}
        style={[
          styles.ctaFixed,
          { bottom: aboveNav },
          saving && styles.ctaDisabled,
        ]}>
        <GradientPanel colors={colors.gradCta} style={styles.cta}>
          <Text style={styles.ctaText}>
            {saving
              ? 'saving on device…'
              : myScores[currentHole] === null
                ? 'save score'
                : 'save correction'}
          </Text>
          <Chevron />
        </GradientPanel>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  content: {
    flex: 1,
    // paddingBottom is set inline — it reserves room for the positioned CTA
    // and the nav, both of which depend on the safe-area inset.
  },
  statsBlock: {
    paddingHorizontal: 80,
    paddingTop: 30,
    paddingBottom: 10,
    gap: 20,
    borderBottomWidth: 1,
    borderBottomColor: '#191b1a',
  },
  statsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  stat: {
    alignItems: 'center',
    gap: 14,
  },
  statLabel: {
    fontFamily: fonts.bold,
    fontSize: 10,
    color: 'rgba(255,255,255,0.5)',
    textTransform: 'uppercase',
  },
  statValue: {
    fontFamily: fonts.serif,
    fontSize: 30,
    color: '#ffffff',
  },
  teeSelector: {
    alignItems: 'center',
    gap: 8,
  },
  teeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    alignSelf: 'stretch',
  },
  teeLine: {
    flex: 1,
    height: 2,
  },
  prevChevron: {
    position: 'absolute',
    left: 20,
    top: '50%',
    transform: [{ scaleX: -1 }],
  },
  nextChevron: {
    position: 'absolute',
    right: 20,
    top: '50%',
  },
  picker: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sideLabelBox: {
    position: 'absolute',
    left: 30,
    width: 13,
    height: 80,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sideLabel: {
    fontFamily: fonts.regular,
    fontSize: 11,
    color: 'rgba(255,255,255,0.5)',
    textTransform: 'uppercase',
    letterSpacing: 6.6,
    transform: [{ rotate: '-90deg' }],
    width: 90,
    textAlign: 'center',
  },
  toPar: {
    position: 'absolute',
    right: 40,
    fontFamily: fonts.serif,
    fontSize: 30,
    color: '#ffffff',
  },
  /** Parked just above the nav; `bottom` is set inline from the safe area. */
  ctaFixed: {
    position: 'absolute',
    left: 0,
    right: 0,
  },
  ctaDisabled: {
    opacity: 0.7,
  },
  cta: {
    height: 102,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 30,
  },
  ctaText: {
    fontFamily: fonts.bold,
    fontSize: 16,
    color: '#ffffff',
    textTransform: 'uppercase',
  },
  saveError: {
    position: 'absolute',
    left: 24,
    right: 24,
    zIndex: 3,
    color: '#ffcf8b',
    fontFamily: fonts.bold,
    fontSize: 11,
    textAlign: 'center',
  },
});
