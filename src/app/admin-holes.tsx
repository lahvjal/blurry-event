import { LinearGradient } from 'expo-linear-gradient';
import * as ImagePicker from 'expo-image-picker';
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
import { apiExtractScorecard } from '@/lib/api';
import { useBrowserDefinitelyOffline } from '@/lib/offline/network';
import { useEvent } from '@/state/event';
import { Hole, TEE_PRESETS, TeeYardageSet } from '@/state/types';

type HoleDraft = { hole: number; par: string };

const cloneTeeSets = (tees: TeeYardageSet[]) =>
  tees.map((tee) => ({ ...tee, yardages: [...tee.yardages] }));

function draftFrom(holes: Hole[]): HoleDraft[] {
  return holes.map((hole) => ({ hole: hole.hole, par: String(hole.par) }));
}

function setsEqual(left: TeeYardageSet[], right: TeeYardageSet[]) {
  return left.length === right.length && left.every((tee, index) =>
    tee.name === right[index]?.name && tee.yardages.every((yards, hole) => yards === right[index]?.yardages[hole]),
  );
}

function NumberCell({ value, maxLength, style, onChange }: {
  value: string; maxLength: number; style: object; onChange: (next: string) => void;
}) {
  return <TextInput value={value} onChangeText={(text) => onChange(text.replace(/\D/g, '').slice(0, maxLength))}
    style={style} keyboardType="number-pad" selectTextOnFocus returnKeyType="done" selectionColor={colors.highlight} />;
}

export default function AdminHoles() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { event, me, updateScorecard } = useEvent();
  const offline = useBrowserDefinitelyOffline();
  const [draft, setDraft] = useState<HoleDraft[]>(() => draftFrom(event.holes));
  const [teeSets, setTeeSets] = useState<TeeYardageSet[]>(() => cloneTeeSets(event.teeYardageSets));
  const [selectedTee, setSelectedTee] = useState(event.teeYardageSets[0]?.name ?? event.teeColor);
  const [newTee, setNewTee] = useState('');
  const [saving, setSaving] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const eventIdRef = useRef(event.id);
  const eventHolesRef = useRef(event.holes);
  const eventTeeSetsRef = useRef(event.teeYardageSets);

  useEffect(() => {
    const switchedEvent = event.id !== eventIdRef.current;
    const hadLocalEdits = !setsEqual(teeSets, eventTeeSetsRef.current) ||
      JSON.stringify(draft) !== JSON.stringify(draftFrom(eventHolesRef.current));
    eventIdRef.current = event.id;
    eventHolesRef.current = event.holes;
    eventTeeSetsRef.current = event.teeYardageSets;
    if (switchedEvent || !hadLocalEdits) {
      setDraft(draftFrom(event.holes));
      setTeeSets(cloneTeeSets(event.teeYardageSets));
      setSelectedTee(event.teeYardageSets[0]?.name ?? event.teeColor);
    }
  }, [event.holes, event.id, event.teeColor, event.teeYardageSets]);

  const dirty = useMemo(() =>
    JSON.stringify(draft) !== JSON.stringify(draftFrom(event.holes)) || !setsEqual(teeSets, event.teeYardageSets),
  [draft, event.holes, event.teeYardageSets, teeSets]);
  const activeTee = teeSets.find((tee) => tee.name === selectedTee) ?? teeSets[0];

  if (!me.isAdmin) return <View style={styles.root}><LinearGradient colors={['#203329', '#1b2a22']} style={StyleSheet.absoluteFill} /><Noise /><PageHeader title="scorecard" /><View style={{ paddingTop: insets.top + 114, paddingHorizontal: 24 }}><Text style={styles.muted}>You don’t have admin access for this event.</Text></View></View>;
  if (offline) return <OfflineMutationScreen title="scorecard" description="Scanning and changing scorecard data requires a connection. Reconnect to edit or save the event scorecard." />;

  const patchPar = (holeNumber: number, par: string) => {
    setError(null);
    setDraft((current) => current.map((hole) => hole.hole === holeNumber ? { ...hole, par } : hole));
  };
  const patchYards = (holeNumber: number, yards: string) => {
    setError(null);
    setTeeSets((current) => current.map((tee) => tee.name !== activeTee?.name ? tee : {
      ...tee,
      yardages: tee.yardages.map((value, index) => index === holeNumber - 1 ? Number(yards) || 0 : value),
    }));
  };
  const discard = () => { setDraft(draftFrom(event.holes)); setTeeSets(cloneTeeSets(event.teeYardageSets)); setSelectedTee(event.teeYardageSets[0]?.name ?? event.teeColor); setError(null); };
  const handleBack = () => {
    if (!dirty) return router.back();
    const leave = () => router.back();
    if (Platform.OS === 'web' && typeof window !== 'undefined') { if (window.confirm('Discard scorecard changes?')) leave(); return; }
    Alert.alert('Discard changes?', 'Your scorecard edits have not been saved.', [{ text: 'Keep editing', style: 'cancel' }, { text: 'Discard', style: 'destructive', onPress: leave }]);
  };
  const addTee = () => {
    const name = newTee.trim();
    if (!name) return;
    if (teeSets.some((tee) => tee.name.toLowerCase() === name.toLowerCase())) { setError(`${name} is already on this scorecard.`); return; }
    const base = activeTee?.yardages ?? event.holes.map((hole) => hole.yards);
    setTeeSets((current) => [...current, { name, yardages: [...base] }]); setSelectedTee(name); setNewTee('');
  };
  const removeSelectedTee = () => {
    if (teeSets.length <= 1 || !activeTee) return;
    const next = teeSets.filter((tee) => tee.name !== activeTee.name);
    setTeeSets(next); setSelectedTee(next[0]?.name ?? event.teeColor);
  };
  const scan = async (source: 'camera' | 'library') => {
    if (scanning) return;
    setError(null);
    try {
      if (source === 'camera') {
        const permission = await ImagePicker.requestCameraPermissionsAsync();
        if (!permission.granted) throw new Error('Camera access is needed to photograph the course scorecard.');
      }
      const result = source === 'camera'
        ? await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.9, base64: true, cameraType: ImagePicker.CameraType.back })
        : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.9, base64: true });
      if (result.canceled || !result.assets?.[0]) return;
      const image = result.assets[0];
      if (!image.base64) throw new Error('That image could not be prepared for scanning. Please choose a JPG or PNG scorecard photo.');
      setScanning(true);
      const extracted = await apiExtractScorecard({ eventId: event.id, imageBase64: image.base64, mimeType: image.mimeType === 'image/png' ? 'image/png' : 'image/jpeg' });
      if (extracted.holes.length !== 18 || extracted.teeSets.length === 0) throw new Error('The scan did not find a complete 18-hole scorecard. Try a brighter, straight-on photo.');
      setDraft(extracted.holes.sort((a, b) => a.hole - b.hole).map((hole) => ({ hole: hole.hole, par: String(hole.par) })));
      setTeeSets(cloneTeeSets(extracted.teeSets));
      setSelectedTee(extracted.teeSets[0].name);
      setError(extracted.notes.length ? `Review the highlighted scan results: ${extracted.notes.join(' ')}` : 'Scan complete — review every par and tee yardage, then save.');
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'The scorecard scan could not be completed.'); }
    finally { setScanning(false); }
  };
  const chooseScanSource = () => {
    if (Platform.OS === 'web' && typeof window !== 'undefined') { void scan('library'); return; }
    Alert.alert('Scan course scorecard', 'Use a bright, straight-on photo that includes every hole and tee colour.', [{ text: 'Take photo', onPress: () => void scan('camera') }, { text: 'Choose from library', onPress: () => void scan('library') }, { text: 'Cancel', style: 'cancel' }]);
  };
  const save = async () => {
    if (saving || !activeTee) return;
    for (const tee of teeSets) {
      if (!tee.name.trim()) return setError('Every tee set needs a name.');
      for (let index = 0; index < 18; index += 1) {
        const yards = tee.yardages[index];
        if (!Number.isInteger(yards) || yards < 50 || yards > 900) {
          return setError(`${tee.name} needs a yardage from 50 to 900 on Hole ${index + 1}.`);
        }
      }
    }
    const eventTee = teeSets.find((tee) => tee.name.toLowerCase() === event.teeColor.toLowerCase()) ?? activeTee;
    const holes: Hole[] = [];
    for (const item of draft) {
      const par = Number(item.par); const yards = eventTee.yardages[item.hole - 1];
      if (!Number.isInteger(par) || par < 3 || par > 6) return setError(`Hole ${item.hole} needs a par from 3 to 6.`);
      holes.push({ hole: item.hole, par, yards });
    }
    setSaving(true); setError(null);
    const saved = await updateScorecard(holes, teeSets);
    setSaving(false);
    if (saved) router.back(); else setError('The scorecard was not saved. Check your connection and admin access.');
  };
  const holeRows = (range: HoleDraft[]) => range.map((hole) => <View key={hole.hole} style={styles.holeRow}><Text style={styles.holeNumber}>{hole.hole}</Text><NumberCell value={hole.par} maxLength={1} style={styles.parInput} onChange={(par) => patchPar(hole.hole, par)} /><NumberCell value={String(activeTee?.yardages[hole.hole - 1] || '')} maxLength={3} style={styles.yardsInput} onChange={(yards) => patchYards(hole.hole, yards)} /></View>);
  const total = (range: HoleDraft[]) => ({ par: range.reduce((sum, hole) => sum + (Number(hole.par) || 0), 0), yards: range.reduce((sum, hole) => sum + (activeTee?.yardages[hole.hole - 1] || 0), 0) });
  const totalRow = (label: string, range: HoleDraft[]) => { const values = total(range); return <View style={styles.totalRow}><Text style={styles.totalLabel}>{label}</Text><Text style={styles.totalPar}>{values.par}</Text><Text style={styles.totalYards}>{values.yards.toLocaleString()}</Text></View>; };
  const front = draft.slice(0, 9); const back = draft.slice(9);

  return <View style={styles.root}><LinearGradient colors={['#203329', '#1b2a22']} style={StyleSheet.absoluteFill} /><Noise /><PageHeader title="scorecard" subtitle={dirty ? 'UNSAVED CHANGES' : event.courseName} onBack={handleBack} />
    <ScrollView contentContainerStyle={{ paddingTop: insets.top + 76, paddingHorizontal: 20, paddingBottom: dirty ? 140 : 60 }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
      <Text style={styles.hint}>Add a course scorecard photo to read pars and tee yardages, then review the result before saving. Each tee color keeps its own 18-hole yardage card.</Text>
      <Pressable accessibilityRole="button" accessibilityLabel="Scan course scorecard" onPress={chooseScanSource} disabled={scanning} style={[styles.scanButton, scanning && styles.buttonDisabled]}><Text style={styles.scanLabel}>{scanning ? 'SCANNING SCORECARD…' : 'SCAN / UPLOAD SCORECARD'}</Text><Text style={styles.scanHint}>{scanning ? 'Reading pars and tee-color yardages' : 'Take a photo or choose one from your library'}</Text></Pressable>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <Text style={styles.teeLabel}>TEE YARDAGES</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.teeChips}>{teeSets.map((tee) => <Pressable key={tee.name} accessibilityRole="button" accessibilityState={{ selected: tee.name === activeTee?.name }} onPress={() => setSelectedTee(tee.name)} style={[styles.teeChip, tee.name === activeTee?.name && styles.teeChipActive]}><Text style={[styles.teeChipText, tee.name === activeTee?.name && styles.teeChipTextActive]}>{tee.name.toUpperCase()}</Text></Pressable>)}</ScrollView>
      <View style={styles.addTeeRow}><TextInput value={newTee} onChangeText={setNewTee} placeholder="Add tee color" placeholderTextColor="rgba(255,255,255,0.36)" style={styles.teeInput} /><Pressable onPress={addTee} style={styles.addTeeButton}><Text style={styles.addTeeText}>ADD</Text></Pressable>{teeSets.length > 1 ? <Pressable onPress={removeSelectedTee} style={styles.removeTeeButton}><Text style={styles.removeTeeText}>REMOVE {activeTee?.name?.toUpperCase()}</Text></Pressable> : null}</View>
      <Text style={styles.presetHint}>Quick add: {TEE_PRESETS.filter((preset) => !teeSets.some((tee) => tee.name.toLowerCase() === preset.name.toLowerCase())).map((preset) => preset.name).join(' · ') || 'all common tees added'}</Text>
      <View style={styles.headerRow}><Text style={styles.headerHole}>HOLE</Text><Text style={styles.headerPar}>PAR</Text><Text style={styles.headerYards}>{activeTee?.name?.toUpperCase() || 'YARDS'}</Text></View>
      <View style={styles.table}>{holeRows(front)}{totalRow('OUT', front)}{holeRows(back)}{totalRow('IN', back)}{totalRow('TOTAL', draft)}</View>
    </ScrollView>
    {dirty ? <View style={[styles.saveBar, { paddingBottom: insets.bottom + 12 }]}><Pressable style={[styles.discardButton, saving && styles.buttonDisabled]} disabled={saving} onPress={discard}><Text style={styles.discardText}>DISCARD</Text></Pressable><Pressable style={[styles.saveButton, saving && styles.buttonDisabled]} disabled={saving} onPress={() => void save()}><Text style={styles.saveText}>{saving ? 'SAVING…' : 'SAVE SCORECARD'}</Text></Pressable></View> : null}
  </View>;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#1b2a22' }, muted: { fontFamily: fonts.regular, fontSize: 13, color: 'rgba(255,255,255,0.45)' }, hint: { fontFamily: fonts.regular, fontSize: 12, lineHeight: 18, color: 'rgba(255,255,255,0.55)', marginBottom: 14 }, error: { fontFamily: fonts.medium, fontSize: 12, lineHeight: 17, color: '#ffcf8b', marginTop: 14 },
  scanButton: { backgroundColor: 'rgba(123,255,178,0.13)', borderWidth: 1, borderColor: 'rgba(123,255,178,0.45)', padding: 17, marginBottom: 18 }, scanLabel: { fontFamily: fonts.bold, fontSize: 12, letterSpacing: 1.3, color: colors.highlight }, scanHint: { fontFamily: fonts.regular, fontSize: 11, color: 'rgba(255,255,255,0.57)', marginTop: 5 },
  teeLabel: { marginTop: 18, fontFamily: fonts.bold, fontSize: 10, letterSpacing: 1.2, color: 'rgba(255,255,255,0.43)' }, teeChips: { gap: 8, paddingVertical: 10 }, teeChip: { minHeight: 38, paddingHorizontal: 14, justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.24)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' }, teeChipActive: { backgroundColor: 'rgba(123,255,178,0.17)', borderColor: colors.highlight }, teeChipText: { fontFamily: fonts.bold, fontSize: 10, color: 'rgba(255,255,255,0.58)' }, teeChipTextActive: { color: colors.highlight },
  addTeeRow: { flexDirection: 'row', gap: 8, alignItems: 'center' }, teeInput: { flex: 1, height: 42, paddingHorizontal: 12, color: '#fff', backgroundColor: 'rgba(0,0,0,0.22)', fontFamily: fonts.medium, fontSize: 13 }, addTeeButton: { height: 42, paddingHorizontal: 17, justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.12)' }, addTeeText: { fontFamily: fonts.bold, fontSize: 10, color: '#fff' }, removeTeeButton: { minHeight: 42, justifyContent: 'center', paddingHorizontal: 8 }, removeTeeText: { fontFamily: fonts.bold, fontSize: 9, color: '#ffcf8b' }, presetHint: { fontFamily: fonts.regular, fontSize: 10, lineHeight: 15, color: 'rgba(255,255,255,0.34)', marginTop: 8, marginBottom: 16 },
  headerRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingBottom: 8 }, headerHole: { flex: 1, fontFamily: fonts.bold, fontSize: 9, color: 'rgba(255,255,255,0.4)' }, headerPar: { width: 64, textAlign: 'center', fontFamily: fonts.bold, fontSize: 9, color: 'rgba(255,255,255,0.4)' }, headerYards: { width: 80, textAlign: 'center', fontFamily: fonts.bold, fontSize: 9, color: 'rgba(255,255,255,0.4)' },
  table: { backgroundColor: 'rgba(15,17,16,0.4)' }, holeRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 6, gap: 8, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.04)' }, holeNumber: { flex: 1, fontFamily: fonts.serif, fontSize: 22, color: '#fff' }, parInput: { width: 64, height: 40, backgroundColor: 'rgba(0,0,0,0.3)', textAlign: 'center', fontFamily: fonts.bold, fontSize: 15, color: '#fff' }, yardsInput: { width: 80, height: 40, backgroundColor: 'rgba(0,0,0,0.3)', textAlign: 'center', fontFamily: fonts.bold, fontSize: 15, color: '#fff' },
  totalRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 14, gap: 8, backgroundColor: 'rgba(0,0,0,0.25)' }, totalLabel: { flex: 1, fontFamily: fonts.bold, fontSize: 12, color: colors.highlight }, totalPar: { width: 64, textAlign: 'center', fontFamily: fonts.bold, fontSize: 14, color: '#fff' }, totalYards: { width: 80, textAlign: 'center', fontFamily: fonts.bold, fontSize: 14, color: '#fff' },
  saveBar: { position: 'absolute', left: 0, right: 0, bottom: 0, flexDirection: 'row', gap: 10, paddingHorizontal: 20, paddingTop: 12, backgroundColor: 'rgba(9,12,10,0.96)', borderTopWidth: 1, borderTopColor: 'rgba(123,255,178,0.2)' }, discardButton: { width: 110, height: 52, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.07)' }, discardText: { fontFamily: fonts.bold, fontSize: 11, color: 'rgba(255,255,255,0.7)' }, saveButton: { flex: 1, height: 52, alignItems: 'center', justifyContent: 'center', backgroundColor: '#34a468' }, saveText: { fontFamily: fonts.bold, fontSize: 12, color: '#0d1a12' }, buttonDisabled: { opacity: 0.55 },
});
