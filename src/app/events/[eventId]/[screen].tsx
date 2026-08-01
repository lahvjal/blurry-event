import { Redirect, useLocalSearchParams } from 'expo-router';
import React from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import Admin from '@/app/admin';
import AdminEvent from '@/app/admin-event';
import AdminHoles from '@/app/admin-holes';
import AdminRoster from '@/app/admin-roster';
import AdminTeams from '@/app/admin-teams';
import Announcements from '@/app/announcements';
import CompleteRound from '@/app/complete-round';
import ConversationSettings from '@/app/conversation-settings';
import CourseMap from '@/app/course-map';
import CreateGroup from '@/app/create-group';
import DirectMessage from '@/app/direct-message';
import Directory from '@/app/directory';
import EventHome from '@/app/event';
import GroupConversation from '@/app/group-conversation';
import GroupDetails from '@/app/group-details';
import Leaderboard from '@/app/leaderboard';
import Messages from '@/app/messages';
import MyTeam from '@/app/my-team';
import NewMessage from '@/app/new-message';
import Notifications from '@/app/notifications';
import ParticipantProfile from '@/app/participant-profile';
import Profile from '@/app/profile';
import ScoreInput from '@/app/score-input';
import Scorecard from '@/app/scorecard';
import { colors, fonts } from '@/constants/theme';
import { EventScreenName, eventPath, isEventScreenName } from '@/lib/routes';
import { useEvent } from '@/state/event';

const SCREENS: Record<EventScreenName, React.ComponentType> = {
  admin: Admin,
  'admin-event': AdminEvent,
  'admin-holes': AdminHoles,
  'admin-roster': AdminRoster,
  'admin-teams': AdminTeams,
  announcements: Announcements,
  'complete-round': CompleteRound,
  'conversation-settings': ConversationSettings,
  'course-map': CourseMap,
  'create-group': CreateGroup,
  'direct-message': DirectMessage,
  directory: Directory,
  event: EventHome,
  'group-conversation': GroupConversation,
  'group-details': GroupDetails,
  leaderboard: Leaderboard,
  messages: Messages,
  'my-team': MyTeam,
  'new-message': NewMessage,
  notifications: Notifications,
  'participant-profile': ParticipantProfile,
  profile: Profile,
  'score-input': ScoreInput,
  scorecard: Scorecard,
};

export default function ScopedEventScreen() {
  const params = useLocalSearchParams<{ eventId?: string; screen?: string }>();
  const { accountAccess, accessLoading, activeEventId, eventLoading } = useEvent();
  const eventId = params.eventId;
  const screen = params.screen;

  if (!eventId) return <Redirect href="/events" />;
  if (!screen || !isEventScreenName(screen)) {
    return <Redirect href={eventPath(eventId, 'event') as never} />;
  }
  if (!accessLoading && !accountAccess) {
    return <Redirect href="/events" />;
  }
  if (
    !accessLoading &&
    accountAccess &&
    !accountAccess.events.some((event) => event.id === eventId)
  ) {
    return <Redirect href="/events" />;
  }
  if (accessLoading || eventLoading || activeEventId !== eventId) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color={colors.highlight} />
        <Text style={styles.loadingText}>OPENING EVENT</Text>
      </View>
    );
  }

  const Screen = SCREENS[screen];
  return <Screen />;
}

const styles = StyleSheet.create({
  loading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    backgroundColor: colors.bg,
  },
  loadingText: { fontFamily: fonts.bold, fontSize: 10, color: colors.textMuted },
});
