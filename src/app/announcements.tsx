import { LinearGradient } from 'expo-linear-gradient';
import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { FloatingNav } from '@/components/floating-nav';
import { PageHeader } from '@/components/page-header';
import { Noise } from '@/components/ui';
import { colors, fonts } from '@/constants/theme';
import { useEvent } from '@/state/event';

function relativeDay(iso: string): string {
  const then = new Date(iso);
  const days = Math.round((Date.now() - then.getTime()) / (1000 * 60 * 60 * 24));
  if (days <= 0) return 'TODAY';
  if (days === 1) return 'YESTERDAY';
  return `${days} DAYS AGO`;
}

export default function Announcements() {
  const insets = useSafeAreaInsets();
  const { announcements } = useEvent();

  return (
    <View style={styles.root}>
      <LinearGradient colors={['#203329', '#1b2a22']} style={StyleSheet.absoluteFill} />
      <Noise />
      <PageHeader title="announcements" />
      <ScrollView
        contentContainerStyle={{
          paddingTop: insets.top + 54 + 22,
          paddingHorizontal: 20,
          paddingBottom: 130,
          gap: 12,
        }}
        showsVerticalScrollIndicator={false}>
        {announcements.length === 0 ? (
          <Text style={styles.empty}>Nothing posted yet.</Text>
        ) : (
          announcements.map((note) => (
            <View key={note.id} style={styles.card}>
              <View style={styles.cardTop}>
                <Text style={styles.author}>FROM {note.authorName.toUpperCase()}</Text>
                <Text style={styles.when}>{relativeDay(note.createdAt)}</Text>
              </View>
              <Text style={styles.body}>{note.body}</Text>
            </View>
          ))
        )}
      </ScrollView>
      <FloatingNav />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#1b2a22',
  },
  card: {
    backgroundColor: 'rgba(15,17,16,0.4)',
    padding: 16,
    gap: 10,
  },
  cardTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  author: {
    fontFamily: fonts.bold,
    fontSize: 9,
    color: colors.link,
  },
  when: {
    fontFamily: fonts.bold,
    fontSize: 9,
    color: 'rgba(255,255,255,0.35)',
  },
  body: {
    fontFamily: fonts.regular,
    fontSize: 14,
    lineHeight: 20,
    color: '#ffffff',
  },
  empty: {
    fontFamily: fonts.regular,
    fontSize: 13,
    color: 'rgba(255,255,255,0.45)',
  },
});
