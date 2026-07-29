import { Image } from 'expo-image';
import React from 'react';
import {
  StyleProp,
  StyleSheet,
  Text,
  TextStyle,
  View,
  ViewStyle,
} from 'react-native';

import { fonts } from '@/constants/theme';
import { localAvatar } from '@/state/event';
import { Participant } from '@/state/types';

type AvatarParticipant = Pick<
  Participant,
  'id' | 'fullName' | 'initials' | 'avatarUrl'
>;

type ParticipantAvatarProps = {
  participant: AvatarParticipant;
  size?: number;
  backgroundColor?: string;
  initialsColor?: string;
  style?: StyleProp<ViewStyle>;
  textStyle?: StyleProp<TextStyle>;
};

function sourceFor(participant: AvatarParticipant): number | { uri: string } | null {
  const profilePhoto = participant.avatarUrl?.trim();
  return profilePhoto ? { uri: profilePhoto } : localAvatar(participant.id);
}

function keyFor(source: number | { uri: string } | null): string | null {
  if (source === null) return null;
  return typeof source === 'number' ? `asset:${source}` : source.uri;
}

/**
 * A participant portrait everywhere the app shows a person.
 *
 * The profile photo is authoritative. Seeded local portraits keep the demo
 * populated, and initials remain visible if neither source exists or a remote
 * image cannot be loaded.
 */
export function ParticipantAvatar({
  participant,
  size = 44,
  backgroundColor = '#333634',
  initialsColor = '#5a5f5c',
  style,
  textStyle,
}: ParticipantAvatarProps) {
  const source = sourceFor(participant);
  const sourceKey = keyFor(source);
  const [failedSource, setFailedSource] = React.useState<string | null>(null);

  React.useEffect(() => {
    setFailedSource(null);
  }, [sourceKey]);

  const showImage = source !== null && failedSource !== sourceKey;

  return (
    <View
      style={[
        styles.avatar,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor,
        },
        style,
      ]}>
      <Text
        style={[
          styles.initials,
          { color: initialsColor, fontSize: size * 0.3 },
          textStyle,
        ]}>
        {participant.initials}
      </Text>
      {showImage ? (
        <Image
          source={source}
          style={StyleSheet.absoluteFill}
          contentFit="cover"
          recyclingKey={participant.id}
          transition={100}
          accessibilityLabel={`${participant.fullName}'s profile photo`}
          onError={() => {
            if (sourceKey) setFailedSource(sourceKey);
          }}
        />
      ) : null}
    </View>
  );
}

export function ParticipantAvatarStack({
  participants,
  size = 30,
  overlap = 13,
  borderColor = 'rgba(255,255,255,0.9)',
}: {
  participants: AvatarParticipant[];
  size?: number;
  overlap?: number;
  borderColor?: string;
}) {
  return (
    <View style={styles.stack}>
      {participants.map((participant, index) => (
        <ParticipantAvatar
          key={participant.id}
          participant={participant}
          size={size}
          style={{
            marginLeft: index === 0 ? 0 : -overlap,
            zIndex: participants.length - index,
            borderWidth: 2,
            borderColor,
          }}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  avatar: {
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  initials: {
    fontFamily: fonts.bold,
  },
  stack: {
    flexDirection: 'row',
  },
});
