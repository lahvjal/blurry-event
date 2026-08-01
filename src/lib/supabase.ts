import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';

const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

if (!url || !anonKey) {
  throw new Error(
    'Missing EXPO_PUBLIC_SUPABASE_URL or EXPO_PUBLIC_SUPABASE_ANON_KEY. ' +
      'Copy .env.example to .env and fill in your project values.',
  );
}

export const supabase = createClient(url, anonKey, {
  auth: {
    // Sessions survive app restarts, which matters on a course with no signal.
    storage: AsyncStorage,
    persistSession: true,
    autoRefreshToken: true,
    // No deep-link callback in this flow; participants use an invite code.
    detectSessionInUrl: false,
  },
});

/**
 * True when the server rejected the write on its own terms — a constraint, a
 * bad value, or a policy — rather than failing to hear about it. Retrying these
 * can never succeed, so the offline queue drops them instead of blocking every
 * later write behind one it can never deliver. Anything else (no code at all,
 * which is what a dropped connection looks like) is treated as retryable.
 */
export function isPermanentError(error: { code?: string } | null | undefined): boolean {
  const code = error?.code ?? '';
  // 22xxx data exception, 23xxx integrity violation, 42xxx access/syntax.
  return /^(22|23|42)/.test(code) || code.startsWith('PGRST');
}

/**
 * Resolves an invite code for first-time setup. Returns null for unknown codes.
 */
export async function lookupInvite(code: string) {
  const { data, error } = await supabase
    .rpc('lookup_invite', { code })
    .maybeSingle<{ auth_email: string; claimed: boolean }>();

  if (error) throw new Error(error.message);
  return data;
}

/** Adds one unclaimed event registration to the current signed-in account. */
export async function claimEventInvite(code: string): Promise<string> {
  const { data, error } = await supabase.rpc('claim_event_invite', {
    code: code.trim(),
  });
  if (error) throw new Error(error.message);
  return data as string;
}

/** Maps an email or username to the auth email used for sign-in. */
export async function resolveLoginEmail(login: string): Promise<string | null> {
  const { data, error } = await supabase.rpc('resolve_login', { login: login.trim() });
  if (error) throw new Error(error.message);
  return (data as string | null) ?? null;
}
