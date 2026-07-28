import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
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
  const insets = useSafeAreaInsets();
  const { event, currentHoleIndex, setScore } = useEvent();
  const currentHole = currentHoleIndex;
  const hole = event.holes[currentHole];
  const par = hole.par;
  const [value, setValue] = useState(par);

  const toPar = value - par;
  const toParLabel = toPar === 0 ? 'E' : toPar > 0 ? `+${toPar}` : `${toPar}`;

  const save = () => {
    setScore(currentHole, value);
    if (currentHole === 17) {
      router.replace('/complete-round');
    } else {
      router.back();
    }
  };

  return (
    <View style={styles.root}>
      <Noise />
      <PageHeader title="score card" subtitle={event.courseName} />
      <View style={[styles.content, { paddingTop: insets.top + 54 + 10 }]}>
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

        {/* Score picker */}
        <View style={styles.picker}>
          <View style={styles.pickerCenter}>
            <View style={styles.sideLabelBox}>
              <Text style={styles.sideLabel}>score</Text>
            </View>
            <ScoreDial initial={par} onChange={setValue} />
            <Text style={styles.toPar}>{toParLabel}</Text>
          </View>
        </View>

        {/* CTA */}
        <Pressable onPress={save}>
          <GradientPanel colors={colors.gradCta} style={styles.cta}>
            <Text style={styles.ctaText}>save score</Text>
            <Chevron />
          </GradientPanel>
        </Pressable>
      </View>
      <FloatingNav />
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
    paddingBottom: 105,
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
  pickerCenter: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 60,
  },
  sideLabelBox: {
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
    fontFamily: fonts.serif,
    fontSize: 30,
    color: '#ffffff',
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
});
