import { supabase } from '@/lib/supabase';

/**
 * Sending goes through the send-invite edge function rather than straight to
 * Resend: the API key is a server credential, and anything shipped in the app
 * bundle is public. The function also decides who's allowed to send, by asking
 * the database whether the caller is an admin.
 */

export type InviteSendResult = {
  sent: number;
  /** Players with no real address on file — nothing to send to. */
  skipped: number;
  failed: number;
  errors: string[];
};

export async function sendInviteEmails(
  participantIds: string[],
): Promise<InviteSendResult> {
  if (participantIds.length === 0) {
    return { sent: 0, skipped: 0, failed: 0, errors: [] };
  }

  // invoke() attaches the caller's session token, which is what the function
  // checks admin rights against.
  const { data, error } = await supabase.functions.invoke<InviteSendResult>(
    'send-invite',
    { body: { participantIds } },
  );

  if (error) throw new Error(error.message);
  if (!data) throw new Error('The invite sender did not respond.');
  return data;
}
