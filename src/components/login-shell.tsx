import { Image } from 'expo-image';
import React from 'react';
import {
  ImageBackground,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { colors, fonts } from '@/constants/theme';

const bg = require('@/assets/figma/login-bg.png');
const logo = require('@/assets/figma/logo-union.svg');

export function LoginShell({
  children,
  footer,
}: {
  children: React.ReactNode;
  footer: React.ReactNode;
}) {
  return (
    <ImageBackground
      source={bg}
      style={styles.root}
      resizeMode="cover"
      // react-native-web sizes the inner image layer to the file's intrinsic
      // dimensions unless told otherwise, so `cover` was being applied inside a
      // 736px-wide box: fine on a phone, but on a desktop window the artwork
      // stopped dead partway across. Filling the layer makes cover mean cover.
      imageStyle={styles.backgroundImage}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}>
          <View style={styles.identity}>
            <Image source={logo} style={styles.logo} contentFit="contain" />
            <Text style={styles.wordmark}>BLURRY{'\n'}INVITATIONAL</Text>
          </View>
          {children}
          <View style={styles.footer}>{footer}</View>
        </ScrollView>
      </KeyboardAvoidingView>
    </ImageBackground>
  );
}

export const loginStyles = StyleSheet.create({
  form: {
    alignSelf: 'stretch',
    gap: 8,
  },
  label: {
    fontFamily: fonts.bold,
    fontSize: 10,
    color: 'rgba(255,255,255,0.5)',
    marginTop: 8,
  },
  input: {
    backgroundColor: 'rgba(10,14,12,0.6)',
    height: 54,
    paddingHorizontal: 16,
    fontFamily: fonts.bold,
    fontSize: 15,
    color: '#ffffff',
    letterSpacing: 1,
  },
  inputLocked: {
    opacity: 0.7,
  },
  error: {
    fontFamily: fonts.regular,
    fontSize: 12,
    color: '#ff9b9b',
    marginTop: 6,
  },
  secondaryLink: {
    fontFamily: fonts.bold,
    fontSize: 11,
    color: colors.highlight,
    textAlign: 'center',
    letterSpacing: 0.5,
  },
  devSkip: {
    fontFamily: fonts.bold,
    fontSize: 10,
    color: 'rgba(255,255,255,0.35)',
    textAlign: 'center',
  },
  loginButton: {
    backgroundColor: '#121d17',
    height: 78,
    alignSelf: 'stretch',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 30,
  },
  disabledControl: {
    opacity: 0.42,
  },
  disabledText: {
    color: 'rgba(255,255,255,0.3)',
  },
  loginText: {
    fontFamily: fonts.bold,
    fontSize: 16,
    color: '#ffffff',
    textTransform: 'uppercase',
  },
  codeChip: {
    fontFamily: fonts.bold,
    fontSize: 10,
    color: colors.highlight,
    alignSelf: 'flex-start',
  },
});

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  backgroundImage: {
    width: '100%',
    height: '100%',
  },
  content: {
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 30,
    paddingVertical: 60,
    gap: 40,
  },
  identity: {
    alignItems: 'center',
    gap: 30,
  },
  logo: {
    width: 130,
    height: 128,
  },
  wordmark: {
    fontFamily: fonts.serif,
    fontSize: 16,
    lineHeight: 17.6,
    color: '#ffffff',
    textAlign: 'center',
    letterSpacing: 4.8,
  },
  footer: {
    alignSelf: 'stretch',
    alignItems: 'center',
    gap: 16,
  },
});
