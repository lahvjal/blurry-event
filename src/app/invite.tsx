import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, Text, TextInput, View } from 'react-native';

import { LoginShell, loginStyles as styles } from '@/components/login-shell';
import { Chevron } from '@/components/ui';
import { colors } from '@/constants/theme';
import { lookupInvite, supabase } from '@/lib/supabase';

export default function InviteSignup() {
  const router = useRouter();
  const params = useLocalSearchParams<{ code?: string }>();

  const [code, setCode] = useState('');
  const [inviteEmail, setInviteEmail] = useState<string | null>(null);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  /** null = invite not verified yet. */
  const [verified, setVerified] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (typeof params.code === 'string' && params.code.trim()) {
      setCode(params.code.trim());
    }
  }, [params.code]);

  const verifyCode = async () => {
    setError(null);
    if (code.trim().length < 4) {
      setError('Enter the invite code from your invitation.');
      return;
    }

    setBusy(true);
    try {
      const invite = await lookupInvite(code.trim());
      if (!invite) {
        setError("That code isn't on the participant list. Check your invitation.");
        return;
      }
      if (invite.claimed) {
        setError('This invite was already used. Sign in with your email or username.');
        return;
      }
      setInviteEmail(invite.auth_email);
      setVerified(true);
    } catch {
      setError('Could not reach the server. Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  };

  const createAccount = async () => {
    setError(null);
    if (!inviteEmail) {
      setError('Something went wrong. Re-enter your invite code.');
      return;
    }
    if (password.length < 8) {
      setError('Use at least 8 characters for your password.');
      return;
    }
    if (password !== confirm) {
      setError('Those passwords don’t match.');
      return;
    }

    setBusy(true);
    try {
      const invite = await lookupInvite(code.trim());
      if (!invite) {
        setError('That invite code is no longer valid.');
        return;
      }
      if (invite.claimed) {
        setError('This invite was already used. Sign in with your email or username.');
        return;
      }
      if (invite.auth_email !== inviteEmail) {
        setError('This invite changed. Re-enter your invite code.');
        return;
      }

      const { error: authError } = await supabase.auth.signUp({
        email: invite.auth_email,
        password,
      });

      if (authError) {
        setError(authError.message);
        return;
      }

      router.replace('/event');
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Something went wrong creating your account.';
      setError(message);
    } finally {
      setBusy(false);
    }
  };

  const resetCode = () => {
    setVerified(false);
    setInviteEmail(null);
    setPassword('');
    setConfirm('');
    setError(null);
  };

  return (
    <LoginShell
      footer={
        <>
          <Pressable
            style={styles.loginButton}
            disabled={busy}
            onPress={verified ? createAccount : verifyCode}>
            {busy ? (
              <ActivityIndicator color="#ffffff" />
            ) : (
              <>
                <Text style={styles.loginText}>
                  {verified ? 'Create account' : 'Continue'}
                </Text>
                <Chevron />
              </>
            )}
          </Pressable>

          <Pressable onPress={() => router.replace('/')}>
            <Text style={styles.secondaryLink}>ALREADY HAVE AN ACCOUNT? SIGN IN</Text>
          </Pressable>
        </>
      }>
      <View style={styles.form}>
        {!verified ? (
          <>
            <Text style={styles.label}>INVITE CODE</Text>
            <TextInput
              value={code}
              onChangeText={setCode}
              style={styles.input}
              placeholder="BI-XXXXXXXX"
              placeholderTextColor="rgba(255,255,255,0.3)"
              autoCapitalize="characters"
              autoCorrect={false}
              selectionColor={colors.highlight}
              returnKeyType="next"
              onSubmitEditing={verifyCode}
            />
          </>
        ) : (
          <>
            <Pressable onPress={resetCode}>
              <Text style={styles.codeChip}>{code.trim().toUpperCase()}  ·  CHANGE</Text>
            </Pressable>
            <Text style={styles.label}>EMAIL</Text>
            <TextInput
              value={inviteEmail ?? ''}
              style={[styles.input, styles.inputLocked]}
              editable={false}
              selectTextOnFocus={false}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="email-address"
            />
            <Text style={styles.label}>CREATE A PASSWORD</Text>
            <TextInput
              value={password}
              onChangeText={setPassword}
              style={styles.input}
              placeholder="••••••••"
              placeholderTextColor="rgba(255,255,255,0.3)"
              secureTextEntry
              autoCapitalize="none"
              selectionColor={colors.highlight}
              returnKeyType="next"
            />
            <Text style={styles.label}>CONFIRM PASSWORD</Text>
            <TextInput
              value={confirm}
              onChangeText={setConfirm}
              style={styles.input}
              placeholder="••••••••"
              placeholderTextColor="rgba(255,255,255,0.3)"
              secureTextEntry
              autoCapitalize="none"
              selectionColor={colors.highlight}
              returnKeyType="go"
              onSubmitEditing={createAccount}
            />
          </>
        )}
        {error ? <Text style={styles.error}>{error}</Text> : null}
      </View>
    </LoginShell>
  );
}
