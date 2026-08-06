import { useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, Text, TextInput, View } from 'react-native';

import { LoginShell, loginStyles as styles } from '@/components/login-shell';
import { OfflineNotice } from '@/components/offline-state';
import { Chevron } from '@/components/ui';
import { colors } from '@/constants/theme';
import { useBrowserDefinitelyOffline } from '@/lib/offline/network';
import { resolveLoginEmail, supabase } from '@/lib/supabase';

export default function Login() {
  const router = useRouter();
  const offline = useBrowserDefinitelyOffline();
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Sessions persist to storage, but nothing checked for one on launch, so a
  // signed-in golfer saw the login form again every time the PWA restarted.
  const [checkingSession, setCheckingSession] = useState(true);

  useEffect(() => {
    let cancelled = false;
    supabase.auth.getSession().then(({ data }) => {
      if (cancelled) return;
      if (data.session) {
        router.replace('/event');
        return;
      }
      setCheckingSession(false);
    });
    return () => {
      cancelled = true;
    };
  }, [router]);

  const submit = async () => {
    setError(null);
    if (offline) return;
    if (login.trim().length === 0) {
      setError('Enter your email or username.');
      return;
    }
    if (password.length < 8) {
      setError('Use at least 8 characters for your password.');
      return;
    }

    setBusy(true);
    try {
      const authEmail = await resolveLoginEmail(login);
      if (!authEmail) {
        setError('No account found for that email or username.');
        return;
      }

      const { error: authError } = await supabase.auth.signInWithPassword({
        email: authEmail,
        password,
      });

      if (authError) {
        setError('Wrong password. Try again or reset with your invite code.');
        return;
      }

      router.replace('/event');
    } catch {
      setError('Could not reach the server. Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  };

  if (checkingSession) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color="#ffffff" />
      </View>
    );
  }

  return (
    <LoginShell
      footer={
        <>
          {__DEV__ ? (
            <Pressable onPress={() => router.replace('/event')}>
              <Text style={styles.devSkip}>DEV · SKIP SIGN-IN</Text>
            </Pressable>
          ) : null}

          <Pressable
            accessibilityRole="button"
            accessibilityState={{ disabled: busy || offline, busy }}
            accessibilityHint={
              offline ? 'Signing in requires an internet connection.' : undefined
            }
            style={[
              styles.loginButton,
              offline && styles.disabledControl,
            ]}
            disabled={busy || offline}
            onPress={submit}>
            {busy ? (
              <ActivityIndicator color="#ffffff" />
            ) : (
              <>
                <Text style={styles.loginText}>Member login</Text>
                <Chevron />
              </>
            )}
          </Pressable>

          <Pressable
            accessibilityRole="button"
            accessibilityState={{ disabled: offline }}
            accessibilityHint={
              offline ? 'Redeeming an invite requires a connection.' : undefined
            }
            disabled={offline}
            onPress={() => router.push('/invite')}>
            <Text
              style={[
                styles.secondaryLink,
                offline && styles.disabledText,
              ]}>
              FIRST TIME? REDEEM INVITE CODE
            </Text>
          </Pressable>
        </>
      }>
      <View style={styles.form}>
        {offline ? (
          <OfflineNotice
            compact
            message="Signing in and redeeming an invite require a connection. Reconnect, then try again."
          />
        ) : null}
        <Text style={styles.label}>EMAIL OR USERNAME</Text>
        <TextInput
          value={login}
          onChangeText={setLogin}
          style={styles.input}
          placeholder="you@email.com or username"
          placeholderTextColor="rgba(255,255,255,0.3)"
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="email-address"
          textContentType="username"
          selectionColor={colors.highlight}
          returnKeyType="next"
          onSubmitEditing={() => {
            if (!offline) void submit();
          }}
        />
        <Text style={styles.label}>PASSWORD</Text>
        <TextInput
          value={password}
          onChangeText={setPassword}
          style={styles.input}
          placeholder="••••••••"
          placeholderTextColor="rgba(255,255,255,0.3)"
          secureTextEntry
          autoCapitalize="none"
          textContentType="password"
          selectionColor={colors.highlight}
          returnKeyType="go"
          onSubmitEditing={() => {
            if (!offline) void submit();
          }}
        />
        {error ? <Text style={styles.error}>{error}</Text> : null}
      </View>
    </LoginShell>
  );
}
