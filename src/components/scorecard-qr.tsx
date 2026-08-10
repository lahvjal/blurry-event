import React from 'react';
import { Text, View } from 'react-native';

/** Native fallback. The product intentionally ships collection in the PWA. */
export function ScorecardQr(_props: { value: string; size?: number }) {
  return (
    <View>
      <Text>Open the Blurry Golf PWA to display this score QR.</Text>
    </View>
  );
}
