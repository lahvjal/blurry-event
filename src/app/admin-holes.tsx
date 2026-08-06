import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
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
import { Noise } from '@/components/ui';
import { colors, fonts } from '@/constants/theme';
import { useBrowserDefinitelyOffline } from '@/lib/offline/network';
import { useEvent } from '@/state/event';
import { Hole } from '@/state/types';

type HoleDraft = {
  hole: number;
  par: string;
  yards: string;
};

function draftFrom(holes: Hole[]): HoleDraft[] {
  return holes.map((hole) => ({
    hole: hole.hole,
    par: String(hole.par),
    yards: String(hole.yards),
  }));
}

function draftsEqual(left: HoleDraft[], right: HoleDraft[]): boolean {
  return (
    left.length === right.length &&
    left.every(
      (hole, index) =>
        hole.hole === right[index]?.hole &&
        hole.par === right[index]?.par &&
        hole.yards === right[index]?.yards,
    )
  );
}

function NumberCell({
  value,
  maxLength,
  style,
  onChange,
}: {
  value: string;
  maxLength: number;
  style: object;
  onChange: (next: string) => void;
}) {
  return (
    <TextInput
      value={value}
      onChangeText={(text) =>
        onChange(text.replace(/\D/g, '').slice(0, maxLength))
      }
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
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { event, me, updateScorecard } = useEvent();
  const offline = useBrowserDefinitelyOffline();
  const [draft, setDraft] = useState<HoleDraft[]>(() => draftFrom(event.holes));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const eventIdRef = useRef(event.id);
  const eventHolesRef = useRef(event.holes);

  // The provider initially holds an offline/demo snapshot and may replace it
  // with the focused server event after this screen mounts. Adopt that newer
  // scorecard unless the admin has already started editing the prior one.
  useEffect(() => {
    const previousEventId = eventIdRef.current;
    const previousEventHoles = eventHolesRef.current;
    eventIdRef.current = event.id;
    eventHolesRef.current = event.holes;

    setDraft((current) => {
      const switchedEvent = event.id !== previousEventId;
      const hadLocalEdits = !draftsEqual(current, draftFrom(previousEventHoles));
      return switchedEvent || !hadLocalEdits ? draftFrom(event.holes) : current;
    });
  }, [event.holes, event.id]);

  const dirty = useMemo(
    () => !draftsEqual(draft, draftFrom(event.holes)),
    [draft, event.holes],
  );

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

  if (offline) {
    return (
      <OfflineMutationScreen
        title="scorecard"
        description="Changing hole pars and yardages requires a connection. Reconnect to edit or save the event scorecard."
      />
    );
  }

  const patchHole = (
    holeNumber: number,
    patch: Partial<Pick<HoleDraft, 'par' | 'yards'>>,
  ) => {
    setError(null);
    setDraft((current) =>
      current.map((hole) =>
        hole.hole === holeNumber ? { ...hole, ...patch } : hole,
      ),
    );
  };

  const discard = () => {
    setDraft(draftFrom(event.holes));
    setError(null);
  };

  const handleBack = () => {
    if (!dirty) {
      router.back();
      return;
    }

    const leave = () => router.back();
    const message = 'Your scorecard edits have not been saved.';
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      if (window.confirm(`Discard changes?\n\n${message}`)) leave();
      return;
    }
    Alert.alert('Discard changes?', message, [
      { text: 'Keep editing', style: 'cancel' },
      { text: 'Discard', style: 'destructive', onPress: leave },
    ]);
  };

  const save = async () => {
    if (saving) return;

    const holes: Hole[] = [];
    for (const hole of draft) {
      const par = Number(hole.par);
      const yards = Number(hole.yards);
      if (!Number.isInteger(par) || par < 3 || par > 6) {
        setError(`Hole ${hole.hole} needs a par from 3 to 6.`);
        return;
      }
      if (!Number.isInteger(yards) || yards < 50 || yards > 900) {
        setError(`Hole ${hole.hole} needs a yardage from 50 to 900.`);
        return;
      }
      holes.push({ hole: hole.hole, par, yards });
    }

    setSaving(true);
    setError(null);
    const saved = await updateScorecard(holes);
    setSaving(false);
    if (saved) {
      router.back();
    } else {
      setError('The scorecard was not saved. Check your connection and admin access.');
    }
  };

  const front = draft.slice(0, 9);
  const back = draft.slice(9);
  const holesForTotals = (holes: HoleDraft[]): Hole[] =>
    holes.map((hole) => ({
      hole: hole.hole,
      par: Number(hole.par) || 0,
      yards: Number(hole.yards) || 0,
    }));

  const renderHole = (hole: HoleDraft) => (
    <View key={hole.hole} style={styles.holeRow}>
      <Text style={styles.holeNumber}>{hole.hole}</Text>
      {/* Par is range-guarded so a typo can't make it 0 and skew every
          to-par figure on the leaderboard. */}
      <NumberCell
        value={hole.par}
        maxLength={1}
        style={styles.parInput}
        onChange={(par) => patchHole(hole.hole, { par })}
      />
      <NumberCell
        value={hole.yards}
        maxLength={3}
        style={styles.yardsInput}
        onChange={(yards) => patchHole(hole.hole, { yards })}
      />
    </View>
  );

  return (
    <View style={styles.root}>
      <LinearGradient colors={['#203329', '#1b2a22']} style={StyleSheet.absoluteFill} />
      <Noise />
      <PageHeader
        title="scorecard"
        subtitle={dirty ? 'UNSAVED CHANGES' : event.courseName}
        onBack={handleBack}
      />
      <ScrollView
        contentContainerStyle={{
          paddingTop: insets.top + 54 + 22,
          paddingHorizontal: 20,
          paddingBottom: dirty ? 140 : 60,
        }}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled">
        <Text style={styles.hint}>
          Par and yardage for each hole. These drive the score dial, the OUT/IN
          totals, and every to-par figure on the leaderboard.
        </Text>
        {error ? <Text style={styles.error}>{error}</Text> : null}

        <View style={styles.headerRow}>
          <Text style={styles.headerHole}>HOLE</Text>
          <Text style={styles.headerPar}>PAR</Text>
          <Text style={styles.headerYards}>YARDS</Text>
        </View>

        <View style={styles.table}>
          {front.map(renderHole)}
          <Totals label="OUT" holes={holesForTotals(front)} />
          {back.map(renderHole)}
          <Totals label="IN" holes={holesForTotals(back)} />
          <Totals label="TOTAL" holes={holesForTotals(draft)} />
        </View>
      </ScrollView>
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
            onPress={() => void save()}>
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
    marginBottom: 16,
  },
  error: {
    fontFamily: fonts.medium,
    fontSize: 12,
    lineHeight: 17,
    color: '#ffcf8b',
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
