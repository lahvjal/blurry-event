import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Session } from '@supabase/supabase-js';

import { clearPreparedOfflineAccountId } from '@/lib/offline/event-snapshot';
import { SUPABASE_AUTH_STORAGE_KEY, supabase } from '@/lib/supabase';

/**
 * Reads the persisted session without invoking Supabase initialization.
 * `supabase.auth.getSession()` waits for an eager token refresh when the token
 * is near expiry, which can take tens of seconds with no signal. This local
 * value is used only to scope already-verified on-device data; server calls
 * continue to use the SDK's authenticated session.
 */
export async function loadStoredAuthSession(): Promise<Session | null> {
  try {
    const raw = await AsyncStorage.getItem(SUPABASE_AUTH_STORAGE_KEY);
    if (!raw) return null;
    const value: unknown = JSON.parse(raw);
    if (
      !value ||
      typeof value !== 'object' ||
      !('access_token' in value) ||
      !('refresh_token' in value) ||
      !('expires_at' in value) ||
      !('user' in value)
    ) {
      return null;
    }
    const session = value as Partial<Session>;
    return typeof session.user?.id === 'string' && session.user.id.length > 0
      ? (session as Session)
      : null;
  } catch {
    return null;
  }
}

/**
 * Explicit sign-out must revoke this device's offline account fallback before
 * Supabase removes the live session. Otherwise a shared phone could reopen the
 * previous golfer's prepared event while disconnected.
 */
export async function signOutAndClearOfflineAccess(): Promise<void> {
  await clearPreparedOfflineAccountId();
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}
