import { LinearGradient } from 'expo-linear-gradient';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { PageHeader } from '@/components/page-header';
import { ParticipantAvatar } from '@/components/participant-avatar';
import { SearchField } from '@/components/search-field';
import { Noise } from '@/components/ui';
import { colors, fonts } from '@/constants/theme';
import { addConversationMembers, createGroupConversation } from '@/lib/chat';
import { useConversationDetail } from '@/state/chat';
import { useEvent } from '@/state/event';

export default function CreateGroup() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { event, participants, me } = useEvent();
  // With `add`, the same picker adds people to a group that already exists.
  const params = useLocalSearchParams<{ add?: string }>();
  const addingTo = params.add ?? null;

  const { conversation } = useConversationDetail(addingTo);
  const [name, setName] = useState('');
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const alreadyIn = conversation?.memberIds ?? [];
  const term = query.trim().toLowerCase();
  const candidates = participants.filter(
    (player) => player.id !== me.id && !alreadyIn.includes(player.id),
  );
  const filtered = term
    ? candidates.filter((player) => player.fullName.toLowerCase().includes(term))
    : candidates;

  const toggle = (id: string) =>
    setSelected((prev) =>
      prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id],
    );

  const ready = addingTo
    ? selected.length > 0
    : name.trim().length > 0 && selected.length > 0;

  const submit = async () => {
    if (!ready || busy) return;
    setBusy(true);
    setError(null);
    try {
      if (addingTo) {
        await addConversationMembers(addingTo, selected);
        router.back();
        return;
      }
      const id = await createGroupConversation(event.id, name, selected);
      // Replace so Back returns to the inbox rather than this form.
      router.replace({ pathname: '/group-conversation', params: { id } });
    } catch (caught) {
      setError((caught as { message?: string })?.message ?? 'Could not save that.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.root}>
      <Noise />
      <PageHeader title={addingTo ? 'ADD PEOPLE' : 'CREATE GROUP'} />
      <ScrollView
        contentContainerStyle={{
          paddingTop: insets.top + 54 + 20,
          paddingBottom: 160,
        }}
        showsVerticalScrollIndicator={false}>
        <View style={styles.intro}>
          <Text style={styles.title}>
            {addingTo ? 'Add players' : 'Start a group'}
          </Text>
          <Text style={styles.subtitle}>
            {addingTo
              ? 'Everyone you pick joins the conversation.'
              : 'Name the conversation and choose who’s in.'}
          </Text>
        </View>

        {addingTo ? null : (
          <>
            <Text style={styles.fieldLabel}>GROUP NAME</Text>
            <SearchField
              variant="field"
              placeholder="Your text..."
              value={name}
              onChangeText={setName}
            />
          </>
        )}

        <Text style={styles.fieldLabel}>ADD MEMBERS</Text>
        <SearchField value={query} onChangeText={setQuery} />

        {error ? <Text style={styles.error}>{error}</Text> : null}

        <View style={{ paddingTop: 8 }}>
          {filtered.map((player) => {
            const checked = selected.includes(player.id);
            return (
              <Pressable
                key={player.id}
                style={styles.memberRow}
                onPress={() => toggle(player.id)}>
                <ParticipantAvatar participant={player} size={40} />
                <View style={{ flex: 1, gap: 5 }}>
                  <Text style={styles.memberName}>{player.fullName}</Text>
                  <Text style={styles.memberMeta}>
                    {player.handicap === null ? '—' : `${player.handicap} HCP`}
                  </Text>
                </View>
                <View style={[styles.check, checked && styles.checkOn]}>
                  {checked ? <Text style={styles.checkMark}>✓</Text> : null}
                </View>
              </Pressable>
            );
          })}

          {filtered.length === 0 ? (
            <Text style={styles.empty}>
              {term ? `No players match “${query}”.` : 'Everyone is already in.'}
            </Text>
          ) : null}
        </View>
      </ScrollView>

      {/* Create group CTA */}
      <View style={[styles.ctaWrap, { paddingBottom: insets.bottom }]}>
        <Pressable onPress={submit} disabled={!ready || busy}>
          <LinearGradient
            colors={[...colors.gradCta]}
            style={[styles.cta, (!ready || busy) && styles.ctaDisabled]}>
            <Text style={styles.ctaText}>
              {addingTo ? 'ADD PEOPLE' : 'CREATE GROUP'}
              {selected.length > 0 ? ` · ${selected.length}` : ''}
            </Text>
          </LinearGradient>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  intro: {
    paddingHorizontal: 20,
    gap: 8,
    paddingBottom: 16,
  },
  title: {
    fontFamily: fonts.serif,
    fontSize: 40,
    lineHeight: 44,
    color: '#ffffff',
  },
  subtitle: {
    fontFamily: fonts.regular,
    fontSize: 13,
    color: 'rgba(255,255,255,0.45)',
  },
  fieldLabel: {
    fontFamily: fonts.bold,
    fontSize: 10,
    color: 'rgba(255,255,255,0.4)',
    paddingHorizontal: 20,
    paddingTop: 14,
    paddingBottom: 8,
  },
  memberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingHorizontal: 20,
    paddingVertical: 12,
  },
  memberName: {
    fontFamily: fonts.bold,
    fontSize: 15,
    color: '#ffffff',
  },
  memberMeta: {
    fontFamily: fonts.regular,
    fontSize: 12,
    color: 'rgba(255,255,255,0.4)',
  },
  check: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkOn: {
    borderColor: '#34a468',
    backgroundColor: 'rgba(52,164,104,0.15)',
  },
  checkMark: {
    fontSize: 12,
    color: '#34a468',
    fontFamily: fonts.bold,
  },
  error: {
    fontFamily: fonts.regular,
    fontSize: 12,
    color: '#ff9d9d',
    paddingHorizontal: 20,
    paddingTop: 10,
  },
  empty: {
    fontFamily: fonts.regular,
    fontSize: 13,
    color: 'rgba(255,255,255,0.45)',
    textAlign: 'center',
    paddingTop: 24,
  },
  ctaWrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
  },
  cta: {
    height: 74,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ctaDisabled: {
    opacity: 0.4,
  },
  ctaText: {
    fontFamily: fonts.bold,
    fontSize: 12,
    color: colors.highlight,
    textTransform: 'uppercase',
  },
});
