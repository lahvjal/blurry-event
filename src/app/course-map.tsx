import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import React from 'react';
import {
  Dimensions,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { PageHeader } from '@/components/page-header';
import { Noise } from '@/components/ui';
import { colors, fonts } from '@/constants/theme';
import { useEvent } from '@/state/event';

export default function CourseMap() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { event, me } = useEvent();

  const { width, height } = Dimensions.get('window');

  if (!event.courseMapUrl) {
    return (
      <View style={styles.root}>
        <LinearGradient colors={['#203329', '#1b2a22']} style={StyleSheet.absoluteFill} />
        <Noise />
        <PageHeader title="course map" subtitle={event.courseName} />
        <View style={[styles.empty, { paddingTop: insets.top + 54 + 60 }]}>
          <Text style={styles.emptyTitle}>No map yet</Text>
          <Text style={styles.emptyBody}>
            {me.isAdmin
              ? 'Upload a photo of the course layout in Event Details and it’ll appear here.'
              : 'The club hasn’t posted a course map for this event yet.'}
          </Text>
          {me.isAdmin ? (
            <Pressable
              style={styles.uploadButton}
              onPress={() => router.push('/admin-event')}>
              <Text style={styles.uploadButtonText}>GO TO EVENT DETAILS</Text>
            </Pressable>
          ) : null}
        </View>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <LinearGradient colors={['#203329', '#1b2a22']} style={StyleSheet.absoluteFill} />
      <PageHeader title="course map" subtitle={event.courseName} />
      {/* ScrollView gives native pinch-to-zoom and panning on iOS for free. */}
      <ScrollView
        style={StyleSheet.absoluteFill}
        contentContainerStyle={{ width, height }}
        maximumZoomScale={5}
        minimumZoomScale={1}
        bouncesZoom
        centerContent
        showsVerticalScrollIndicator={false}
        showsHorizontalScrollIndicator={false}>
        <Image
          source={{ uri: event.courseMapUrl }}
          style={{ width, height }}
          contentFit="contain"
          transition={150}
        />
      </ScrollView>
      <View style={[styles.hintBar, { bottom: insets.bottom + 20 }]}>
        <Text style={styles.hintText}>PINCH TO ZOOM</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#111513',
  },
  empty: {
    paddingHorizontal: 24,
    gap: 12,
  },
  emptyTitle: {
    fontFamily: fonts.serif,
    fontSize: 32,
    color: '#ffffff',
  },
  emptyBody: {
    fontFamily: fonts.regular,
    fontSize: 13,
    lineHeight: 19,
    color: 'rgba(255,255,255,0.5)',
  },
  uploadButton: {
    marginTop: 8,
    height: 52,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(123,255,178,0.14)',
  },
  uploadButtonText: {
    fontFamily: fonts.bold,
    fontSize: 11,
    color: colors.highlight,
  },
  hintBar: {
    position: 'absolute',
    alignSelf: 'center',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  hintText: {
    fontFamily: fonts.bold,
    fontSize: 9,
    color: 'rgba(255,255,255,0.6)',
  },
});
