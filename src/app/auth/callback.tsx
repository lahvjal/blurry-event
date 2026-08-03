import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { colors, fonts } from '@/constants/theme';
import { supabase } from '@/lib/supabase';

/**
 * Keeps auth completion reachable before the installation gate. Password auth
 * does not currently use this route, but PKCE/magic-link providers can safely
 * return here without exposing any operational event screen in a browser tab.
 */
export default function AuthCallback() {
  const router = useRouter();
  const params = useLocalSearchParams<{
    code?: string;
    error?: string;
    error_description?: string;
  }>();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const finish = async () => {
      if (params.error) {
        throw new Error(params.error_description ?? params.error);
      }

      const existing = await supabase.auth.getSession();
      if (existing.data.session) {
        router.replace('/event');
        return;
      }

      if (params.code) {
        const { error: exchangeError } =
          await supabase.auth.exchangeCodeForSession(params.code);
        if (exchangeError) throw exchangeError;
        router.replace('/event');
        return;
      }

      throw new Error('This sign-in link is incomplete or has expired.');
    };

    void finish().catch((caught: unknown) => {
      if (!active) return;
      setError(
        caught instanceof Error
          ? caught.message
          : 'The sign-in link could not be completed.',
      );
    });
    return () => {
      active = false;
    };
  }, [params.code, params.error, params.error_description, router]);

  return (
    <View style={styles.root}>
      {error ? (
        <>
          <Text style={styles.title}>Sign-in link unavailable</Text>
          <Text style={styles.message}>{error}</Text>
          <Text style={styles.link} onPress={() => router.replace('/')}>
            RETURN TO LOGIN
          </Text>
        </>
      ) : (
        <>
          <ActivityIndicator color={colors.highlight} size="large" />
          <Text style={styles.message}>Finishing your sign-in…</Text>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    paddingHorizontal: 30,
    backgroundColor: colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 14,
  },
  title: {
    color: colors.textPrimary,
    fontFamily: fonts.serif,
    fontSize: 30,
    textAlign: 'center',
  },
  message: {
    color: colors.textSupporting,
    fontFamily: fonts.regular,
    fontSize: 13,
    lineHeight: 19,
    textAlign: 'center',
  },
  link: {
    marginTop: 10,
    color: colors.highlight,
    fontFamily: fonts.bold,
    fontSize: 11,
    letterSpacing: 0.7,
  },
});
