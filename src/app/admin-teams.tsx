import { LinearGradient } from 'expo-linear-gradient';
import React, { useState } from 'react';
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { PageHeader } from '@/components/page-header';
import { Noise, SectionLabel } from '@/components/ui';
import { colors, fonts } from '@/constants/theme';
import { useEvent } from '@/state/event';
import { GAME_STYLE_LABELS, Participant, Team, teamSize } from '@/state/types';

/** Mean handicap of a team, ignoring players who don't have one. */
function averageHandicap(members: Participant[]): string {
  const values = members
    .map((m) => m.handicap)
    .filter((h): h is number => h !== null);
  if (values.length === 0) return '—';
  const mean = values.reduce((total, h) => total + h, 0) / values.length;
  return mean.toFixed(1);
}

export default function AdminTeams() {
  const insets = useSafeAreaInsets();
  const {
    event,
    me,
    teams,
    participants,
    leaderboard,
    participantById,
    teamOf,
    assignToTeam,
    updateTeam,
    createTeam,
    deleteTeam,
    autoBalanceTeams,
  } = useEvent();

  /** Player currently picked up and waiting to be dropped on a team. */
  const [movingId, setMovingId] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');

  if (!me.isAdmin) {
    return (
      <View style={styles.root}>
        <LinearGradient colors={['#203329', '#1b2a22']} style={StyleSheet.absoluteFill} />
        <Noise />
        <PageHeader title="teams" />
        <View style={{ paddingTop: insets.top + 114, paddingHorizontal: 24 }}>
          <Text style={styles.muted}>You don’t have admin access for this event.</Text>
        </View>
      </View>
    );
  }

  const capacity = teamSize(event.gameStyle);
  const unassigned = participants.filter((p) => !teamOf(p.id));
  const movingPlayer = movingId ? participantById(movingId) : undefined;

  /** Holes played by a team, so we can warn before deleting a live card. */
  const holesPlayed = (teamId: string) =>
    leaderboard.find((row) => row.entrantId === teamId)?.thru ?? 0;

  const confirmDelete = (team: Team) => {
    const played = holesPlayed(team.id);
    Alert.alert(
      `Delete ${team.name}?`,
      [
        `${team.memberIds.length} player${team.memberIds.length === 1 ? '' : 's'} will become unassigned.`,
        played > 0
          ? `This team has ${played} hole${played === 1 ? '' : 's'} scored. That card will be discarded.`
          : null,
      ]
        .filter(Boolean)
        .join('\n\n'),
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            deleteTeam(team.id);
            if (movingId && team.memberIds.includes(movingId)) setMovingId(null);
          },
        },
      ],
    );
  };

  const confirmAutoBalance = () => {
    Alert.alert(
      'Auto-balance teams?',
      `Everyone will be redealt into teams of ${capacity}, snake-drafted by handicap so the teams are comparable. This replaces the current line-up.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Balance',
          onPress: () => {
            autoBalanceTeams();
            setMovingId(null);
          },
        },
      ],
    );
  };

  const startRename = (team: Team) => {
    setRenamingId(team.id);
    setRenameDraft(team.name);
  };

  const commitRename = (team: Team) => {
    const name = renameDraft.trim();
    if (name) updateTeam(team.id, { name });
    setRenamingId(null);
  };

  return (
    <View style={styles.root}>
      <LinearGradient colors={['#203329', '#1b2a22']} style={StyleSheet.absoluteFill} />
      <Noise />
      <PageHeader
        title="teams"
        subtitle={`${teams.length} TEAMS · ${GAME_STYLE_LABELS[event.gameStyle]}`}
      />

      {/* Sticky banner while a player is picked up */}
      {movingPlayer ? (
        <View style={[styles.movingBanner, { top: insets.top + 54 + 8 }]}>
          <Text style={styles.movingText} numberOfLines={1}>
            Moving {movingPlayer.fullName} — pick a team
          </Text>
          <Pressable onPress={() => setMovingId(null)} hitSlop={10}>
            <Text style={styles.movingCancel}>CANCEL</Text>
          </Pressable>
        </View>
      ) : null}

      <ScrollView
        contentContainerStyle={{
          paddingTop: insets.top + 54 + (movingPlayer ? 62 : 22),
          paddingHorizontal: 20,
          paddingBottom: 60,
          gap: 18,
        }}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled">
        {/* Summary */}
        <View style={styles.summary}>
          <View style={styles.summaryCell}>
            <Text style={styles.summaryValue}>{teams.length}</Text>
            <Text style={styles.summaryLabel}>TEAMS</Text>
          </View>
          <View style={styles.summaryDivider} />
          <View style={styles.summaryCell}>
            <Text style={styles.summaryValue}>{participants.length - unassigned.length}</Text>
            <Text style={styles.summaryLabel}>ASSIGNED</Text>
          </View>
          <View style={styles.summaryDivider} />
          <View style={styles.summaryCell}>
            <Text
              style={[
                styles.summaryValue,
                unassigned.length > 0 && { color: '#ffcf8b' },
              ]}>
              {unassigned.length}
            </Text>
            <Text style={styles.summaryLabel}>UNASSIGNED</Text>
          </View>
        </View>

        <View style={styles.actionsRow}>
          <Pressable style={styles.secondaryButton} onPress={() => createTeam()}>
            <Text style={styles.secondaryButtonText}>ADD TEAM</Text>
          </Pressable>
          <Pressable style={styles.secondaryButton} onPress={confirmAutoBalance}>
            <Text style={styles.secondaryButtonText}>AUTO-BALANCE</Text>
          </Pressable>
        </View>

        {/* Teams */}
        {teams.map((team) => {
          const members = team.memberIds
            .map((id) => participantById(id))
            .filter((p): p is Participant => Boolean(p));
          const over = members.length > capacity;
          const canDrop = movingId !== null && !team.memberIds.includes(movingId);
          const played = holesPlayed(team.id);

          return (
            <View key={team.id} style={[styles.teamCard, canDrop && styles.teamCardDroppable]}>
              <View style={styles.teamHeader}>
                {renamingId === team.id ? (
                  <TextInput
                    value={renameDraft}
                    onChangeText={setRenameDraft}
                    onBlur={() => commitRename(team)}
                    onSubmitEditing={() => commitRename(team)}
                    style={styles.renameInput}
                    autoFocus
                    selectionColor={colors.highlight}
                    returnKeyType="done"
                  />
                ) : (
                  <Pressable onPress={() => startRename(team)} style={{ flex: 1 }}>
                    <Text style={styles.teamName}>{team.name}</Text>
                  </Pressable>
                )}
                <Text style={[styles.teamCount, over && styles.teamCountOver]}>
                  {members.length}/{capacity}
                </Text>
              </View>

              <View style={styles.metaRow}>
                <Text style={styles.metaText}>
                  AVG {averageHandicap(members)} HCP
                  {played > 0 ? ` · THRU ${played}` : ''}
                </Text>
                <Pressable onPress={() => confirmDelete(team)} hitSlop={8}>
                  <Text style={styles.deleteText}>DELETE</Text>
                </Pressable>
              </View>

              {/* Logistics */}
              {/* Tee time is chosen from the slots defined in Event Details, so
                  two teams can't end up on a made-up time. */}
              <Text style={styles.fieldLabel}>TEE TIME</Text>
              {event.teeTimes.length === 0 ? (
                <Text style={styles.noSlots}>
                  No tee times defined yet — add them in Event Details.
                </Text>
              ) : (
                <View style={styles.slotPicker}>
                  {event.teeTimes.map((slot) => {
                    const takenBy = teams.find(
                      (t) => t.teeTime === slot && t.id !== team.id,
                    );
                    const active = team.teeTime === slot;
                    return (
                      <Pressable
                        key={slot}
                        disabled={Boolean(takenBy)}
                        onPress={() =>
                          updateTeam(team.id, { teeTime: active ? null : slot })
                        }
                        style={[
                          styles.slotChip,
                          active && styles.slotChipActive,
                          Boolean(takenBy) && styles.slotChipTaken,
                        ]}>
                        <Text
                          style={[
                            styles.slotChipText,
                            active && styles.slotChipTextActive,
                          ]}>
                          {slot}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              )}
              <View style={styles.fieldRow}>
                <Text style={styles.fieldLabel}>START HOLE</Text>
                <TextInput
                  value={team.startingHole ? String(team.startingHole) : ''}
                  onChangeText={(text) => {
                    const n = Number(text);
                    updateTeam(team.id, {
                      startingHole: text === '' || Number.isNaN(n) ? null : n,
                    });
                  }}
                  style={styles.fieldInput}
                  keyboardType="number-pad"
                  placeholder="1"
                  placeholderTextColor="rgba(255,255,255,0.25)"
                  selectionColor={colors.highlight}
                />
              </View>
              <View style={styles.fieldRow}>
                <Text style={styles.fieldLabel}>CART</Text>
                <TextInput
                  value={team.cart ?? ''}
                  onChangeText={(text) => updateTeam(team.id, { cart: text || null })}
                  style={styles.fieldInput}
                  placeholder="Cart 14"
                  placeholderTextColor="rgba(255,255,255,0.25)"
                  selectionColor={colors.highlight}
                />
              </View>

              {/* Members */}
              {members.length === 0 ? (
                <Text style={styles.emptyTeam}>No players yet.</Text>
              ) : (
                members.map((member) => {
                  const selected = movingId === member.id;
                  return (
                    <Pressable
                      key={member.id}
                      onPress={() => setMovingId(selected ? null : member.id)}
                      style={[styles.playerRow, selected && styles.playerRowSelected]}>
                      <Text style={styles.playerName}>{member.fullName}</Text>
                      <Text style={styles.playerHcp}>
                        {member.handicap === null ? '—' : member.handicap}
                      </Text>
                    </Pressable>
                  );
                })
              )}

              {canDrop ? (
                <Pressable
                  style={styles.dropTarget}
                  onPress={() => {
                    assignToTeam(movingId!, team.id);
                    setMovingId(null);
                  }}>
                  <Text style={styles.dropTargetText}>MOVE HERE</Text>
                </Pressable>
              ) : null}
            </View>
          );
        })}

        {/* Unassigned pool */}
        <View style={styles.teamCard}>
          <View style={styles.teamHeader}>
            <Text style={styles.teamName}>Unassigned</Text>
            <Text style={styles.teamCount}>{unassigned.length}</Text>
          </View>

          {unassigned.length === 0 ? (
            <Text style={styles.emptyTeam}>Everyone has a team.</Text>
          ) : (
            unassigned.map((player) => {
              const selected = movingId === player.id;
              return (
                <Pressable
                  key={player.id}
                  onPress={() => setMovingId(selected ? null : player.id)}
                  style={[styles.playerRow, selected && styles.playerRowSelected]}>
                  <Text style={styles.playerName}>{player.fullName}</Text>
                  <Text style={styles.playerHcp}>
                    {player.handicap === null ? '—' : player.handicap}
                  </Text>
                </Pressable>
              );
            })
          )}

          {movingId && teamOf(movingId) ? (
            <Pressable
              style={styles.dropTarget}
              onPress={() => {
                assignToTeam(movingId, null);
                setMovingId(null);
              }}>
              <Text style={styles.dropTargetText}>REMOVE FROM TEAM</Text>
            </Pressable>
          ) : null}
        </View>

        <Text style={styles.hint}>
          Tap a player to pick them up, then tap a team to drop them in. Tap a team
          name to rename it. Capacity comes from the game style — change it in Event
          Admin.
        </Text>
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
    fontSize: 14,
    color: 'rgba(255,255,255,0.6)',
  },
  hint: {
    fontFamily: fonts.regular,
    fontSize: 11,
    lineHeight: 16,
    color: 'rgba(255,255,255,0.4)',
  },
  movingBanner: {
    position: 'absolute',
    left: 20,
    right: 20,
    zIndex: 20,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: '#2c8a58',
  },
  movingText: {
    flex: 1,
    fontFamily: fonts.bold,
    fontSize: 12,
    color: '#0d1a12',
  },
  movingCancel: {
    fontFamily: fonts.bold,
    fontSize: 10,
    color: '#0d1a12',
  },
  summary: {
    flexDirection: 'row',
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
  teamCard: {
    backgroundColor: 'rgba(15,17,16,0.4)',
    padding: 14,
    gap: 8,
  },
  teamCardDroppable: {
    borderWidth: 1,
    borderColor: 'rgba(123,255,178,0.35)',
  },
  teamHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  teamName: {
    fontFamily: fonts.bold,
    fontSize: 16,
    color: '#ffffff',
  },
  renameInput: {
    flex: 1,
    fontFamily: fonts.bold,
    fontSize: 16,
    color: '#ffffff',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(123,255,178,0.5)',
    paddingBottom: 2,
  },
  teamCount: {
    fontFamily: fonts.bold,
    fontSize: 11,
    color: colors.link,
  },
  teamCountOver: {
    color: '#ffcf8b',
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  metaText: {
    fontFamily: fonts.bold,
    fontSize: 9,
    color: 'rgba(255,255,255,0.35)',
  },
  deleteText: {
    fontFamily: fonts.bold,
    fontSize: 9,
    color: '#ff9b9b',
  },
  fieldRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 2,
  },
  fieldLabel: {
    fontFamily: fonts.bold,
    fontSize: 9,
    color: 'rgba(255,255,255,0.4)',
  },
  fieldInput: {
    fontFamily: fonts.bold,
    fontSize: 13,
    color: '#ffffff',
    textAlign: 'right',
    minWidth: 110,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.1)',
    paddingBottom: 2,
  },
  emptyTeam: {
    fontFamily: fonts.regular,
    fontSize: 12,
    color: 'rgba(255,255,255,0.35)',
    paddingVertical: 6,
  },
  noSlots: {
    fontFamily: fonts.regular,
    fontSize: 11,
    color: '#ffcf8b',
    paddingBottom: 4,
  },
  slotPicker: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    paddingBottom: 4,
  },
  slotChip: {
    paddingHorizontal: 10,
    paddingVertical: 7,
    backgroundColor: 'rgba(0,0,0,0.3)',
  },
  slotChipActive: {
    backgroundColor: '#34a468',
  },
  slotChipTaken: {
    opacity: 0.3,
  },
  slotChipText: {
    fontFamily: fonts.bold,
    fontSize: 10,
    color: 'rgba(255,255,255,0.6)',
  },
  slotChipTextActive: {
    color: '#0d1a12',
  },
  playerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    paddingHorizontal: 10,
    backgroundColor: 'rgba(0,0,0,0.25)',
  },
  playerRowSelected: {
    backgroundColor: 'rgba(123,255,178,0.14)',
  },
  playerName: {
    fontFamily: fonts.bold,
    fontSize: 13,
    color: '#ffffff',
  },
  playerHcp: {
    fontFamily: fonts.bold,
    fontSize: 11,
    color: 'rgba(255,255,255,0.4)',
  },
  dropTarget: {
    alignItems: 'center',
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: 'rgba(123,255,178,0.35)',
  },
  dropTargetText: {
    fontFamily: fonts.bold,
    fontSize: 10,
    color: colors.highlight,
  },
});
