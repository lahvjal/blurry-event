import { LinearGradient } from 'expo-linear-gradient';
import React, { useEffect, useState } from 'react';
import {
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { PageHeader } from '@/components/page-header';
import { Noise } from '@/components/ui';
import { colors, fonts } from '@/constants/theme';
import { useEvent } from '@/state/event';
import { Hole } from '@/state/types';

/**
 * Numeric cell backed by a local draft.
 *
 * Committing on every keystroke doesn't work here: the field holds a single
 * digit, so once it has focus there's nothing to type into and every keystroke
 * gets dropped. Instead the draft is free-form while editing and only validated
 * and committed on blur, reverting if it's out of range.
 */
function NumberCell({
  value,
  min,
  max,
  maxLength,
  style,
  onCommit,
}: {
  value: number;
  min: number;
  max: number;
  maxLength: number;
  style: object;
  onCommit: (next: number) => void;
}) {
  const [draft, setDraft] = useState(String(value));

  // Keep in step when the value changes elsewhere (e.g. a reset).
  useEffect(() => {
    setDraft(String(value));
  }, [value]);

  const commit = () => {
    const parsed = Number(draft);
    if (draft !== '' && Number.isFinite(parsed) && parsed >= min && parsed <= max) {
      if (parsed !== value) onCommit(parsed);
    } else {
      setDraft(String(value));
    }
  };

  return (
    <TextInput
      value={draft}
      onChangeText={(text) => setDraft(text.replace(/\D/g, '').slice(0, maxLength))}
      onBlur={commit}
      onEndEditing={commit}
      style={style}
      keyboardType="number-pad"
      selectTextOnFocus
      returnKeyType="done"
      selectionColor={colors.highlight}
    />
  );
}

function Totals({ label, holes }: { label: string; holes: Hole[] }) {
  const par = holes.reduce((total, h) => total + h.par, 0);
  const yards = holes.reduce((total, h) => total + h.yards, 0);
  return (
    <View style={styles.totalRow}>
      <Text style={styles.totalLabel}>{label}</Text>
      <Text style={styles.totalPar}>{par}</Text>
      <Text style={styles.totalYards}>{yards.toLocaleString()}</Text>
    </View>
  );
}

export default function AdminHoles() {
  const insets = useSafeAreaInsets();
  const { event, me, updateHole } = useEvent();

  if (!me.isAdmin) {
    return (
      <View style={styles.root}>
        <LinearGradient colors={['#203329', '#1b2a22']} style={StyleSheet.absoluteFill} />
        <Noise />
        <PageHeader title="scorecard" />
        <View style={{ paddingTop: insets.top + 114, paddingHorizontal: 24 }}>
          <Text style={styles.muted}>You don’t have admin access for this event.</Text>
        </View>
      </View>
    );
  }

  const front = event.holes.slice(0, 9);
  const back = event.holes.slice(9);

  const renderHole = (hole: Hole) => (
    <View key={hole.hole} style={styles.holeRow}>
      <Text style={styles.holeNumber}>{hole.hole}</Text>
      {/* Par is range-guarded so a typo can't make it 0 and skew every
          to-par figure on the leaderboard. */}
      <NumberCell
        value={hole.par}
        min={3}
        max={6}
        maxLength={1}
        style={styles.parInput}
        onCommit={(par) => updateHole(hole.hole, { par })}
      />
      <NumberCell
        value={hole.yards}
        min={50}
        max={900}
        maxLength={3}
        style={styles.yardsInput}
        onCommit={(yards) => updateHole(hole.hole, { yards })}
      />
    </View>
  );

  return (
    <View style={styles.root}>
      <LinearGradient colors={['#203329', '#1b2a22']} style={StyleSheet.absoluteFill} />
      <Noise />
      <PageHeader title="scorecard" subtitle={event.courseName} />
      <ScrollView
        contentContainerStyle={{
          paddingTop: insets.top + 54 + 22,
          paddingHorizontal: 20,
          paddingBottom: 60,
        }}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled">
        <Text style={styles.hint}>
          Par and yardage for each hole. These drive the score dial, the OUT/IN
          totals, and every to-par figure on the leaderboard.
        </Text>

        <View style={styles.headerRow}>
          <Text style={styles.headerHole}>HOLE</Text>
          <Text style={styles.headerPar}>PAR</Text>
          <Text style={styles.headerYards}>YARDS</Text>
        </View>

        <View style={styles.table}>
          {front.map(renderHole)}
          <Totals label="OUT" holes={front} />
          {back.map(renderHole)}
          <Totals label="IN" holes={back} />
          <Totals label="TOTAL" holes={event.holes} />
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
    marginBottom: 16,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingBottom: 8,
  },
  headerHole: {
    flex: 1,
    fontFamily: fonts.bold,
    fontSize: 9,
    color: 'rgba(255,255,255,0.4)',
  },
  headerPar: {
    width: 64,
    textAlign: 'center',
    fontFamily: fonts.bold,
    fontSize: 9,
    color: 'rgba(255,255,255,0.4)',
  },
  headerYards: {
    width: 80,
    textAlign: 'center',
    fontFamily: fonts.bold,
    fontSize: 9,
    color: 'rgba(255,255,255,0.4)',
  },
  table: {
    backgroundColor: 'rgba(15,17,16,0.4)',
  },
  holeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 6,
    gap: 8,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.04)',
  },
  holeNumber: {
    flex: 1,
    fontFamily: fonts.serif,
    fontSize: 22,
    color: '#ffffff',
  },
  parInput: {
    width: 64,
    height: 40,
    backgroundColor: 'rgba(0,0,0,0.3)',
    textAlign: 'center',
    fontFamily: fonts.bold,
    fontSize: 15,
    color: '#ffffff',
  },
  yardsInput: {
    width: 80,
    height: 40,
    backgroundColor: 'rgba(0,0,0,0.3)',
    textAlign: 'center',
    fontFamily: fonts.bold,
    fontSize: 15,
    color: '#ffffff',
  },
  totalRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 14,
    gap: 8,
    backgroundColor: 'rgba(0,0,0,0.25)',
  },
  totalLabel: {
    flex: 1,
    fontFamily: fonts.bold,
    fontSize: 12,
    color: colors.highlight,
  },
  totalPar: {
    width: 64,
    textAlign: 'center',
    fontFamily: fonts.bold,
    fontSize: 14,
    color: '#ffffff',
  },
  totalYards: {
    width: 80,
    textAlign: 'center',
    fontFamily: fonts.bold,
    fontSize: 14,
    color: '#ffffff',
  },
});
