import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useEffect, useMemo, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { FloatingNav } from '@/components/floating-nav';
import { OfflineNotice } from '@/components/offline-state';
import { PAGE_HEADER_HEIGHT, PageHeader } from '@/components/page-header';
import { ParticipantAvatar } from '@/components/participant-avatar';
import { Noise } from '@/components/ui';
import { colors, fonts } from '@/constants/theme';
import {
  fetchConversationNotifications,
  leaveConversation,
  setConversationNotifications,
} from '@/lib/chat';
import { useBrowserDefinitelyOffline } from '@/lib/offline/network';
import {
  conversationTitle,
  initialsOf,
  useConversationDetail,
} from '@/state/chat';
import { useEvent } from '@/state/event';

export default function ConversationSettings() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { event, me, participantById, accountAccess } = useEvent();
  const params = useLocalSearchParams<{
    id?: string;
    account?: string;
    originEventId?: string;
  }>();
  const conversationId = params.id ?? null;
  const myActorId = accountAccess?.accountId ?? me.id;
  const signedIn = Boolean(accountAccess?.accountId) || me.claimed;
  const browserOffline = useBrowserDefinitelyOffline();

  const { conversation, loading, error } = useConversationDetail(conversationId);
  const [notificationsEnabled, setNotificationsEnabled] = useState(true);
  const [notificationsLoading, setNotificationsLoading] = useState(true);
  const [notificationsBusy, setNotificationsBusy] = useState(false);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [leaveError, setLeaveError] = useState<string | null>(null);
  const [leaving, setLeaving] = useState(false);

  const members = useMemo(() => {
    if (conversation?.members?.length) {
      return conversation.members.map((member) => ({
        id: member.accountId ?? member.participantId ?? 'deleted-account',
        participantId: member.participantId,
        fullName: member.fullName,
        initials: initialsOf(member.fullName),
        avatarUrl: member.avatarUrl,
      }));
    }
    return (conversation?.memberIds ?? [])
      .map((id) => participantById(id))
      .filter((player): player is NonNullable<typeof player> => Boolean(player));
  }, [conversation?.memberIds, conversation?.members, participantById]);
  const creatorName =
    conversation?.createdByName?.split(' ')[0] ??
    (conversation?.createdBy
      ? participantById(conversation.createdBy)?.fullName.split(' ')[0]
      : null);
  const direct = conversation?.kind === 'direct';
  const directParticipant = direct
    ? members.find(
        (member) => member.id !== myActorId && member.id !== me.id,
      )
    : undefined;
  const title = directParticipant?.fullName ?? (conversation
    ? conversationTitle(conversation, me.id, participantById, event.name)
    : 'Conversation');
  const isEventGroup = conversation?.kind === 'event_group';
  const isTeamChat = Boolean(conversation?.teamId);
  const canManageOriginMembers =
    conversation?.eventActive !== false &&
    Boolean(conversation?.originEventId) &&
    conversation?.originEventId === event.id;

  useEffect(() => {
    if (!conversationId || !signedIn) {
      setNotificationsLoading(false);
      return;
    }
    if (browserOffline) {
      setNotificationsLoading(false);
      setSettingsError(null);
      return;
    }

    let active = true;
    setNotificationsLoading(true);
    setSettingsError(null);

    fetchConversationNotifications(conversationId, me.id)
      .then((enabled) => {
        if (active) setNotificationsEnabled(enabled);
      })
      .catch((caught: { message?: string }) => {
        if (active) {
          setSettingsError(
            caught?.message ?? 'Could not load notification settings.',
          );
        }
      })
      .finally(() => {
        if (active) setNotificationsLoading(false);
      });

    return () => {
      active = false;
    };
  }, [browserOffline, conversationId, me.id, signedIn]);

  const toggleNotifications = async () => {
    if (
      !conversationId ||
      browserOffline ||
      notificationsLoading ||
      notificationsBusy ||
      !signedIn
    ) {
      return;
    }

    const next = !notificationsEnabled;
    setNotificationsEnabled(next);
    setNotificationsBusy(true);
    setSettingsError(null);

    try {
      await setConversationNotifications(conversationId, me.id, next);
    } catch (caught) {
      setNotificationsEnabled(!next);
      setSettingsError(
        (caught as { message?: string })?.message ??
          'Could not update notification settings.',
      );
    } finally {
      setNotificationsBusy(false);
    }
  };

  const leave = async () => {
    if (!conversationId || leaving || browserOffline) return;
    setLeaving(true);
    setLeaveError(null);
    try {
      await leaveConversation(conversationId);
      router.replace(params.account ? '/inbox' : '/messages');
    } catch (caught) {
      setLeaveError(
        (caught as { message?: string })?.message ?? 'Could not leave.',
      );
      setLeaving(false);
    }
  };

  const kindLabel = direct
    ? 'DIRECT MESSAGE'
    : `${members.length} ${members.length === 1 ? 'MEMBER' : 'MEMBERS'}`;

  return (
    <View style={styles.root}>
      <Noise />
      <PageHeader title="CHAT SETTINGS" showMore={false} />

      <ScrollView
        contentContainerStyle={{
          paddingTop: insets.top + PAGE_HEADER_HEIGHT + 20,
          paddingHorizontal: 20,
          paddingBottom: 140,
          gap: 20,
        }}
        showsVerticalScrollIndicator={false}>
        <View style={styles.conversationCard}>
          {directParticipant ? (
            <ParticipantAvatar participant={directParticipant} size={56} />
          ) : (
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>{initialsOf(title)}</Text>
            </View>
          )}
          <View style={styles.conversationText}>
            <Text style={styles.conversationName}>{title}</Text>
            <Text style={styles.conversationMeta}>
              {kindLabel}
              {!direct && creatorName ? ` · CREATED BY ${creatorName.toUpperCase()}` : ''}
            </Text>
          </View>
        </View>

        {browserOffline ? (
          <OfflineNotice
            compact
            message="Conversation details remain available, but notification settings, membership changes, and leaving a group require a connection. Reconnect and try again."
          />
        ) : null}

        {error ? <Text style={styles.error}>{error}</Text> : null}

        <View>
          <Text style={styles.sectionLabel}>PREFERENCES</Text>
          <View style={styles.settingRow}>
            <View style={styles.settingText}>
              <Text style={styles.settingTitle}>NOTIFICATIONS</Text>
              <Text style={styles.settingDescription}>
                Get an alert when someone sends a message in this chat.
              </Text>
            </View>
            <Pressable
              accessibilityRole="switch"
              accessibilityLabel={`Notifications for ${title}`}
              accessibilityState={{
                checked: notificationsEnabled,
                disabled:
                  browserOffline || notificationsLoading || notificationsBusy,
                busy: notificationsBusy,
              }}
              accessibilityHint={
                browserOffline
                  ? 'Changing notification settings requires a connection.'
                  : undefined
              }
              disabled={
                browserOffline ||
                notificationsLoading ||
                notificationsBusy ||
                !signedIn
              }
              onPress={toggleNotifications}
              style={[
                styles.switch,
                notificationsEnabled && styles.switchOn,
                (browserOffline || notificationsLoading || notificationsBusy) &&
                  styles.switchBusy,
              ]}>
              <View
                style={[
                  styles.switchKnob,
                  notificationsEnabled && styles.switchKnobOn,
                ]}
              />
            </Pressable>
          </View>
          {settingsError ? <Text style={styles.error}>{settingsError}</Text> : null}
        </View>

        {!direct && conversation ? (
          <View>
            <View style={styles.sectionHeading}>
              <Text style={styles.sectionLabel}>MEMBERS · {members.length}</Text>
              {isEventGroup || isTeamChat || !canManageOriginMembers ? null : (
                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{ disabled: browserOffline }}
                  accessibilityHint={
                    browserOffline
                      ? 'Changing group membership requires a connection.'
                      : undefined
                  }
                  disabled={browserOffline}
                  onPress={() =>
                    conversationId
                      ? router.push({
                          pathname: params.account ? '/chat-members' : '/create-group',
                          params: {
                            add: conversationId,
                            account: params.account,
                            originEventId: params.originEventId,
                          },
                        })
                      : undefined
                  }>
                  <Text
                    style={[
                      styles.addPeople,
                      browserOffline && styles.actionDisabled,
                    ]}>
                    ADD PEOPLE
                  </Text>
                </Pressable>
              )}
            </View>

            {members.map((member) => (
              <View key={member.id} style={styles.memberRow}>
                <ParticipantAvatar participant={member} size={40} />
                <View style={styles.memberText}>
                  <Text style={styles.memberName}>
                    {member.fullName}
                    {member.id === myActorId || member.id === me.id
                      ? '  ·  YOU'
                      : ''}
                  </Text>
                  <Text style={styles.memberRole}>
                    {isTeamChat
                      ? 'TEAM MEMBER'
                      : member.id === conversation.createdByAccountId ||
                          member.id === conversation.createdBy
                      ? 'CREATED THIS GROUP'
                      : 'MEMBER'}
                  </Text>
                </View>
              </View>
            ))}
          </View>
        ) : null}

        {!loading && !conversation ? (
          <Text style={styles.error}>
            This conversation is no longer available.
          </Text>
        ) : null}

        {leaveError ? <Text style={styles.error}>{leaveError}</Text> : null}

        {isTeamChat ? (
          <Pressable
            style={styles.teamButton}
            onPress={() => router.push('/my-team')}>
            <Text style={styles.teamButtonText}>VIEW TEAM DETAILS</Text>
          </Pressable>
        ) : null}

        {!direct && conversation && !isEventGroup && !isTeamChat ? (
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ disabled: leaving || browserOffline }}
            accessibilityHint={
              browserOffline ? 'Leaving a group requires a connection.' : undefined
            }
            style={[
              styles.leaveButton,
              browserOffline && styles.leaveButtonDisabled,
            ]}
            onPress={leave}
            disabled={leaving || browserOffline}>
            <Text style={styles.leaveText}>
              {leaving ? 'LEAVING…' : 'LEAVE GROUP'}
            </Text>
          </Pressable>
        ) : null}
      </ScrollView>

      {params.account ? null : <FloatingNav />}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  conversationCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    padding: 20,
    backgroundColor: '#181d1a',
  },
  avatar: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#1e3629',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    fontFamily: fonts.bold,
    fontSize: 15,
    color: colors.highlight,
  },
  conversationText: {
    flex: 1,
    gap: 6,
  },
  conversationName: {
    fontFamily: fonts.serif,
    fontSize: 24,
    color: '#ffffff',
  },
  conversationMeta: {
    fontFamily: fonts.bold,
    fontSize: 9,
    color: 'rgba(255,255,255,0.4)',
  },
  sectionHeading: {
    minHeight: 32,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  sectionLabel: {
    fontFamily: fonts.bold,
    fontSize: 10,
    color: 'rgba(255,255,255,0.4)',
    marginBottom: 8,
  },
  settingRow: {
    minHeight: 80,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    paddingVertical: 16,
  },
  settingText: {
    flex: 1,
    gap: 7,
  },
  settingTitle: {
    fontFamily: fonts.bold,
    fontSize: 13,
    color: '#ffffff',
  },
  settingDescription: {
    fontFamily: fonts.regular,
    fontSize: 12,
    lineHeight: 17,
    color: 'rgba(255,255,255,0.45)',
  },
  actionDisabled: {
    color: 'rgba(255,255,255,0.28)',
  },
  leaveButtonDisabled: {
    opacity: 0.4,
  },
  switch: {
    width: 50,
    height: 30,
    borderRadius: 15,
    backgroundColor: 'rgba(255,255,255,0.14)',
    padding: 3,
    justifyContent: 'center',
  },
  switchOn: {
    backgroundColor: colors.highlight,
  },
  switchBusy: {
    opacity: 0.5,
  },
  switchKnob: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: '#ffffff',
  },
  switchKnobOn: {
    alignSelf: 'flex-end',
    backgroundColor: '#131715',
  },
  addPeople: {
    fontFamily: fonts.bold,
    fontSize: 11,
    color: colors.highlight,
  },
  memberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingVertical: 12,
  },
  memberText: {
    flex: 1,
    gap: 5,
  },
  memberName: {
    fontFamily: fonts.bold,
    fontSize: 15,
    color: '#ffffff',
  },
  memberRole: {
    fontFamily: fonts.regular,
    fontSize: 10,
    color: 'rgba(255,255,255,0.4)',
  },
  error: {
    fontFamily: fonts.regular,
    fontSize: 12,
    color: '#ff9d9d',
  },
  teamButton: {
    height: 64,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(93,146,115,0.16)',
  },
  teamButtonText: {
    fontFamily: fonts.bold,
    fontSize: 12,
    color: colors.highlight,
  },
  leaveButton: {
    height: 64,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#521a2b',
  },
  leaveText: {
    fontFamily: fonts.bold,
    fontSize: 12,
    color: '#ffffff',
  },
});
