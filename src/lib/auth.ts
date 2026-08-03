import { clearPreparedOfflineAccountId } from '@/lib/offline/event-snapshot';
import { supabase } from '@/lib/supabase';

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
