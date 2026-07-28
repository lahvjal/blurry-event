import { InstrumentSerif_400Regular } from '@expo-google-fonts/instrument-serif';
import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
} from '@expo-google-fonts/inter';
import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { colors } from '@/constants/theme';
import { setupPwa } from '@/lib/offline/pwa';
import { syncPush } from '@/lib/push';
import { startSync } from '@/lib/sync';
import { EventProvider } from '@/state/event';

SplashScreen.preventAutoHideAsync();

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
        <Stack
          screenOptions={{
            headerShown: false,
            contentStyle: { backgroundColor: colors.bg },
            animation: 'fade',
          }}
        />
      </EventProvider>
    </SafeAreaProvider>
  );
}
