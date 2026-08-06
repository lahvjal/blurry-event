import { LinearGradient } from 'expo-linear-gradient';
import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { PageHeader } from '@/components/page-header';
import { AdminRosterTabs } from '@/components/admin-roster-tabs';
import { OfflineMutationScreen } from '@/components/offline-state';
import { ActionButton, Noise, SectionLabel } from '@/components/ui';
import { colors, fonts } from '@/constants/theme';
import { useBrowserDefinitelyOffline } from '@/lib/offline/network';
import {
  canMovePlayingUnit,
  movePlayingUnit,
  PLAYING_GROUP_CAPACITY,
  playingGroupRemaining,
  startSlots,
} from '@/lib/scheduling';
import { useEvent } from '@/state/event';
import {
  GAME_STYLE_LABELS,
  isTeamFormat,
  Participant,
  PlayingGroup,
  START_FORMAT_LABELS,
  Team,
  teamSize,
} from '@/state/types';

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
  const { width } = useWindowDimensions();
  const {
    event,
    me,
    teams,
    playingGroups,
    participants,
    invites,
    leaderboard,
    participantById,
    teamOf,
    assignToTeam,
    updateTeam,
    createTeam,
    deleteTeam,
    autoBalanceTeams,
    savePlayingGroups,
  } = useEvent();
  const offline = useBrowserDefinitelyOffline();

  /** Player currently picked up and waiting to be dropped on a team. */
  const [movingId, setMovingId] = useState<string | null>(null);
  /** One player or a whole scoring side waiting to be placed in a start slot. */
  const [schedulingIds, setSchedulingIds] = useState<string[]>([]);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const [groupDrafts, setGroupDrafts] = useState<PlayingGroup[]>(playingGroups);
  const [savingGroups, setSavingGroups] = useState(false);
  const [scheduleSaveState, setScheduleSaveState] = useState<
    'saved' | 'failed' | null
  >(null);

  useEffect(() => setGroupDrafts(playingGroups), [playingGroups]);

  const scheduleSlots = useMemo(
    () => startSlots(event.startFormat, event.startTime, event.teeTimes),
    [event.startFormat, event.startTime, event.teeTimes],
  );
  const groupsDirty = JSON.stringify(groupDrafts) !== JSON.stringify(playingGroups);

  const updateGroup = (groupId: string, patch: Partial<PlayingGroup>) => {
    setScheduleSaveState(null);
    setGroupDrafts((current) =>
      current.map((group) => (group.id === groupId ? { ...group, ...patch } : group)),
    );
  };

  const addGroup = () => {
    setScheduleSaveState(null);
    const occupied = new Set(
      groupDrafts
        .filter((group) => group.teeTime && group.startingHole)
        .map((group) => `${group.teeTime}:${group.startingHole}`),
    );
    const slot = scheduleSlots.find(
      (candidate) => !occupied.has(`${candidate.teeTime}:${candidate.startingHole}`),
    );
    setGroupDrafts((current) => [
      ...current,
      {
        id: `new-playing-group-${Date.now()}`,
        name: `Group ${current.length + 1}`,
        teeTime: slot?.teeTime ?? null,
        startingHole: slot?.startingHole ?? null,
        cart: null,
        memberIds: [],
      },
    ]);
  };

  const placeInGroup = (groupId: string) => {
    if (schedulingIds.length === 0) return;
    const next = movePlayingUnit(groupDrafts, schedulingIds, groupId);
    if (!next) {
      Alert.alert('Group is full', 'A start slot can hold at most four golfers.');
      return;
    }
    setGroupDrafts(next);
    setScheduleSaveState(null);
    setSchedulingIds([]);
  };

  const saveSchedule = async () => {
    setSavingGroups(true);
    try {
      const saved = await savePlayingGroups(groupDrafts);
      setScheduleSaveState(saved ? 'saved' : 'failed');
    } finally {
      setSavingGroups(false);
    }
  };

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

  if (offline) {
    return (
      <OfflineMutationScreen
        title="teams"
        description="Scoring-team and playing-group changes require a connection. Reconnect to manage memberships and start slots."
      />
    );
  }

  const capacity = teamSize(event.gameStyle);
  const unassigned = participants.filter((p) => !teamOf(p.id));
  const unscheduled = participants.filter(
    (participant) =>
      !groupDrafts.some((group) => group.memberIds.includes(participant.id)),
  );
  const usesScoringTeams = isTeamFormat(event.gameStyle);
  const isDesktop = width >= 900;
  const scoringLocked =
    event.lifecycleStatus !== 'draft' || leaderboard.some((row) => row.thru > 0);
  const movingPlayer = movingId ? participantById(movingId) : undefined;
  const scoringIssues = usesScoringTeams
    ? unassigned.length +
      teams.filter((team) => {
        const count = team.memberIds.length;
        return !(
          (!team.individualException && count === capacity) ||
          (team.individualException && count === 1)
        );
      }).length
    : 0;
  const scheduleIssues = groupDrafts.filter(
    (group) =>
      group.memberIds.length > 0 &&
      (group.teeTime === null || group.startingHole === null),
  ).length;
  const scheduleUnits = usesScoringTeams
    ? teams
        .filter(
          (team) =>
            team.memberIds.length > 0 &&
            team.memberIds.some((id) => unscheduled.some((player) => player.id === id)),
        )
        .map((team) => ({
          key: team.id,
          label: team.name,
          detail: `${team.memberIds.length} golfer${team.memberIds.length === 1 ? '' : 's'} · scoring team`,
          memberIds: team.memberIds,
        }))
    : unscheduled.map((player) => ({
        key: player.id,
        label: player.fullName,
        detail: 'Individual score',
        memberIds: [player.id],
      }));

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
        <View style={{ marginHorizontal: -20 }}>
          <AdminRosterTabs eventId={event.id} active="teams" />
        </View>

        <View style={styles.readinessCard} accessibilityLiveRegion="polite">
          <SectionLabel color={colors.link} size={10}>
            event readiness
          </SectionLabel>
          {[
            ['ROSTER', `${participants.length} golfer${participants.length === 1 ? '' : 's'}`],
            ['INVITES', `${invites.filter((invite) => invite.status === 'pending').length} pending`],
            [
              'SCORING',
              usesScoringTeams
                ? scoringIssues === 0
                  ? 'Ready'
                  : `${scoringIssues} assignment${scoringIssues === 1 ? '' : 's'} to fix`
                : 'Individual cards ready',
            ],
            [
              'PLAYING GROUPS',
              unscheduled.length === 0
                ? 'Every golfer placed'
                : `${unscheduled.length} golfer${unscheduled.length === 1 ? '' : 's'} not placed`,
            ],
            [
              'SCHEDULE',
              scheduleIssues === 0
                ? START_FORMAT_LABELS[event.startFormat]
                : `${scheduleIssues} occupied group${scheduleIssues === 1 ? '' : 's'} missing a slot`,
            ],
          ].map(([label, value]) => (
            <View key={label} style={styles.readinessRow}>
              <Text style={styles.readinessLabel}>{label}</Text>
              <Text
                style={[
                  styles.readinessValue,
                  ((label === 'SCORING' && scoringIssues > 0) ||
                    (label === 'PLAYING GROUPS' && unscheduled.length > 0) ||
                    (label === 'SCHEDULE' && scheduleIssues > 0)) &&
                    styles.readinessWarning,
                ]}>
                {value}
              </Text>
            </View>
          ))}
        </View>

        {usesScoringTeams ? (
          <>
            <SectionLabel color={colors.link} size={10}>
              scoring teams · {GAME_STYLE_LABELS[event.gameStyle]}
            </SectionLabel>
            <View style={styles.summary}>
              <View style={styles.summaryCell}>
                <Text style={styles.summaryValue}>{teams.length}</Text>
                <Text style={styles.summaryLabel}>TEAMS</Text>
              </View>
              <View style={styles.summaryDivider} />
              <View style={styles.summaryCell}>
                <Text style={styles.summaryValue}>
                  {participants.length - unassigned.length}
                </Text>
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
              <Pressable
                disabled={scoringLocked}
                style={[styles.secondaryButton, scoringLocked && { opacity: 0.4 }]}
                onPress={() => createTeam()}>
                <Text style={styles.secondaryButtonText}>ADD TEAM</Text>
              </Pressable>
              <Pressable
                disabled={scoringLocked}
                style={[styles.secondaryButton, scoringLocked && { opacity: 0.4 }]}
                onPress={confirmAutoBalance}>
                <Text style={styles.secondaryButtonText}>AUTO-BALANCE</Text>
              </Pressable>
            </View>

            {teams.map((team) => {
              const members = team.memberIds
                .map((id) => participantById(id))
                .filter((p): p is Participant => Boolean(p));
              const over = members.length > capacity;
              const canDrop =
                movingId !== null &&
                !scoringLocked &&
                !team.memberIds.includes(movingId) &&
                members.length < capacity &&
                !team.individualException;
              const played = holesPlayed(team.id);

              return (
                <View
                  key={team.id}
                  style={[styles.teamCard, canDrop && styles.teamCardDroppable]}>
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
                      {team.individualException
                        ? '1 · INDIVIDUAL'
                        : `${members.length}/${capacity}`}
                    </Text>
                  </View>

                  <View style={styles.metaRow}>
                    <Text style={styles.metaText}>
                      AVG {averageHandicap(members)} HCP
                      {played > 0 ? ` · THRU ${played}` : ''}
                    </Text>
                    <Pressable
                      disabled={scoringLocked}
                      onPress={() => confirmDelete(team)}
                      hitSlop={8}>
                      <Text style={styles.deleteText}>DELETE</Text>
                    </Pressable>
                  </View>

                  {members.map((member) => {
                    const selected = movingId === member.id;
                    return (
                      <Pressable
                        key={member.id}
                        disabled={scoringLocked}
                        onPress={() => setMovingId(selected ? null : member.id)}
                        style={[styles.playerRow, selected && styles.playerRowSelected]}>
                        <Text style={styles.playerName}>{member.fullName}</Text>
                        <Text style={styles.playerHcp}>
                          {member.handicap === null ? '—' : member.handicap}
                        </Text>
                      </Pressable>
                    );
                  })}
                  {members.length === 0 ? (
                    <Text style={styles.emptyTeam}>No players yet.</Text>
                  ) : null}

                  {(members.length === 1 || team.individualException) && played === 0 ? (
                    <Pressable
                      disabled={members.length !== 1 || scoringLocked}
                      onPress={() =>
                        updateTeam(team.id, {
                          individualException: !team.individualException,
                        })
                      }
                      style={[
                        styles.exceptionToggle,
                        team.individualException && styles.exceptionToggleActive,
                      ]}>
                      <Text style={styles.exceptionText}>
                        {team.individualException
                          ? 'INDIVIDUAL EXCEPTION · MAIN LEADERBOARD'
                          : 'MARK AS ONE-PLAYER EXCEPTION'}
                      </Text>
                    </Pressable>
                  ) : null}

                  {members.length > 0 && members.length <= PLAYING_GROUP_CAPACITY ? (
                    <Pressable
                      style={styles.inlineAction}
                      onPress={() => setSchedulingIds(team.memberIds)}>
                      <Text style={styles.inlineActionText}>
                        PLACE WHOLE TEAM IN PLAYING GROUP
                      </Text>
                    </Pressable>
                  ) : null}

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

            <View style={styles.teamCard}>
              <View style={styles.teamHeader}>
                <Text style={styles.teamName}>Unassigned scoring players</Text>
                <Text style={styles.teamCount}>{unassigned.length}</Text>
              </View>
              {unassigned.map((player) => {
                const selected = movingId === player.id;
                return (
                  <Pressable
                    key={player.id}
                    disabled={scoringLocked}
                    onPress={() => setMovingId(selected ? null : player.id)}
                    style={[styles.playerRow, selected && styles.playerRowSelected]}>
                    <Text style={styles.playerName}>{player.fullName}</Text>
                    <Text style={styles.playerHcp}>
                      {player.handicap === null ? '—' : player.handicap}
                    </Text>
                  </Pressable>
                );
              })}
              {unassigned.length === 0 ? (
                <Text style={styles.emptyTeam}>Everyone has a scoring team.</Text>
              ) : null}
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
              Scoring teams own rounds and leaderboard entries. A deliberate
              one-player exception still owns an ordinary team card; it does not
              change this event’s primary format.
              {scoringLocked
                ? ' Membership and exception status are locked after publication or score entry.'
                : ''}
            </Text>
          </>
        ) : (
          <View style={styles.infoCard}>
            <SectionLabel color={colors.link} size={10}>
              individual scoring
            </SectionLabel>
            <Text style={styles.hint}>
              Every golfer owns an individual scorecard. Use the playing groups
              below to arrange foursomes without creating scoring teams.
            </Text>
          </View>
        )}

        <View style={styles.sectionRule} />
        <View style={styles.sectionHeading}>
          <View style={{ flex: 1, gap: 5 }}>
            <SectionLabel color={colors.link} size={10}>
              playing groups · {START_FORMAT_LABELS[event.startFormat]}
            </SectionLabel>
            <Text style={styles.hint}>
              Start slots hold up to four golfers and are independent from scoring teams.
            </Text>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Add playing group"
            style={styles.smallButton}
            onPress={addGroup}>
            <Text style={styles.secondaryButtonText}>ADD GROUP</Text>
          </Pressable>
        </View>

        {schedulingIds.length > 0 ? (
          <View style={styles.scheduleBanner}>
            <Text style={styles.movingText}>
              Placing {schedulingIds.length} golfer{schedulingIds.length === 1 ? '' : 's'}
            </Text>
            <Pressable onPress={() => setSchedulingIds([])}>
              <Text style={styles.movingCancel}>CANCEL</Text>
            </Pressable>
          </View>
        ) : null}

        <View style={[styles.scheduleWorkspace, isDesktop && styles.scheduleWorkspaceDesktop]}>
          <View style={styles.groupColumn}>
          {groupDrafts.map((group) => {
          const remaining = playingGroupRemaining(group);
          const canPlace =
            schedulingIds.length > 0 &&
            canMovePlayingUnit(groupDrafts, schedulingIds, group.id);
          return (
            <View
              key={group.id}
              style={[styles.groupCard, canPlace && styles.teamCardDroppable]}>
              <View style={styles.teamHeader}>
                <TextInput
                  accessibilityLabel={`${group.name} name`}
                  value={group.name}
                  onChangeText={(name) => updateGroup(group.id, { name })}
                  style={styles.renameInput}
                  selectionColor={colors.highlight}
                />
                <Text style={styles.teamCount}>
                  {group.memberIds.length}/4 · {remaining} LEFT
                </Text>
              </View>
              <View style={styles.slotPicker}>
                {scheduleSlots.map((slot) => {
                  const active =
                    group.teeTime === slot.teeTime &&
                    group.startingHole === slot.startingHole;
                  const taken = groupDrafts.some(
                    (other) =>
                      other.id !== group.id &&
                      other.teeTime === slot.teeTime &&
                      other.startingHole === slot.startingHole,
                  );
                  return (
                    <Pressable
                      key={`${slot.teeTime}-${slot.startingHole}`}
                      accessibilityRole="radio"
                      accessibilityLabel={`${slot.teeTime}, starting hole ${slot.startingHole}`}
                      accessibilityState={{ checked: active, disabled: taken }}
                      disabled={taken}
                      onPress={() =>
                        updateGroup(group.id, {
                          teeTime: active ? null : slot.teeTime,
                          startingHole: active ? null : slot.startingHole,
                        })
                      }
                      style={[
                        styles.slotChip,
                        active && styles.slotChipActive,
                        taken && styles.slotChipTaken,
                      ]}>
                      <Text
                        style={[
                          styles.slotChipText,
                          active && styles.slotChipTextActive,
                        ]}>
                        {slot.teeTime} · H{slot.startingHole}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
              <View style={styles.fieldRow}>
                <Text style={styles.fieldLabel}>CART</Text>
                <TextInput
                  value={group.cart ?? ''}
                  onChangeText={(cart) => updateGroup(group.id, { cart: cart || null })}
                  style={styles.fieldInput}
                  placeholder="Cart 14"
                  placeholderTextColor="rgba(255,255,255,0.25)"
                  selectionColor={colors.highlight}
                />
              </View>
              {group.memberIds.map((memberId) => {
                const member = participantById(memberId);
                if (!member) return null;
                return (
                  <Pressable
                    key={memberId}
                    accessibilityLabel={`Move ${
                      usesScoringTeams
                        ? (teamOf(memberId)?.name ?? member.fullName)
                        : member.fullName
                    } to another playing group`}
                    onPress={() =>
                      setSchedulingIds(
                        usesScoringTeams
                          ? (teamOf(memberId)?.memberIds ?? [memberId])
                          : [memberId],
                      )
                    }
                    style={styles.playerRow}>
                    <View style={{ flex: 1, gap: 3 }}>
                      <Text style={styles.playerName}>{member.fullName}</Text>
                      <Text style={styles.metaText}>
                        {teamOf(memberId)?.name ?? 'INDIVIDUAL SCORE'}
                      </Text>
                    </View>
                    <Text style={styles.playerHcp}>
                      {member.handicap === null ? '—' : member.handicap}
                    </Text>
                  </Pressable>
                );
              })}
              {group.memberIds.length === 0 ? (
                <Text style={styles.emptyTeam}>No golfers assigned.</Text>
              ) : null}
              {canPlace ? (
                <Pressable style={styles.dropTarget} onPress={() => placeInGroup(group.id)}>
                  <Text style={styles.dropTargetText}>PLACE HERE</Text>
                </Pressable>
              ) : null}
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Remove ${group.name}`}
                style={styles.destructiveAction}
                onPress={() => {
                  setScheduleSaveState(null);
                  setGroupDrafts((current) =>
                    current.filter((candidate) => candidate.id !== group.id),
                  );
                }}>
                <Text style={styles.deleteText}>REMOVE GROUP</Text>
              </Pressable>
            </View>
          );
          })}
          </View>

        <View style={[styles.groupCard, isDesktop && styles.assignmentPoolDesktop]}>
          <View style={styles.teamHeader}>
            <Text style={styles.teamName}>Ready to place</Text>
            <Text style={styles.teamCount}>{scheduleUnits.length}</Text>
          </View>
          {scheduleUnits.map((unit) => {
            const selected = unit.memberIds.every((id) => schedulingIds.includes(id));
            return (
              <Pressable
                key={unit.key}
                accessibilityRole="button"
                accessibilityLabel={`${selected ? 'Cancel moving' : 'Move'} ${unit.label}`}
                onPress={() => setSchedulingIds(selected ? [] : unit.memberIds)}
                style={[styles.playerRow, selected && styles.playerRowSelected]}>
                <View style={{ flex: 1, gap: 3 }}>
                  <Text style={styles.playerName}>{unit.label}</Text>
                  <Text style={styles.metaText}>{unit.detail}</Text>
                </View>
                <Text style={styles.playerHcp}>{unit.memberIds.length} SEAT{unit.memberIds.length === 1 ? '' : 'S'}</Text>
              </Pressable>
            );
          })}
          {scheduleUnits.length === 0 ? (
            <Text style={styles.emptyTeam}>
              {usesScoringTeams && unassigned.length > 0
                ? 'Assign the remaining golfers to scoring teams first.'
                : 'Every golfer has a start slot.'}
            </Text>
          ) : null}
        </View>
        </View>

        <ActionButton
          label={savingGroups ? 'SAVING PLAYING GROUPS…' : 'SAVE PLAYING GROUPS'}
          height={58}
          disabled={!groupsDirty || savingGroups}
          onPress={() => void saveSchedule()}
        />
        {scheduleSaveState ? (
          <Text
            accessibilityLiveRegion="polite"
            style={[
              styles.saveStatus,
              scheduleSaveState === 'failed' && styles.saveStatusError,
            ]}>
            {scheduleSaveState === 'saved'
              ? 'Playing groups and start slots saved together.'
              : 'Schedule was not saved. Review the error and try again.'}
          </Text>
        ) : null}
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
  infoCard: {
    padding: 16,
    gap: 8,
    backgroundColor: 'rgba(15,17,16,0.42)',
  },
  readinessCard: {
    padding: 16,
    gap: 10,
    backgroundColor: 'rgba(15,17,16,0.52)',
  },
  readinessRow: {
    minHeight: 32,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 16,
  },
  readinessLabel: {
    fontFamily: fonts.bold,
    fontSize: 9,
    color: 'rgba(255,255,255,0.42)',
  },
  readinessValue: {
    flex: 1,
    textAlign: 'right',
    fontFamily: fonts.bold,
    fontSize: 11,
    color: colors.highlight,
  },
  readinessWarning: {
    color: '#ffcf8b',
  },
  sectionRule: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: 'rgba(123,255,178,0.22)',
  },
  sectionHeading: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  smallButton: {
    minHeight: 44,
    paddingHorizontal: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(15,17,16,0.6)',
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
  scheduleBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: '#2c8a58',
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
  groupCard: {
    backgroundColor: 'rgba(15,17,16,0.5)',
    padding: 14,
    gap: 10,
    borderWidth: 1,
    borderColor: 'rgba(123,255,178,0.12)',
  },
  scheduleWorkspace: {
    gap: 14,
  },
  scheduleWorkspaceDesktop: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  groupColumn: {
    flex: 2,
    gap: 14,
  },
  assignmentPoolDesktop: {
    flex: 1,
    minWidth: 270,
    maxWidth: 360,
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
  destructiveAction: {
    minHeight: 44,
    justifyContent: 'center',
  },
  exceptionToggle: {
    paddingHorizontal: 10,
    paddingVertical: 11,
    borderWidth: 1,
    borderColor: 'rgba(255,207,139,0.35)',
  },
  exceptionToggleActive: {
    backgroundColor: 'rgba(255,207,139,0.12)',
  },
  exceptionText: {
    fontFamily: fonts.bold,
    fontSize: 9,
    color: '#ffcf8b',
  },
  inlineAction: {
    paddingVertical: 10,
    alignItems: 'center',
    backgroundColor: 'rgba(123,255,178,0.08)',
  },
  inlineActionText: {
    fontFamily: fonts.bold,
    fontSize: 9,
    color: colors.link,
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
    minHeight: 44,
    justifyContent: 'center',
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
  saveStatus: {
    textAlign: 'center',
    fontFamily: fonts.bold,
    fontSize: 10,
    color: colors.highlight,
  },
  saveStatusError: {
    color: '#ff9b9b',
  },
});
