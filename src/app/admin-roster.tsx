import * as Clipboard from 'expo-clipboard';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import { LinearGradient } from 'expo-linear-gradient';
import { useLocalSearchParams } from 'expo-router';
import React, { useMemo, useState } from 'react';
import ReanimatedSwipeable from 'react-native-gesture-handler/ReanimatedSwipeable';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import {
  Alert,
  Modal,
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
import { AdminRosterTabs } from '@/components/admin-roster-tabs';
import { OfflineMutationScreen } from '@/components/offline-state';
import { SearchField } from '@/components/search-field';
import { ActionButton, Noise, SectionLabel } from '@/components/ui';
import { colors, fonts } from '@/constants/theme';
import { CSV_TEMPLATE, CsvImportResult, parseRoster } from '@/lib/csv';
import { sendInviteEmails } from '@/lib/invite-email';
import { inviteMessage, invitesAsCsv, isSyntheticEmail } from '@/lib/invites';
import { useEvent } from '@/state/event';
import { useBrowserDefinitelyOffline } from '@/lib/offline/network';
import {
  ExistingAccountCandidate,
  NewParticipantInput,
  Participant,
} from '@/state/types';

type Filter = 'all' | 'pending' | 'claimed';
type AddMode = 'new' | 'existing';

function initialsOf(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
}

function RemoveParticipantModal({
  participant,
  error,
  removing,
  onCancel,
  onConfirm,
}: {
  participant: Participant | null;
  error: string | null;
  removing: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <Modal
      visible={participant !== null}
      transparent
      animationType="fade"
      onRequestClose={onCancel}>
      <View style={styles.confirmBackdrop}>
        <Pressable
          style={StyleSheet.absoluteFill}
          accessibilityLabel="Cancel player removal"
          onPress={onCancel}
        />
        <View style={styles.confirmCard} accessibilityViewIsModal>
          <Text style={styles.confirmEyebrow}>REMOVE PLAYER</Text>
          <Text style={styles.confirmTitle}>
            Remove {participant?.fullName}?
          </Text>
          <Text style={styles.confirmMessage}>
            {participant?.claimed
              ? 'They have already signed in. Removing them revokes their access to the event.'
              : 'Their invite code will stop working.'}
          </Text>
          {error ? <Text style={styles.confirmError}>{error}</Text> : null}
          <View style={styles.confirmActions}>
            <Pressable
              style={[styles.confirmCancel, removing && styles.buttonBusy]}
              disabled={removing}
              onPress={onCancel}>
              <Text style={styles.confirmCancelText}>CANCEL</Text>
            </Pressable>
            <Pressable
              style={[styles.confirmRemove, removing && styles.buttonBusy]}
              disabled={removing}
              onPress={onConfirm}>
              <Text style={styles.confirmRemoveText}>
                {removing ? 'REMOVING…' : 'YES, REMOVE'}
              </Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

export default function AdminRoster() {
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ tab?: string | string[] }>();
  const {
    event,
    me,
    participants,
    teamOf,
    addParticipants,
    availableExistingAccounts,
    addExistingAccount,
    updateParticipant,
    removeParticipant,
    regenerateInviteCode,
    refresh,
  } = useEvent();
  const offline = useBrowserDefinitelyOffline();
  const requestedTab = Array.isArray(params.tab) ? params.tab[0] : params.tab;
  const workspaceTab = requestedTab === 'invites' ? 'invites' : 'players';

  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [preview, setPreview] = useState<CsvImportResult | null>(null);
  const [adding, setAdding] = useState(false);
  const [addMode, setAddMode] = useState<AddMode>('new');
  const [newName, setNewName] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [newHandicap, setNewHandicap] = useState('');
  const [addError, setAddError] = useState<string | null>(null);
  const [accountQuery, setAccountQuery] = useState('');
  const [existingAccounts, setExistingAccounts] = useState<
    ExistingAccountCandidate[] | null
  >(null);
  const [accountsLoading, setAccountsLoading] = useState(false);
  const [accountsError, setAccountsError] = useState<string | null>(null);
  const [addingAccountId, setAddingAccountId] = useState<string | null>(null);
  const [removeTarget, setRemoveTarget] = useState<Participant | null>(null);
  const [removeError, setRemoveError] = useState<string | null>(null);
  const [removing, setRemoving] = useState(false);
  /** Disables every send control while one is in flight, so a slow network
   *  can't turn an impatient second tap into a duplicate email. */
  const [emailing, setEmailing] = useState(false);

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
        if (workspaceTab === 'invites' && p.claimed) return false;
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
  }, [participants, query, filter, workspaceTab]);

  const visibleAccounts = useMemo(() => {
    const q = accountQuery.trim().toLowerCase();
    return (existingAccounts ?? []).filter(
      (account) =>
        !q ||
        account.displayName.toLowerCase().includes(q) ||
        account.username?.toLowerCase().includes(q),
    );
  }, [accountQuery, existingAccounts]);

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

  if (offline) {
    return (
      <OfflineMutationScreen
        title="roster"
        description="Adding, editing, removing, importing, or inviting players requires a connection. Reconnect to make roster changes."
      />
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
      setAddError('Enter the player’s full name.');
      return;
    }
    const email = newEmail.trim().toLowerCase();
    if (!email) {
      setAddError('Enter the player’s email address.');
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setAddError(`“${email}” doesn’t look like a valid email address.`);
      return;
    }
    const handicap = newHandicap.trim() === '' ? null : Number(newHandicap);
    if (handicap !== null && Number.isNaN(handicap)) {
      setAddError('Enter a numeric handicap, for example 8.4.');
      return;
    }
    setAddError(null);
    const row: NewParticipantInput = {
      fullName: name,
      email,
      handicap,
      isAdmin: false,
    };
    const { added, duplicates } = await addParticipants([row]);
    if (added === 0) {
      if (duplicates.length > 0) {
        setAddError(`${duplicates[0]} is already on the roster.`);
      } else {
        setAddError('The player could not be added. Try again.');
      }
      // The save was refused and has already been reported; keep what they typed.
      return;
    }
    setNewName('');
    setNewEmail('');
    setNewHandicap('');
    setAdding(false);
  };

  const loadExistingAccounts = async () => {
    setAccountsError(null);
    setAccountsLoading(true);
    try {
      setExistingAccounts(await availableExistingAccounts());
    } catch (error) {
      setAccountsError(
        error instanceof Error
          ? error.message
          : 'Existing accounts could not be loaded. Try again.',
      );
    } finally {
      setAccountsLoading(false);
    }
  };

  const openExistingAccounts = () => {
    setAddMode('existing');
    setAddError(null);
    setAccountsError(null);
    if (existingAccounts === null && !accountsLoading) {
      void loadExistingAccounts();
    }
  };

  const addKnownAccount = async (account: ExistingAccountCandidate) => {
    setAddingAccountId(account.accountId);
    setAccountsError(null);
    try {
      await addExistingAccount(account.accountId);
      setExistingAccounts((current) =>
        current?.filter((candidate) => candidate.accountId !== account.accountId) ?? null,
      );
      setAccountQuery('');
    } catch (error) {
      setAccountsError(
        error instanceof Error
          ? error.message
          : `${account.displayName} could not be added. Try again.`,
      );
    } finally {
      setAddingAccountId(null);
    }
  };

  const copyInvite = async (participant: Participant) => {
    await Clipboard.setStringAsync(inviteMessage(participant, event.name));
    Alert.alert('Copied', `Invite for ${participant.fullName} is on your clipboard.`);
  };

  const shareInvite = async (participant: Participant) => {
    await Share.share({ message: inviteMessage(participant, event.name) });
  };

  /**
   * `label` is what the confirmation talks about — one player's name, or a
   * count for the bulk run.
   */
  const emailInvites = async (targets: Participant[], label: string) => {
    if (targets.length === 0) {
      Alert.alert('Nobody to email', 'Everyone with an email address has already been invited.');
      return;
    }

    setEmailing(true);
    try {
      const result = await sendInviteEmails(targets.map((p) => p.id));
      // Pick up the invite_sent_at stamps the function just wrote.
      await refresh();

      const parts = [`Sent ${result.sent} invite${result.sent === 1 ? '' : 's'}.`];
      if (result.skipped > 0) {
        parts.push(`${result.skipped} skipped — no email address on file.`);
      }
      if (result.failed > 0) {
        parts.push(`${result.failed} failed:\n${result.errors.join('\n')}`);
      }
      Alert.alert(result.failed > 0 ? 'Partly sent' : 'Invites sent', parts.join('\n\n'));
    } catch (error) {
      Alert.alert(
        `Couldn't email ${label}`,
        error instanceof Error ? error.message : 'Something went wrong sending the invite.',
      );
    } finally {
      setEmailing(false);
    }
  };

  /** Everyone with a real address who has never been sent one. */
  const uninvited = participants.filter(
    (p) => !isSyntheticEmail(p.authEmail) && !p.inviteSentAt,
  );

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
    setRemoveError(null);
    setRemoveTarget(participant);
  };

  const cancelRemove = () => {
    if (removing) return;
    setRemoveError(null);
    setRemoveTarget(null);
  };

  const removeConfirmed = async () => {
    if (!removeTarget) return;
    setRemoving(true);
    setRemoveError(null);
    try {
      await removeParticipant(removeTarget.id);
      setExpandedId(null);
      setEditingId(null);
      setRemoveTarget(null);
    } catch (error) {
      setRemoveError(
        error instanceof Error
          ? error.message
          : 'The player could not be removed. Try again.',
      );
    } finally {
      setRemoving(false);
    }
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
    <GestureHandlerRootView style={styles.root}>
      <LinearGradient colors={['#203329', '#1b2a22']} style={StyleSheet.absoluteFill} />
      <Noise />
      <PageHeader
        title="roster & invites"
        subtitle={`${participants.length} PARTICIPANTS`}
      />
      <ScrollView
        contentContainerStyle={{
          paddingTop: insets.top + 54 + 22,
          paddingBottom: 60,
          gap: 18,
        }}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled">
        <AdminRosterTabs eventId={event.id} active={workspaceTab} />

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
        {workspaceTab === 'invites' ? (
          <View style={styles.workspaceIntro}>
            <SectionLabel color={colors.link} size={10}>
              invitations
            </SectionLabel>
            <Text style={styles.hint}>
              Pending players are shown here. Open a player to copy, share, email,
              resend, or regenerate their invitation.
            </Text>
          </View>
        ) : preview ? (
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
              onPress={() => {
                setAdding((current) => {
                  if (!current) setAddMode('new');
                  return !current;
                });
                setAddError(null);
                setAccountsError(null);
              }}>
              <Text style={styles.secondaryButtonText}>
                {adding ? 'CLOSE' : 'ADD PLAYER'}
              </Text>
            </Pressable>
          </View>
        )}

        {/* New player / existing account */}
        {workspaceTab === 'players' && adding && !preview ? (
          <View style={styles.addCard}>
            <SectionLabel color={colors.link} size={10}>
              add a player
            </SectionLabel>
            <View style={styles.addModeTabs}>
              <Pressable
                style={[
                  styles.addModeTab,
                  addMode === 'new' && styles.addModeTabActive,
                ]}
                onPress={() => {
                  setAddMode('new');
                  setAccountsError(null);
                }}>
                <Text
                  style={[
                    styles.addModeText,
                    addMode === 'new' && styles.addModeTextActive,
                  ]}>
                  NEW PLAYER
                </Text>
              </Pressable>
              <Pressable
                style={[
                  styles.addModeTab,
                  addMode === 'existing' && styles.addModeTabActive,
                ]}
                onPress={openExistingAccounts}>
                <Text
                  style={[
                    styles.addModeText,
                    addMode === 'existing' && styles.addModeTextActive,
                  ]}>
                  EXISTING ACCOUNT
                </Text>
              </Pressable>
            </View>

            {addMode === 'new' ? (
              <>
                <Text style={styles.addHelp}>
                  Add someone new, then send their invite from the roster.
                </Text>
                <TextInput
                  value={newName}
                  onChangeText={(value) => {
                    setNewName(value);
                    setAddError(null);
                  }}
                  style={styles.input}
                  placeholder="Full name"
                  placeholderTextColor="rgba(255,255,255,0.3)"
                  selectionColor={colors.highlight}
                />
                <TextInput
                  value={newEmail}
                  onChangeText={(value) => {
                    setNewEmail(value);
                    setAddError(null);
                  }}
                  style={styles.input}
                  placeholder="Email (required)"
                  placeholderTextColor="rgba(255,255,255,0.3)"
                  keyboardType="email-address"
                  autoCapitalize="none"
                  autoCorrect={false}
                  autoComplete="email"
                  accessibilityLabel="Email, required"
                  selectionColor={colors.highlight}
                />
                <TextInput
                  value={newHandicap}
                  onChangeText={(value) => {
                    setNewHandicap(value);
                    setAddError(null);
                  }}
                  style={styles.input}
                  placeholder="Handicap (optional)"
                  placeholderTextColor="rgba(255,255,255,0.3)"
                  keyboardType="decimal-pad"
                  selectionColor={colors.highlight}
                />
                {addError ? <Text style={styles.addError}>{addError}</Text> : null}
                <ActionButton label="ADD TO ROSTER" height={54} onPress={addManually} />
              </>
            ) : (
              <>
                <Text style={styles.addHelp}>
                  Choose a signed-up Blurry member. They’ll get this event immediately—no new invite or account needed.
                </Text>
                <SearchField
                  value={accountQuery}
                  onChangeText={setAccountQuery}
                  placeholder="Search existing accounts"
                />
                {accountsLoading ? (
                  <Text style={styles.accountEmpty}>Loading accounts…</Text>
                ) : null}
                {accountsError ? (
                  <View style={styles.accountErrorRow}>
                    <Text style={[styles.addError, { flex: 1 }]}>{accountsError}</Text>
                    <Pressable
                      disabled={accountsLoading}
                      onPress={() => {
                        setExistingAccounts(null);
                        void loadExistingAccounts();
                      }}>
                      <Text style={styles.retryText}>RETRY</Text>
                    </Pressable>
                  </View>
                ) : null}
                {!accountsLoading && !accountsError && visibleAccounts.length === 0 ? (
                  <Text style={styles.accountEmpty}>
                    {accountQuery.trim()
                      ? 'No existing accounts match that search.'
                      : 'Every existing account is already on this event.'}
                  </Text>
                ) : null}
                {visibleAccounts.map((account) => {
                  const busy = addingAccountId === account.accountId;
                  return (
                    <View key={account.accountId} style={styles.accountRow}>
                      <View style={styles.accountAvatar}>
                        <Text style={styles.accountAvatarText}>
                          {initialsOf(account.displayName)}
                        </Text>
                      </View>
                      <View style={styles.accountIdentity}>
                        <Text style={styles.accountName}>{account.displayName}</Text>
                        <Text style={styles.accountMeta}>
                          {[
                            account.username ? `@${account.username}` : 'Existing account',
                            account.handicap === null ? null : `${account.handicap} HCP`,
                          ]
                            .filter(Boolean)
                            .join(' · ')}
                        </Text>
                      </View>
                      <Pressable
                        style={[styles.accountAdd, busy && styles.buttonBusy]}
                        disabled={addingAccountId !== null}
                        accessibilityRole="button"
                        accessibilityLabel={`Add ${account.displayName} to this event`}
                        onPress={() => void addKnownAccount(account)}>
                        <Text style={styles.accountAddText}>
                          {busy ? 'ADDING…' : 'ADD'}
                        </Text>
                      </Pressable>
                    </View>
                  );
                })}
              </>
            )}
          </View>
        ) : null}

        {/* Filters + search */}
        {workspaceTab === 'players' ? (
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
        ) : null}

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
                <ReanimatedSwipeable
                  friction={2}
                  rightThreshold={44}
                  overshootRight={false}
                  renderRightActions={(_progress, _translation, swipeable) => (
                    <Pressable
                      style={styles.swipeRemove}
                      accessibilityRole="button"
                      accessibilityLabel={`Remove ${p.fullName}`}
                      onPress={() => {
                        swipeable.close();
                        confirmRemove(p);
                      }}>
                      <Text style={styles.swipeRemoveText}>REMOVE</Text>
                    </Pressable>
                  )}>
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
                </ReanimatedSwipeable>

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
                    <Text style={styles.expandedEmail}>
                      {isSyntheticEmail(p.authEmail)
                        ? 'No email on file — invite by code'
                        : p.authEmail}
                      {p.inviteSentAt
                        ? `  ·  invited ${new Date(p.inviteSentAt).toLocaleDateString()}`
                        : ''}
                    </Text>
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
                      {/* Nothing to email a placeholder address. */}
                      {!isSyntheticEmail(p.authEmail) ? (
                        <Pressable
                          style={styles.chip}
                          disabled={emailing}
                          onPress={() => emailInvites([p], p.fullName)}>
                          <Text style={styles.chipText}>
                            {p.inviteSentAt ? 'RESEND EMAIL' : 'EMAIL INVITE'}
                          </Text>
                        </Pressable>
                      ) : null}
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
        {workspaceTab === 'invites' ? <View style={styles.bulk}>
          <SectionLabel color={colors.link} size={10}>
            bulk
          </SectionLabel>
          <Pressable
            style={[styles.secondaryButton, emailing && styles.buttonBusy]}
            disabled={emailing || uninvited.length === 0}
            onPress={() =>
              Alert.alert(
                `Email ${uninvited.length} invite${uninvited.length === 1 ? '' : 's'}?`,
                'Goes to everyone with an email address who hasn’t been sent one yet.',
                [
                  { text: 'Cancel', style: 'cancel' },
                  {
                    text: 'Send',
                    onPress: () => emailInvites(uninvited, 'the roster'),
                  },
                ],
              )
            }>
            <Text style={styles.secondaryButtonText}>
              {emailing
                ? 'SENDING…'
                : uninvited.length === 0
                  ? 'EVERYONE INVITED'
                  : `EMAIL ${uninvited.length} UNSENT INVITE${uninvited.length === 1 ? '' : 'S'}`}
            </Text>
          </Pressable>
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
        </View> : null}
      </ScrollView>
      <RemoveParticipantModal
        participant={removeTarget}
        error={removeError}
        removing={removing}
        onCancel={cancelRemove}
        onConfirm={removeConfirmed}
      />
    </GestureHandlerRootView>
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
  workspaceIntro: {
    marginHorizontal: 20,
    gap: 8,
    padding: 16,
    backgroundColor: 'rgba(15,17,16,0.42)',
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
  buttonBusy: {
    opacity: 0.5,
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
  addModeTabs: {
    flexDirection: 'row',
    gap: 8,
  },
  addModeTab: {
    flex: 1,
    minHeight: 42,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 8,
    backgroundColor: 'rgba(255,255,255,0.06)',
  },
  addModeTabActive: {
    backgroundColor: 'rgba(123,255,178,0.16)',
    borderWidth: 1,
    borderColor: 'rgba(123,255,178,0.34)',
  },
  addModeText: {
    fontFamily: fonts.bold,
    fontSize: 9,
    color: 'rgba(255,255,255,0.5)',
  },
  addModeTextActive: {
    color: colors.highlight,
  },
  addHelp: {
    fontFamily: fonts.regular,
    fontSize: 11,
    lineHeight: 16,
    color: 'rgba(255,255,255,0.48)',
  },
  addError: {
    fontFamily: fonts.regular,
    fontSize: 11,
    lineHeight: 16,
    color: '#ffb4b4',
  },
  accountErrorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 6,
  },
  retryText: {
    fontFamily: fonts.bold,
    fontSize: 10,
    color: colors.link,
  },
  accountEmpty: {
    fontFamily: fonts.regular,
    fontSize: 12,
    lineHeight: 18,
    color: 'rgba(255,255,255,0.45)',
    paddingVertical: 12,
    textAlign: 'center',
  },
  accountRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    minHeight: 62,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.07)',
  },
  accountAvatar: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(123,255,178,0.12)',
  },
  accountAvatarText: {
    fontFamily: fonts.bold,
    fontSize: 11,
    color: colors.highlight,
  },
  accountIdentity: {
    flex: 1,
    gap: 4,
  },
  accountName: {
    fontFamily: fonts.bold,
    fontSize: 13,
    color: '#ffffff',
  },
  accountMeta: {
    fontFamily: fonts.regular,
    fontSize: 10,
    color: 'rgba(255,255,255,0.4)',
  },
  accountAdd: {
    minWidth: 64,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(123,255,178,0.14)',
  },
  accountAddText: {
    fontFamily: fonts.bold,
    fontSize: 9,
    color: colors.highlight,
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
    backgroundColor: '#1b2a22',
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
  swipeRemove: {
    width: 96,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#651f35',
  },
  swipeRemoveText: {
    fontFamily: fonts.bold,
    fontSize: 10,
    color: '#ffced7',
  },
  confirmBackdrop: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
    backgroundColor: 'rgba(0,0,0,0.7)',
  },
  confirmCard: {
    width: '100%',
    maxWidth: 420,
    padding: 22,
    gap: 12,
    backgroundColor: '#18261f',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  confirmEyebrow: {
    fontFamily: fonts.bold,
    fontSize: 9,
    color: '#ff9aab',
  },
  confirmTitle: {
    fontFamily: fonts.serif,
    fontSize: 28,
    color: '#ffffff',
  },
  confirmMessage: {
    fontFamily: fonts.regular,
    fontSize: 13,
    lineHeight: 19,
    color: 'rgba(255,255,255,0.62)',
  },
  confirmError: {
    fontFamily: fonts.regular,
    fontSize: 11,
    lineHeight: 16,
    color: '#ffb4b4',
  },
  confirmActions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 8,
  },
  confirmCancel: {
    flex: 1,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.07)',
  },
  confirmCancelText: {
    fontFamily: fonts.bold,
    fontSize: 10,
    color: 'rgba(255,255,255,0.75)',
  },
  confirmRemove: {
    flex: 1,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#651f35',
  },
  confirmRemoveText: {
    fontFamily: fonts.bold,
    fontSize: 10,
    color: '#ffced7',
  },
  bulk: {
    paddingHorizontal: 20,
    gap: 10,
  },
});
