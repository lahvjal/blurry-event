import { InstrumentSerif_400Regular } from '@expo-google-fonts/instrument-serif';
import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
} from '@expo-google-fonts/inter';
import { useFonts } from 'expo-font';
import { Stack, useGlobalSearchParams, usePathname, useRouter } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useCallback, useEffect } from 'react';
import { Alert } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';

import { PullToRefreshProvider } from '@/components/pull-to-refresh';
import { colors } from '@/constants/theme';
import { setupPwa } from '@/lib/offline/pwa';
import { syncPush } from '@/lib/push';
import { eventPath, legacyEventScreen } from '@/lib/routes';
import { startSync } from '@/lib/sync';
import { EventProvider, useEvent } from '@/state/event';

SplashScreen.preventAutoHideAsync();

const PULL_TO_REFRESH_EXCLUDED_PATHNAMES = ['/score-input'];

function AppNavigator() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useGlobalSearchParams<Record<string, string | string[]>>();
  // Expo Router returns a fresh params object on renders. A stable serialized
  // value keeps the compatibility redirect from replacing the same route in a
  // loop while navigation is settling.
  const paramsKey = JSON.stringify(params);
  const { accessLoading, activeEventId, refresh } = useEvent();

  // Old single-event links remain valid. Once access resolves, replace them
  // with the explicit event path and preserve conversation/participant params.
  useEffect(() => {
    const screen = legacyEventScreen(pathname);
    if (!screen || accessLoading) return;
    if (!activeEventId) {
      router.replace('/events');
      return;
    }
    const currentParams = JSON.parse(paramsKey) as Record<
      string,
      string | string[]
    >;
    const preserved = Object.fromEntries(
      Object.entries(currentParams).filter(
        ([key]) => key !== 'eventId' && key !== 'view' && key !== 'screen',
      ),
    );
    router.replace({
      pathname: eventPath(activeEventId, screen) as never,
      params: preserved,
    });
  }, [accessLoading, activeEventId, paramsKey, pathname, router]);

  const handleRefresh = useCallback(async () => {
    try {
      await refresh();
    } catch {
      Alert.alert(
        "Couldn't refresh",
        'Check your connection and try again.',
      );
    }
  }, [refresh]);

  return (
    <PullToRefreshProvider
      onRefresh={handleRefresh}
      excludedPathnames={PULL_TO_REFRESH_EXCLUDED_PATHNAMES}>
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: colors.bg },
          animation: 'fade',
        }}
      />
    </PullToRefreshProvider>
  );
}

export default function RootLayout() {
  const [loaded] = useFonts({
    InstrumentSerif_400Regular,
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
  });

  useEffect(() => {
    if (loaded) {
      SplashScreen.hideAsync();
    }
  }, [loaded]);

  // Drains anything typed while the phone had no signal, and keeps watching
  // connectivity for the rest of the session.
  useEffect(() => startSync(), []);
  useEffect(() => setupPwa(), []);
  // Push endpoints rotate without warning and a stale one fails silently, so
  // an already-granted device re-asserts its current endpoint on every launch.
  useEffect(() => {
    void syncPush();
  }, []);

  if (!loaded) {
    return null;
  }

  return (
    <SafeAreaProvider>
      <EventProvider>
        <StatusBar style="light" />
        <AppNavigator />
      </EventProvider>
    </SafeAreaProvider>
  );
}
