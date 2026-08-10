import { usePathname, useRouter } from 'expo-router';
import { Image } from 'expo-image';
import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import type { Session } from '@supabase/supabase-js';

import { LoginShell } from '@/components/login-shell';
import { colors, fonts } from '@/constants/theme';
import { signOutAndClearOfflineAccess } from '@/lib/auth';
import {
  isStandalonePwa,
  subscribePwaDisplayMode,
} from '@/lib/offline/pwa';
import { supabase } from '@/lib/supabase';
import { useOfflinePreparation } from '@/state/offline-preparation';

function isAuthRoute(pathname: string): boolean {
  return pathname === '/' || pathname === '/invite' || pathname.startsWith('/auth/');
}

function deviceKind(): 'ios' | 'android' | 'other' {
  if (typeof navigator === 'undefined') return 'other';
  const ios =
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  if (ios) return 'ios';
  return /Android/i.test(navigator.userAgent) ? 'android' : 'other';
}

const STEP_COPY = {
  ios: [
    'Open this page in Safari.',
    'Tap the More button (•••) in the Safari toolbar, then choose Share.',
    'In the Share sheet, scroll down and choose Add to Home Screen.',
    'Tap Add, then open Blurry from the new Home Screen icon. Sign in again if prompted.',
  ],
  android: [
    'Open the browser menu (⋮).',
    'Choose Install app or Add to Home screen.',
    'Confirm Install, then open Blurry from its new icon.',
    'Sign in again in the installed app if prompted.',
  ],
  other: [
    'Open this page on the phone you will carry during the event.',
    'Open the browser menu and choose Install app or Add to Home screen.',
    'Launch Blurry from its new Home Screen icon.',
    'Sign in again in the installed app if prompted.',
  ],
} as const;

const IOS_STEP_VISUALS: Partial<Record<number, number>> = {
  1: require('@/assets/figma/install-guide/ios-safari-more-landscape.png'),
  2: require('@/assets/figma/install-guide/ios-add-home-screen-landscape.png'),
};

function LoadingGate({ label }: { label: string }) {
  return (
    <View style={styles.blocking} accessibilityRole="progressbar">
      <ActivityIndicator color={colors.highlight} size="large" />
      <Text style={styles.loadingLabel}>{label}</Text>
    </View>
  );
}

function InstallInstructions() {
  const kind = deviceKind();
  const steps = STEP_COPY[kind];

  const signOut = async () => {
    await signOutAndClearOfflineAccess();
  };

  return (
    <View style={styles.blocking}>
      <LoginShell
        footer={
          <Pressable onPress={signOut} accessibilityRole="button">
            <Text style={styles.signOut}>SIGN OUT</Text>
          </Pressable>
        }>
        <View style={styles.panel}>
          <Text style={styles.eyebrow}>INSTALL REQUIRED</Text>
          <Text style={styles.title}>Add Blurry to your Home Screen</Text>
          <Text style={styles.summary}>
            The event app is available only from its installed Home Screen icon.
            This lets Blurry download everything needed before you reach the course.
          </Text>
          <View style={styles.steps}>
            {steps.map((step, index) => {
              const visual = kind === 'ios' ? IOS_STEP_VISUALS[index] : undefined;
              return (
                <View key={step} style={styles.stepGroup}>
                  <View style={styles.step}>
                    <View style={styles.stepNumber}>
                      <Text style={styles.stepNumberText}>{index + 1}</Text>
                    </View>
                    <Text style={styles.stepText}>{step}</Text>
                  </View>
                  {visual ? (
                    <Image
                      source={visual}
                      contentFit="cover"
                      accessibilityLabel={`Safari install step ${index + 1}`}
                      style={styles.stepVisual}
                    />
                  ) : null}
                </View>
              );
            })}
          </View>
          <View style={styles.note}>
            <Text style={styles.noteText}>
              Keep this browser page open until the icon is added. On iPhone,
              your browser sign-in may not transfer to the installed app.
            </Text>
          </View>
        </View>
      </LoginShell>
    </View>
  );
}

/**
 * Structural root guard. Browser sessions mount only auth/install routes;
 * operational providers and routes are mounted solely for a Home Screen app.
 */
export function PwaAccessGate({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [session, setSession] = useState<Session | null>(null);
  const [sessionLoading, setSessionLoading] = useState(true);
  const [standalone, setStandalone] = useState(() => isStandalonePwa());
  const offlinePreparation = useOfflinePreparation();

  useEffect(() =>
    subscribePwaDisplayMode(() => setStandalone(isStandalonePwa())), []);

  useEffect(() => {
    let active = true;
    void supabase.auth
      .getSession()
      .then(({ data }) => {
        if (!active) return;
        setSession(data.session);
        setSessionLoading(false);
      })
      .catch(() => {
        if (!active) return;
        setSession(null);
        setSessionLoading(false);
      });
    const { data } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      if (!active) return;
      setSession(nextSession);
      setSessionLoading(false);
    });
    return () => {
      active = false;
      data.subscription.unsubscribe();
    };
  }, []);

  const authRoute = isAuthRoute(pathname);
  const callbackRoute = pathname.startsWith('/auth/');
  const offlineIdentityResolving =
    standalone && offlinePreparation.phase === 'checking';
  const preparedOfflineIdentity = Boolean(
    standalone &&
      offlinePreparation.accountId &&
      offlinePreparation.phase !== 'signed-out' &&
      offlinePreparation.phase !== 'disabled',
  );
  const openingInstalledHome = Boolean(
    standalone && pathname === '/' && (session || preparedOfflineIdentity),
  );

  useEffect(() => {
    if (openingInstalledHome) router.replace('/event');
  }, [openingInstalledHome, router]);

  useEffect(() => {
    if (
      sessionLoading ||
      session ||
      preparedOfflineIdentity ||
      offlineIdentityResolving ||
      authRoute
    ) return;
    router.replace('/');
  }, [
    authRoute,
    offlineIdentityResolving,
    preparedOfflineIdentity,
    router,
    session,
    sessionLoading,
  ]);

  if (callbackRoute) return <>{children}</>;
  if ((sessionLoading || offlineIdentityResolving) && !preparedOfflineIdentity) {
    return <LoadingGate label="Checking your sign-in…" />;
  }
  if (openingInstalledHome) {
    return <LoadingGate label="Opening your saved event…" />;
  }
  if (!session && !preparedOfflineIdentity) {
    return authRoute ? <>{children}</> : <LoadingGate label="Returning to sign in…" />;
  }
  if (!standalone) return <InstallInstructions />;
  return <>{children}</>;
}

const styles = StyleSheet.create({
  blocking: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    zIndex: 100_000,
    elevation: 100_000,
    backgroundColor: colors.bg,
    alignItems: 'stretch',
    justifyContent: 'center',
  },
  loadingLabel: {
    marginTop: 14,
    color: colors.textSupporting,
    fontFamily: fonts.medium,
    fontSize: 13,
    textAlign: 'center',
  },
  panel: {
    alignSelf: 'stretch',
    maxWidth: 520,
    gap: 16,
  },
  eyebrow: {
    color: colors.highlight,
    fontFamily: fonts.bold,
    fontSize: 10,
    letterSpacing: 1.8,
  },
  title: {
    color: colors.textPrimary,
    fontFamily: fonts.serif,
    fontSize: 34,
    lineHeight: 37,
  },
  summary: {
    color: colors.textSupporting,
    fontFamily: fonts.regular,
    fontSize: 14,
    lineHeight: 21,
  },
  steps: {
    gap: 12,
    marginTop: 4,
  },
  stepGroup: {
    gap: 10,
  },
  step: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
  },
  stepNumber: {
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(123,255,178,0.13)',
    borderWidth: 1,
    borderColor: 'rgba(123,255,178,0.35)',
  },
  stepNumberText: {
    color: colors.highlight,
    fontFamily: fonts.bold,
    fontSize: 11,
  },
  stepText: {
    flex: 1,
    color: colors.textPrimary,
    fontFamily: fonts.medium,
    fontSize: 13,
    lineHeight: 19,
    paddingTop: 3,
  },
  stepVisual: {
    width: '100%',
    aspectRatio: 16 / 9,
    maxHeight: 240,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.18)',
    backgroundColor: 'rgba(10,14,12,0.55)',
  },
  note: {
    marginTop: 4,
    padding: 13,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1,
    borderColor: colors.border,
  },
  noteText: {
    color: colors.textSupporting,
    fontFamily: fonts.regular,
    fontSize: 11,
    lineHeight: 17,
  },
  signOut: {
    color: colors.textSupporting,
    fontFamily: fonts.bold,
    fontSize: 10,
    letterSpacing: 0.7,
  },
});
