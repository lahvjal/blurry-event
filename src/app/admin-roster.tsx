import * as Clipboard from 'expo-clipboard';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import { LinearGradient } from 'expo-linear-gradient';
import React, { useMemo, useState } from 'react';
import {
  Alert,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { PageHeader } from '@/components/page-header';
import { SearchField } from '@/components/search-field';
import { ActionButton, Noise, SectionLabel } from '@/components/ui';
import { colors, fonts } from '@/constants/theme';
import { CSV_TEMPLATE, CsvImportResult, parseRoster } from '@/lib/csv';
import { inviteMessage, invitesAsCsv, isSyntheticEmail } from '@/lib/invites';
import { useEvent } from '@/state/event';
import { NewParticipantInput, Participant } from '@/state/types';

type Filter = 'all' | 'pending' | 'claimed';

export default function AdminRoster() {
  const insets = useSafeAreaInsets();
  const {
    event,
    me,
    participants,
    teamOf,
    addParticipants,
    updateParticipant,
    removeParticipant,
    regenerateInviteCode,
  } = useEvent();

  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [preview, setPreview] = useState<CsvImportResult | null>(null);
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [newHandicap, setNewHandicap] = useState('');

  // Inline edit of an existing roster row.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editEmail, setEditEmail] = useState('');
  const [editHandicap, setEditHandicap] = useState('');

  const startEditing = (participant: Participant) => {
    setEditingId(participant.id);
    setEditName(participant.fullName);
    setEditEmail(isSyntheticEmail(participant.authEmail) ? '' : participant.authEmail);
    setEditHandicap(
      participant.handicap === null ? '' : String(participant.handicap),
    );
  };

  const saveEdit = (participant: Participant) => {
    const name = editName.trim();
    if (!name) {
      Alert.alert('Name required', 'A participant needs a name.');
      return;
    }

    const email = editEmail.trim().toLowerCase();
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      Alert.alert('Check the email', `"${email}" doesn't look like an email address.`);
      return;
    }
    if (
      email &&
      participants.some((p) => p.id !== participant.id && p.authEmail.toLowerCase() === email)
    ) {
      Alert.alert('Email already used', 'Another participant already has that address.');
      return;
    }

    const handicap = editHandicap.trim() === '' ? null : Number(editHandicap);
    if (handicap !== null && Number.isNaN(handicap)) {
      Alert.alert('Check the handicap', 'Enter a number, for example 8.4.');
      return;
    }

    updateParticipant(participant.id, {
      fullName: name,
      handicap,
      // Only send the email when it's editable, so a signed-up player's
      // sign-in address can't drift from their auth account.
      ...(participant.claimed ? {} : { authEmail: email }),
    });
    setEditingId(null);
  };

  const claimedCount = participants.filter((p) => p.claimed).length;
  const pendingCount = participants.length - claimedCount;

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return participants
      .filter((p) => {
        if (filter === 'claimed' && !p.claimed) return false;
        if (filter === 'pending' && p.claimed) return false;
        if (!q) return true;
        return (
          p.fullName.toLowerCase().includes(q) ||
          p.inviteCode.toLowerCase().includes(q) ||
          p.authEmail.toLowerCase().includes(q)
        );
      })
      .sort((a, b) => a.fullName.localeCompare(b.fullName));
  }, [participants, query, filter]);

  if (!me.isAdmin) {
    return (
      <View style={styles.root}>
        <LinearGradient colors={['#203329', '#1b2a22']} style={StyleSheet.absoluteFill} />
        <Noise />
        <PageHeader title="roster" />
        <View style={{ paddingTop: insets.top + 114, paddingHorizontal: 24 }}>
          <Text style={styles.muted}>You don’t have admin access for this event.</Text>
        </View>
      </View>
    );
  }

  const pickCsv = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ['text/csv', 'text/comma-separated-values', 'text/plain', '*/*'],
        copyToCacheDirectory: true,
      });
      if (result.canceled || !result.assets?.[0]) return;

      const text = await FileSystem.readAsStringAsync(result.assets[0].uri);
      const parsed = parseRoster(text);

      if (parsed.rows.length === 0) {
        Alert.alert(
          'Nothing to import',
          parsed.skipped.length > 0
            ? `No usable rows. First problem: ${parsed.skipped[0].reason}`
            : 'That file had no rows with a name column.',
        );
        return;
      }
      setPreview(parsed);
    } catch {
      Alert.alert('Could not read that file', 'Make sure it’s a plain .csv export.');
    }
  };

  const confirmImport = async () => {
    if (!preview) return;
    const { added, duplicates } = await addParticipants(preview.rows);
    setPreview(null);
    if (added === 0 && duplicates.length === 0) return;
    Alert.alert(
      'Roster updated',
      [
        `${added} participant${added === 1 ? '' : 's'} added.`,
        duplicates.length > 0
          ? `${duplicates.length} skipped as already on the roster: ${duplicates.slice(0, 5).join(', ')}${duplicates.length > 5 ? '…' : ''}`
          : null,
      ]
        .filter(Boolean)
        .join('\n\n'),
    );
  };

  const addManually = async () => {
    const name = newName.trim();
    if (!name) {
      Alert.alert('Name required', 'Enter the participant’s name.');
      return;
    }
    const handicap = newHandicap.trim() === '' ? null : Number(newHandicap);
    if (handicap !== null && Number.isNaN(handicap)) {
      Alert.alert('Check the handicap', 'Enter a number, for example 8.4.');
      return;
    }
    const row: NewParticipantInput = {
      fullName: name,
      email: newEmail.trim() ? newEmail.trim().toLowerCase() : null,
      handicap,
      isAdmin: false,
    };
    const { added, duplicates } = await addParticipants([row]);
    if (added === 0) {
      if (duplicates.length > 0) {
        Alert.alert('Already on the roster', `${duplicates[0]} is already a participant.`);
      }
      // The save was refused and has already been reported; keep what they typed.
      return;
    }
    setNewName('');
    setNewEmail('');
    setNewHandicap('');
    setAdding(false);
  };

  const copyInvite = async (participant: Participant) => {
    await Clipboard.setStringAsync(inviteMessage(participant, event.name));
    Alert.alert('Copied', `Invite for ${participant.fullName} is on your clipboard.`);
  };

  const shareInvite = async (participant: Participant) => {
    await Share.share({ message: inviteMessage(participant, event.name) });
  };

  const exportAll = async () => {
    await Share.share({
      message: invitesAsCsv(participants),
      title: 'Blurry Invitational invites',
    });
  };

  const copyTemplate = async () => {
    await Clipboard.setStringAsync(CSV_TEMPLATE);
    Alert.alert(
      'Template copied',
      'Paste into a spreadsheet, fill in your paid list, then export as CSV.',
    );
  };

  const confirmRemove = (participant: Participant) => {
    Alert.alert(
      `Remove ${participant.fullName}?`,
      participant.claimed
        ? 'They have already signed in. Removing them revokes their access to the event.'
        : 'Their invite code will stop working.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: () => {
            removeParticipant(participant.id);
            setExpandedId(null);
          },
        },
      ],
    );
  };

  const confirmRegenerate = (participant: Participant) => {
    Alert.alert(
      'Generate a new code?',
      `${participant.fullName}'s current code will stop working immediately. Use this if their invite was shared with the wrong person.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Regenerate',
          style: 'destructive',
          onPress: () => regenerateInviteCode(participant.id),
        },
      ],
    );
  };

  return (
    <View style={styles.root}>
      <LinearGradient colors={['#203329', '#1b2a22']} style={StyleSheet.absoluteFill} />
      <Noise />
      <PageHeader title="roster" subtitle={`${participants.length} PARTICIPANTS`} />
      <ScrollView
        contentContainerStyle={{
          paddingTop: insets.top + 54 + 22,
          paddingBottom: 60,
          gap: 18,
        }}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled">
        {/* Summary */}
        <View style={styles.summary}>
          <View style={styles.summaryCell}>
            <Text style={styles.summaryValue}>{participants.length}</Text>
            <Text style={styles.summaryLabel}>PAID</Text>
          </View>
          <View style={styles.summaryDivider} />
          <View style={styles.summaryCell}>
            <Text style={[styles.summaryValue, { color: colors.highlight }]}>
              {claimedCount}
            </Text>
            <Text style={styles.summaryLabel}>SIGNED UP</Text>
          </View>
          <View style={styles.summaryDivider} />
          <View style={styles.summaryCell}>
            <Text style={styles.summaryValue}>{pendingCount}</Text>
            <Text style={styles.summaryLabel}>PENDING</Text>
          </View>
        </View>

        {/* CSV import preview */}
        {preview ? (
          <View style={styles.previewCard}>
            <SectionLabel color={colors.highlight} size={10}>
              import preview
            </SectionLabel>
            <Text style={styles.previewCount}>
              {preview.rows.length} participant{preview.rows.length === 1 ? '' : 's'} ready
            </Text>
            <Text style={styles.previewMapping}>{preview.mapping}</Text>

            {preview.rows.slice(0, 6).map((row, i) => (
              <View key={i} style={styles.previewRow}>
                <Text style={styles.previewName}>{row.fullName}</Text>
                <Text style={styles.previewMeta}>
                  {row.email ?? 'no email'}
                  {row.handicap !== null ? ` · ${row.handicap}` : ''}
                  {row.isAdmin ? ' · ADMIN' : ''}
                </Text>
              </View>
            ))}
            {preview.rows.length > 6 ? (
              <Text style={styles.previewMore}>
                + {preview.rows.length - 6} more
              </Text>
            ) : null}

            {preview.skipped.length > 0 ? (
              <View style={styles.skippedBox}>
                <Text style={styles.skippedTitle}>
                  {preview.skipped.length} row{preview.skipped.length === 1 ? '' : 's'} skipped
                </Text>
                {preview.skipped.slice(0, 4).map((s, i) => (
                  <Text key={i} style={styles.skippedLine}>
                    Line {s.line}: {s.reason}
                  </Text>
                ))}
                {preview.skipped.length > 4 ? (
                  <Text style={styles.skippedLine}>…and {preview.skipped.length - 4} more</Text>
                ) : null}
              </View>
            ) : null}

            <View style={styles.previewActions}>
              <Pressable style={styles.secondaryButton} onPress={() => setPreview(null)}>
                <Text style={styles.secondaryButtonText}>CANCEL</Text>
              </Pressable>
              <Pressable style={styles.primaryButton} onPress={confirmImport}>
                <Text style={styles.primaryButtonText}>
                  IMPORT {preview.rows.length}
                </Text>
              </Pressable>
            </View>
          </View>
        ) : (
          <View style={styles.actionsRow}>
            <Pressable style={styles.secondaryButton} onPress={pickCsv}>
              <Text style={styles.secondaryButtonText}>IMPORT CSV</Text>
            </Pressable>
            <Pressable
              style={styles.secondaryButton}
              onPress={() => setAdding((v) => !v)}>
              <Text style={styles.secondaryButtonText}>
                {adding ? 'CLOSE' : 'ADD PLAYER'}
              </Text>
            </Pressable>
          </View>
        )}

        {/* Manual add */}
        {adding && !preview ? (
          <View style={styles.addCard}>
            <SectionLabel color={colors.link} size={10}>
              add a participant
            </SectionLabel>
            <TextInput
              value={newName}
              onChangeText={setNewName}
              style={styles.input}
              placeholder="Full name"
              placeholderTextColor="rgba(255,255,255,0.3)"
              selectionColor={colors.highlight}
            />
            <TextInput
              value={newEmail}
              onChangeText={setNewEmail}
              style={styles.input}
              placeholder="Email (optional)"
              placeholderTextColor="rgba(255,255,255,0.3)"
              keyboardType="email-address"
              autoCapitalize="none"
              selectionColor={colors.highlight}
            />
            <TextInput
              value={newHandicap}
              onChangeText={setNewHandicap}
              style={styles.input}
              placeholder="Handicap (optional)"
              placeholderTextColor="rgba(255,255,255,0.3)"
              keyboardType="decimal-pad"
              selectionColor={colors.highlight}
            />
            <ActionButton label="ADD TO ROSTER" height={54} onPress={addManually} />
          </View>
        ) : null}

        {/* Filters + search */}
        <View style={styles.filters}>
          {(['all', 'pending', 'claimed'] as Filter[]).map((key) => (
            <Pressable
              key={key}
              style={[styles.filterChip, filter === key && styles.filterChipActive]}
              onPress={() => setFilter(key)}>
              <Text
                style={[styles.filterText, filter === key && styles.filterTextActive]}>
                {key === 'claimed' ? 'SIGNED UP' : key.toUpperCase()}
              </Text>
            </Pressable>
          ))}
        </View>

        <SearchField
          value={query}
          onChangeText={setQuery}
          placeholder="Search name, code, or email"
        />

        {/* Roster list */}
        <View>
          {visible.map((p) => {
            const expanded = expandedId === p.id;
            const team = teamOf(p.id);
            return (
              <View key={p.id}>
                <Pressable
                  style={[styles.row, expanded && styles.rowExpanded]}
                  onPress={() => setExpandedId(expanded ? null : p.id)}>
                  <View style={{ flex: 1, gap: 5 }}>
                    <View style={styles.nameLine}>
                      <Text style={styles.name}>{p.fullName}</Text>
                      {p.isAdmin ? <Text style={styles.adminTag}>ADMIN</Text> : null}
                    </View>
                    <Text style={styles.code}>{p.inviteCode}</Text>
                    <Text style={styles.meta}>
                      {p.handicap === null ? 'no handicap' : `${p.handicap} HCP`}
                      {team ? ` · ${team.name}` : ' · no team'}
                    </Text>
                  </View>
                  <View
                    style={[styles.statusPill, p.claimed && styles.statusPillClaimed]}>
                    <Text
                      style={[
                        styles.statusText,
                        p.claimed && { color: colors.highlight },
                      ]}>
                      {p.claimed ? 'SIGNED UP' : 'PENDING'}
                    </Text>
                  </View>
                </Pressable>

                {expanded && editingId === p.id ? (
                  <View style={styles.expandedPanel}>
                    <Text style={styles.editLabel}>NAME</Text>
                    <TextInput
                      value={editName}
                      onChangeText={setEditName}
                      style={styles.input}
                      placeholder="Full name"
                      placeholderTextColor="rgba(255,255,255,0.3)"
                      selectionColor={colors.highlight}
                    />

                    <Text style={styles.editLabel}>EMAIL</Text>
                    {p.claimed ? (
                      <>
                        <View style={[styles.input, styles.inputLocked]}>
                          <Text style={styles.inputLockedText}>{p.authEmail}</Text>
                        </View>
                        <Text style={styles.lockNote}>
                          Locked — {p.fullName.split(' ')[0]} has already signed in with
                          this address. Changing it here would break their login.
                        </Text>
                      </>
                    ) : (
                      <>
                        <TextInput
                          value={editEmail}
                          onChangeText={setEditEmail}
                          style={styles.input}
                          placeholder="Leave blank for code-only sign-in"
                          placeholderTextColor="rgba(255,255,255,0.3)"
                          keyboardType="email-address"
                          autoCapitalize="none"
                          autoCorrect={false}
                          selectionColor={colors.highlight}
                        />
                        <Text style={styles.lockNote}>
                          Blank means they sign in with their invite code alone.
                        </Text>
                      </>
                    )}

                    <Text style={styles.editLabel}>HANDICAP</Text>
                    <TextInput
                      value={editHandicap}
                      onChangeText={setEditHandicap}
                      style={styles.input}
                      placeholder="Optional"
                      placeholderTextColor="rgba(255,255,255,0.3)"
                      keyboardType="decimal-pad"
                      selectionColor={colors.highlight}
                    />

                    <View style={styles.editActions}>
                      <Pressable
                        style={styles.secondaryButton}
                        onPress={() => setEditingId(null)}>
                        <Text style={styles.secondaryButtonText}>CANCEL</Text>
                      </Pressable>
                      <Pressable style={styles.primaryButton} onPress={() => saveEdit(p)}>
                        <Text style={styles.primaryButtonText}>SAVE</Text>
                      </Pressable>
                    </View>
                  </View>
                ) : expanded ? (
                  <View style={styles.expandedPanel}>
                    <Text style={styles.expandedEmail}>{p.authEmail}</Text>
                    <View style={styles.expandedActions}>
                      <Pressable style={styles.chip} onPress={() => startEditing(p)}>
                        <Text style={styles.chipText}>EDIT</Text>
                      </Pressable>
                      <Pressable style={styles.chip} onPress={() => copyInvite(p)}>
                        <Text style={styles.chipText}>COPY INVITE</Text>
                      </Pressable>
                      <Pressable style={styles.chip} onPress={() => shareInvite(p)}>
                        <Text style={styles.chipText}>SHARE</Text>
                      </Pressable>
                      <Pressable
                        style={styles.chip}
                        onPress={() =>
                          updateParticipant(p.id, { isAdmin: !p.isAdmin })
                        }>
                        <Text style={styles.chipText}>
                          {p.isAdmin ? 'REVOKE ADMIN' : 'MAKE ADMIN'}
                        </Text>
                      </Pressable>
                      <Pressable
                        style={styles.chip}
                        onPress={() => confirmRegenerate(p)}>
                        <Text style={styles.chipText}>NEW CODE</Text>
                      </Pressable>
                      <Pressable
                        style={[styles.chip, styles.chipDanger]}
                        onPress={() => confirmRemove(p)}>
                        <Text style={[styles.chipText, styles.chipDangerText]}>
                          REMOVE
                        </Text>
                      </Pressable>
                    </View>
                  </View>
                ) : null}
              </View>
            );
          })}
          {visible.length === 0 ? (
            <Text style={styles.muted}>No participants match that filter.</Text>
          ) : null}
        </View>

        {/* Bulk tools */}
        <View style={styles.bulk}>
          <SectionLabel color={colors.link} size={10}>
            bulk
          </SectionLabel>
          <Pressable style={styles.secondaryButton} onPress={exportAll}>
            <Text style={styles.secondaryButtonText}>EXPORT ALL INVITES</Text>
          </Pressable>
          <Pressable style={styles.secondaryButton} onPress={copyTemplate}>
            <Text style={styles.secondaryButtonText}>COPY CSV TEMPLATE</Text>
          </Pressable>
          <Text style={styles.hint}>
            CSV needs a name column. Email, handicap, and admin are optional.
            Players without an email get a code-based login instead.
          </Text>
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
    paddingHorizontal: 20,
    paddingVertical: 16,
  },
  hint: {
    fontFamily: fonts.regular,
    fontSize: 11,
    color: 'rgba(255,255,255,0.4)',
    lineHeight: 16,
  },
  summary: {
    flexDirection: 'row',
    marginHorizontal: 20,
    backgroundColor: 'rgba(15,17,16,0.45)',
  },
  summaryCell: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 16,
    gap: 6,
  },
  summaryValue: {
    fontFamily: fonts.serif,
    fontSize: 32,
    color: '#ffffff',
  },
  summaryLabel: {
    fontFamily: fonts.bold,
    fontSize: 9,
    color: 'rgba(255,255,255,0.45)',
  },
  summaryDivider: {
    width: StyleSheet.hairlineWidth,
    backgroundColor: 'rgba(255,255,255,0.12)',
    marginVertical: 14,
  },
  actionsRow: {
    flexDirection: 'row',
    gap: 10,
    paddingHorizontal: 20,
  },
  primaryButton: {
    flex: 1,
    height: 50,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(123,255,178,0.16)',
  },
  primaryButtonText: {
    fontFamily: fonts.bold,
    fontSize: 11,
    color: colors.highlight,
  },
  secondaryButton: {
    flex: 1,
    height: 50,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(15,17,16,0.55)',
  },
  secondaryButtonText: {
    fontFamily: fonts.bold,
    fontSize: 11,
    color: 'rgba(255,255,255,0.75)',
  },
  addCard: {
    marginHorizontal: 20,
    padding: 16,
    gap: 10,
    backgroundColor: 'rgba(15,17,16,0.5)',
  },
  input: {
    backgroundColor: 'rgba(0,0,0,0.35)',
    height: 48,
    paddingHorizontal: 14,
    fontFamily: fonts.regular,
    fontSize: 14,
    color: '#ffffff',
  },
  previewCard: {
    marginHorizontal: 20,
    padding: 16,
    gap: 10,
    backgroundColor: 'rgba(15,17,16,0.6)',
    borderWidth: 1,
    borderColor: 'rgba(123,255,178,0.25)',
  },
  previewCount: {
    fontFamily: fonts.serif,
    fontSize: 26,
    color: '#ffffff',
  },
  previewMapping: {
    fontFamily: fonts.regular,
    fontSize: 11,
    color: 'rgba(255,255,255,0.45)',
  },
  previewRow: {
    paddingVertical: 6,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.06)',
    gap: 3,
  },
  previewName: {
    fontFamily: fonts.bold,
    fontSize: 13,
    color: '#ffffff',
  },
  previewMeta: {
    fontFamily: fonts.regular,
    fontSize: 11,
    color: 'rgba(255,255,255,0.4)',
  },
  previewMore: {
    fontFamily: fonts.bold,
    fontSize: 10,
    color: colors.link,
  },
  skippedBox: {
    backgroundColor: 'rgba(82,26,43,0.5)',
    padding: 12,
    gap: 4,
  },
  skippedTitle: {
    fontFamily: fonts.bold,
    fontSize: 10,
    color: '#ffb4b4',
  },
  skippedLine: {
    fontFamily: fonts.regular,
    fontSize: 11,
    color: 'rgba(255,255,255,0.6)',
  },
  previewActions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 4,
  },
  filters: {
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 20,
  },
  filterChip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: 'rgba(15,17,16,0.55)',
  },
  filterChipActive: {
    backgroundColor: '#34a468',
  },
  filterText: {
    fontFamily: fonts.bold,
    fontSize: 10,
    color: 'rgba(255,255,255,0.5)',
  },
  filterTextActive: {
    color: '#0d1a12',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.05)',
  },
  rowExpanded: {
    backgroundColor: 'rgba(15,17,16,0.5)',
    borderBottomWidth: 0,
  },
  nameLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  name: {
    fontFamily: fonts.bold,
    fontSize: 15,
    color: '#ffffff',
  },
  adminTag: {
    fontFamily: fonts.bold,
    fontSize: 8,
    color: colors.highlight,
  },
  code: {
    fontFamily: fonts.bold,
    fontSize: 12,
    color: colors.link,
    letterSpacing: 1,
  },
  meta: {
    fontFamily: fonts.regular,
    fontSize: 11,
    color: 'rgba(255,255,255,0.35)',
  },
  statusPill: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  statusPillClaimed: {
    backgroundColor: 'rgba(123,255,178,0.12)',
  },
  statusText: {
    fontFamily: fonts.bold,
    fontSize: 8,
    color: 'rgba(255,255,255,0.5)',
  },
  expandedPanel: {
    paddingHorizontal: 20,
    paddingBottom: 16,
    gap: 10,
    backgroundColor: 'rgba(15,17,16,0.5)',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.05)',
  },
  expandedEmail: {
    fontFamily: fonts.regular,
    fontSize: 11,
    color: 'rgba(255,255,255,0.4)',
  },
  editLabel: {
    fontFamily: fonts.bold,
    fontSize: 9,
    color: 'rgba(255,255,255,0.45)',
    marginTop: 4,
  },
  inputLocked: {
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.2)',
  },
  inputLockedText: {
    fontFamily: fonts.regular,
    fontSize: 14,
    color: 'rgba(255,255,255,0.35)',
  },
  lockNote: {
    fontFamily: fonts.regular,
    fontSize: 10,
    lineHeight: 14,
    color: 'rgba(255,255,255,0.35)',
  },
  editActions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 8,
  },
  expandedActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 9,
    backgroundColor: 'rgba(255,255,255,0.07)',
  },
  chipText: {
    fontFamily: fonts.bold,
    fontSize: 9,
    color: 'rgba(255,255,255,0.8)',
  },
  chipDanger: {
    backgroundColor: 'rgba(82,26,43,0.7)',
  },
  chipDangerText: {
    color: '#ffb4b4',
  },
  bulk: {
    paddingHorizontal: 20,
    gap: 10,
  },
});
